// ow-electron main process. Responsibilities:
//  - Front-facing presence: a dashboard window (live AOWA data) + a hotkey
//    in-game overlay + a tray. This is the value Overwolf's store requires and
//    is what makes the app worth installing.
//  - GEP: subscribe to Warframe game events and push inventory to AOWA.
//  - Pairing: handle the aowa:// deep link (and manual codes via IPC).
//
// Runs on ow-electron (@overwolf/ow-electron), which exposes gaming packages on
// `app.overwolf.packages`. GEP/overlay are declared in package.json
// `overwolf.packages`. Build/run on Windows (see README); this file is written
// against the ow-electron API and typechecks once deps are installed.
import { app, BrowserWindow, Tray, Menu, ipcMain, shell, globalShortcut } from 'electron'
import { join } from 'node:path'
import { DEBUG_GEP, INGEST_DEBOUNCE_MS, URL_SCHEME, WARFRAME_GAME_ID } from '../lib/config'
import { fetchOwnedRelics, fetchTodos, ingestInventory, pair, UnauthorizedError, type IngestItem } from '../lib/api'
import { findInventoryValue, normalizeInventory } from '../lib/inventory'
import { extractPairCode } from '../lib/deeplink'
import { fetchCycles, fetchWorldState } from '../lib/aowa-data'
import { clearToken, loadHotkey, loadToken, saveHotkey, saveToken } from './store'
import { DEFAULT_HOTKEY, hotkeyLabel, toAccelerator, type HotkeyBinding } from './hotkey'
import { initOverlay, setOverlayHotkey } from './overlay'
import { startEELogTail } from './eelog'
import type { EELogEvent } from '../lib/eelog'

// ow-electron augments `app` with `.overwolf.packages`. Loosely typed here so
// the file is resilient across package versions; tighten with
// @overwolf/ow-electron-packages-types once wiring is confirmed on-device.
const owApp = app as unknown as {
  overwolf: {
    packages: {
      on(event: string, cb: (...args: any[]) => void): void
      gep?: {
        on(event: string, cb: (...args: any[]) => void): void
        removeAllListeners?(): void
        setRequiredFeatures(gameId: number, features: string[] | null): Promise<unknown>
      }
      overlay?: any
    }
  }
}

// Overlay toggle hotkey (loaded on ready, rebindable from the GUI).
let hotkey: HotkeyBinding = DEFAULT_HOTKEY

let dashboard: BrowserWindow | null = null
let overlay: BrowserWindow | null = null
let tray: Tray | null = null

// ---- windows -------------------------------------------------------------
const RENDERER = (name: string) =>
  process.env.VITE_DEV_SERVER_URL
    ? `${process.env.VITE_DEV_SERVER_URL}/src/renderer/${name}.html`
    : join(__dirname, `../renderer/${name}.html`)

function loadInto(win: BrowserWindow, name: string): void {
  const target = RENDERER(name)
  if (target.startsWith('http')) void win.loadURL(target)
  else void win.loadFile(target)
}

function createDashboard(): void {
  if (dashboard) {
    dashboard.show()
    return
  }
  dashboard = new BrowserWindow({
    width: 960,
    height: 640,
    title: 'AOWA',
    backgroundColor: '#0f1117',
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true },
  })
  loadInto(dashboard, 'dashboard')
  dashboard.on('closed', () => (dashboard = null))
}

function createOverlay(): void {
  overlay = new BrowserWindow({
    width: 320,
    height: 420,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true },
  })
  overlay.setAlwaysOnTop(true, 'screen-saver')
  loadInto(overlay, 'overlay')
  overlay.on('closed', () => (overlay = null))
}

function toggleOverlay(): void {
  if (!overlay) createOverlay()
  else if (overlay.isVisible()) overlay.hide()
  else overlay.show()
}

// Options + loader for the Overwolf overlay-package (in-game) window. The HUD is
// draggable via CSS (-webkit-app-region), so no OS titlebar is needed.
function overlayBaseWindowOptions(): Record<string, unknown> {
  return {
    width: 340,
    height: 520,
    transparent: true,
    frame: false,
    resizable: true,
    passthrough: 'noPassThrough',
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true },
  }
}
function loadOverlayWindow(win: {
  window: { loadURL?(u: string): Promise<unknown>; loadFile?(p: string): Promise<unknown> }
}): void {
  const target = RENDERER('overlay')
  if (target.startsWith('http')) void win.window.loadURL?.(target)
  else void win.window.loadFile?.(target)
}

// Desktop-fallback global shortcut (in exclusive fullscreen the overlay package's
// own hotkey takes over — see overlay.ts). Re-applied whenever the binding changes.
function applyGlobalShortcut(): void {
  globalShortcut.unregisterAll()
  const accel = toAccelerator(hotkey)
  if (!accel) return
  try {
    globalShortcut.register(accel, () => toggleOverlay())
  } catch (e) {
    console.error('[AOWA] globalShortcut register failed', accel, e)
  }
}

function setHotkey(h: HotkeyBinding): void {
  hotkey = h
  saveHotkey(h)
  applyGlobalShortcut() // desktop
  setOverlayHotkey(h) // in-game (no-op if overlay package not ready)
}

function createTray(): void {
  tray = new Tray(join(__dirname, '../../public/icons/icon256.png'))
  tray.setToolTip('AOWA Agent')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open dashboard', click: () => createDashboard() },
      { label: 'Toggle overlay', click: () => toggleOverlay() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  )
  tray.on('click', () => createDashboard())
}

// ---- pairing -------------------------------------------------------------
async function handlePairing(code: string): Promise<{ ok: boolean; error?: string }> {
  const c = code.trim()
  if (!c) return { ok: false, error: 'no code' }
  try {
    const { token } = await pair(c)
    saveToken(token)
    broadcastStatus()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

function handleDeepLink(argvOrUrl: string[] | string): void {
  const urls = Array.isArray(argvOrUrl) ? argvOrUrl : [argvOrUrl]
  for (const u of urls) {
    const code = extractPairCode(u)
    if (code) void handlePairing(code)
  }
}

function status() {
  return { paired: !!loadToken() }
}
function broadcastStatus(): void {
  const s = status()
  for (const w of [dashboard, overlay]) w?.webContents.send('aowa:status', s)
}

// ---- GEP inventory → AOWA ingest ----------------------------------------
let pending: IngestItem[] | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(flush, INGEST_DEBOUNCE_MS)
}
async function flush(): Promise<void> {
  flushTimer = null
  const items = pending
  pending = null
  const token = loadToken()
  if (!items?.length || !token) return
  // Log exactly what we send so the real GEP item naming can be mapped (#42):
  // if relics aren't matching in AOWA, these are the names to reconcile.
  console.log('[AOWA-INGEST] sending', items.length, 'items:', JSON.stringify(items))
  try {
    const res = await ingestInventory(token, items)
    console.log('[AOWA-INGEST] result:', JSON.stringify(res))
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      clearToken()
      broadcastStatus()
    } else {
      console.error('[AOWA] ingest failed', e)
    }
  }
}

// ---- GEP capture state (surfaced to the UI) ------------------------------
// gameRunning: Warframe is detected + GEP enabled. lastUpdate: epoch-ms of the
// last inventory info push (the app is "receiving game data" when this is recent).
const gep = { gameRunning: false, lastUpdate: 0 as number }

function gepState(): { gameRunning: boolean; lastUpdate: number } {
  return { gameRunning: gep.gameRunning, lastUpdate: gep.lastUpdate }
}
function broadcastGep(): void {
  const s = gepState()
  for (const w of [dashboard, overlay]) w?.webContents.send('aowa:gep', s)
}

// ---- EE.log activity (surfaced to the UI) --------------------------------
type Activity = { kind: string; label: string; detail?: string; at: number }
const activity: Activity[] = [] // newest first, capped
const ACTIVITY_MAX = 20

function broadcastActivity(): void {
  for (const w of [dashboard, overlay]) w?.webContents.send('aowa:activity', activity)
}
function pushActivity(e: EELogEvent): void {
  activity.unshift({ kind: e.kind, label: e.label, detail: e.detail, at: Date.now() })
  if (activity.length > ACTIVITY_MAX) activity.length = ACTIVITY_MAX
  broadcastActivity()
}

// Default EE.log location on Windows; override with EE_LOG_PATH.
function eeLogPath(): string {
  if (process.env.EE_LOG_PATH) return process.env.EE_LOG_PATH
  const localAppData = process.env.LOCALAPPDATA || join(app.getPath('home'), 'AppData', 'Local')
  return join(localAppData, 'Warframe', 'EE.log')
}

function initGep(): void {
  const api = owApp.overwolf.packages.gep
  if (!api) return
  api.removeAllListeners?.()

  api.on('game-detected', (e: { enable(): void }, gameId: number, name?: string) => {
    console.log('[AOWA-GEP] game-detected', gameId, name)
    // During discovery, enable Warframe by id OR name so we can confirm the id.
    if (gameId === WARFRAME_GAME_ID || /warframe/i.test(String(name ?? ''))) {
      e.enable()
      // Request ALL features with `null`. VERIFIED on-device: ow-electron only
      // emits `match_info.inventory` with `null`; an explicit
      // ['match_info','game_info'] list did NOT (same login inventory sync fired
      // it under null but stayed silent under the list). Do not "narrow" this.
      void Promise.resolve(api.setRequiredFeatures(gameId, null))
        .then((r) => console.log('[AOWA-GEP] setRequiredFeatures(null=all) →', JSON.stringify(r)))
        .catch((err) => console.error('[AOWA-GEP] setRequiredFeatures failed', err))
      gep.gameRunning = true
      broadcastGep()
    }
  })

  api.on('new-info-update', (_e: unknown, gameId: number, info: Record<string, unknown>) => {
    // Warframe GEP publishes `match_info.inventory` (confirmed live) but with no
    // sample_data — so log every update's shape unconditionally until we've
    // captured the real payload. Full JSON when DEBUG_GEP, else a compact key map.
    if (DEBUG_GEP) {
      console.log('[AOWA-GEP] new-info-update', gameId, JSON.stringify(info))
    } else if (typeof info.key === 'string') {
      // Flat shape — show the actual feature/key so you can see WHICH update
      // fired (e.g. game_info/username vs the one we want, match_info/inventory).
      console.log('[AOWA-GEP] info', gameId, `${String(info.feature ?? '?')}/${info.key}`)
    } else {
      const shape: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(info)) {
        shape[k] = v && typeof v === 'object' ? Object.keys(v as object) : typeof v
      }
      console.log('[AOWA-GEP] info', gameId, JSON.stringify(shape))
    }
    const inv = findInventoryValue(info)
    if (inv !== undefined) {
      const s = typeof inv === 'string' ? inv : JSON.stringify(inv)
      console.log('[AOWA-GEP] inventory raw:', s.length > 4000 ? s.slice(0, 4000) + '…' : s)
    }
    gep.gameRunning = true
    gep.lastUpdate = Date.now()
    broadcastGep()
    const items = normalizeInventory(info)
    if (items.length) {
      pending = items
      scheduleFlush()
    }
  })

  api.on('game-exit', (_e: unknown, gameId: number, name?: string) => {
    console.log('[AOWA-GEP] game-exit', gameId, name)
    gep.gameRunning = false
    broadcastGep()
  })

  api.on('error', (_e: unknown, gameId: number, err: unknown) => {
    console.error('[AOWA-GEP] error', gameId, err)
  })
}

// ---- app lifecycle -------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    handleDeepLink(argv)
    createDashboard()
  })
  app.on('open-url', (_e, url) => handleDeepLink(url)) // macOS

  if (process.defaultApp) app.setAsDefaultProtocolClient(URL_SCHEME, process.execPath, [process.cwd()])
  else app.setAsDefaultProtocolClient(URL_SCHEME)

  ipcMain.handle('aowa:pair', (_e, code: string) => handlePairing(code))
  ipcMain.handle('aowa:unpair', () => {
    clearToken()
    broadcastStatus()
  })
  ipcMain.handle('aowa:status', () => status())
  ipcMain.handle('aowa:gep', () => gepState())
  ipcMain.handle('aowa:activity', () => activity)
  ipcMain.handle('aowa:hotkey', () => ({ hotkey, label: hotkeyLabel(hotkey) }))
  ipcMain.handle('aowa:hotkey:set', (_e, h: HotkeyBinding) => {
    setHotkey(h)
    return { hotkey, label: hotkeyLabel(hotkey) }
  })
  ipcMain.handle('aowa:open-aowa', () => shell.openExternal('https://aowa.ashguard.io/profile'))
  // Fetched in main (Node) so the renderer isn't blocked by CORS.
  ipcMain.handle('aowa:worldstate', async () => {
    // /events can 503 transiently (DE's CDN flaps); don't let it reject the
    // handler — return whatever resolved so the dashboard degrades gracefully.
    const [ws, cycles] = await Promise.allSettled([fetchWorldState(), fetchCycles()])
    if (ws.status === 'rejected') console.warn('[AOWA] worldstate fetch failed:', ws.reason?.message ?? ws.reason)
    if (cycles.status === 'rejected') console.warn('[AOWA] cycles fetch failed:', cycles.reason?.message ?? cycles.reason)
    return {
      ws: ws.status === 'fulfilled' ? ws.value : null,
      cycles: cycles.status === 'fulfilled' ? cycles.value : null,
    }
  })
  // Personal data via the stored agent token (backend #37). Returns paired:false
  // when unlinked; drops the token if the server rejects it.
  ipcMain.handle('aowa:me', async () => {
    const token = loadToken()
    if (!token) return { paired: false }
    try {
      const [todos, relics] = await Promise.all([fetchTodos(token), fetchOwnedRelics(token)])
      return { paired: true, todos, relics }
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        clearToken()
        broadcastStatus()
      }
      return { paired: false }
    }
  })

  // Dev-mode credential check. owepm verifies OW_DEV_KEY (temp, no-console devs)
  // or OW_CLI_EMAIL+OW_CLI_API_KEY (console devs); without a valid one the
  // gaming packages fail with "invalid verification". This log distinguishes
  // "key missing from env" (run `npm run start:dev`, not `npm start`) from
  // "key present but rejected" (developer status Pending / key expired).
  {
    const k = process.env.OW_DEV_KEY
    console.log(
      '[AOWA] dev-mode credential:',
      k
        ? `OW_DEV_KEY present (…${k.trim().slice(-4)}, len ${k.trim().length})`
        : process.env.OW_CLI_API_KEY
          ? 'OW_CLI_EMAIL/OW_CLI_API_KEY present'
          : 'NONE in env — gaming packages will fail verification. Put OW_DEV_KEY in .env and run `npm run start:dev` (or F5).',
    )
  }

  app.whenReady().then(() => {
    hotkey = loadHotkey() ?? DEFAULT_HOTKEY
    try {
      // Package objects only exist once their 'ready' event fires — never touch
      // owApp.overwolf.packages.gep/.overlay synchronously at startup.
      owApp.overwolf.packages.on('ready', (_e: unknown, name: string, version: string) => {
        console.log('[AOWA] package ready:', name, version)
        if (name === 'gep') initGep()
        if (name === 'overlay') {
          const overlayApi = owApp.overwolf.packages.overlay
          if (overlayApi) {
            initOverlay(overlayApi, {
              hotkey,
              baseWindowOptions: overlayBaseWindowOptions(),
              loadOverlay: loadOverlayWindow,
            })
          }
        }
      })
    } catch (e) {
      console.error('[AOWA] package wiring failed (ok outside ow-electron):', e)
    }
    createTray()
    createDashboard()
    applyGlobalShortcut()
    try {
      startEELogTail(eeLogPath(), (e) => {
        console.log('[AOWA-EE] event', e.kind, e.label)
        pushActivity(e)
      })
    } catch (e) {
      console.error('[AOWA-EE] tail failed to start', e)
    }
    handleDeepLink(process.argv) // cold-start deep link
  })

  app.on('window-all-closed', () => {
    // Stay alive in the tray; quit explicitly via the tray menu.
  })
}
