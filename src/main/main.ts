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
import { app, BrowserWindow, Tray, Menu, ipcMain, shell, globalShortcut, nativeImage, screen } from 'electron'
import { join } from 'node:path'
import { API_BASE, DEBUG_GEP, INGEST_DEBOUNCE_MS, URL_SCHEME, WARFRAME_GAME_ID } from '../lib/config'
import { fetchBuilds, fetchOwnedRelics, fetchSubscriptions, fetchTodos, ingestInventory, pair, UnauthorizedError, type IngestItem } from '../lib/api'
import { extractCurrencies, extractParts, extractProgress, findInventoryValue, normalizeInventory, type Currencies } from '../lib/inventory'
import { extractPairCode } from '../lib/deeplink'
import { fetchCycles, fetchWorldState } from '../lib/aowa-data'
import { clearToken, loadHotkey, loadOverlayConfig, loadToken, saveHotkey, saveOverlayConfig, saveToken, type OverlayConfig } from './store'
import { DEFAULT_HOTKEY, hotkeyLabel, toAccelerator, type HotkeyBinding } from './hotkey'
import { initOverlay, setHudVisible, setOverlayHotkey } from './overlay'
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
        getFeatures?(gameId: number): Promise<string[]>
        getInfo?(gameId: number): Promise<any>
      }
      overlay?: any
    }
  }
}

// Overlay toggle hotkey (loaded on ready, rebindable from the GUI).
let hotkey: HotkeyBinding = DEFAULT_HOTKEY

let dashboard: BrowserWindow | null = null
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

// AOWA app icon (#51). Loaded as a high-res NativeImage from the 256px PNG so the
// window icon is applied reliably (and taskbar-scaled by the OS) rather than the
// OS picking a stale/small .ico frame. The multi-res .ico is still what
// electron-builder bakes into the packaged exe (win.icon).
const APP_ICON = nativeImage.createFromPath(join(__dirname, '../../public/icons/icon256.png'))

function createDashboard(): void {
  if (dashboard) {
    dashboard.show()
    return
  }
  dashboard = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 620,
    minHeight: 460,
    title: 'AOWA',
    icon: APP_ICON,
    // Bespoke AOWA chrome (#53): frameless with a custom in-page titlebar (drag
    // region + min/close). Windows keeps edge-resize on frameless windows while
    // resizable is true. backgroundColor matches the renderer to avoid a flash.
    frame: false,
    backgroundColor: '#0a0814',
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true },
  })
  loadInto(dashboard, 'dashboard')
  dashboard.on('closed', () => (dashboard = null))
  // Keep the custom titlebar's maximize/restore control in sync with the OS.
  const emitMax = () => dashboard?.webContents.send('aowa:win:maximized', dashboard.isMaximized())
  dashboard.on('maximize', emitMax)
  dashboard.on('unmaximize', emitMax)
}

// ---- always-on top bar (#60) ---------------------------------------------
// A slim strip docked to the top of the primary display showing world cycles +
// Baro + subscribed fissures. Only visible when Warframe is the focused game
// (gep.gameFocused) so it never covers the browser/desktop when you alt-tab out.
// focusable:false so it never steals focus.
let topbar: BrowserWindow | null = null
let topbarEnabled = false
function createTopbar(): void {
  if (topbar) return
  const d = screen.getPrimaryDisplay()
  topbar = new BrowserWindow({
    x: d.bounds.x,
    y: d.bounds.y,
    width: d.bounds.width,
    height: 34,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true },
  })
  topbar.setAlwaysOnTop(true, 'screen-saver')
  topbar.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true })
  loadInto(topbar, 'topbar')
  topbar.on('closed', () => (topbar = null))
}
// applyTopbar sets whether the top bar is enabled; syncTopbar decides if it's
// actually shown right now (enabled AND Warframe focused).
function applyTopbar(enabled: boolean): void {
  topbarEnabled = enabled
  if (enabled) createTopbar()
  else {
    topbar?.close()
    topbar = null
  }
  syncTopbar()
}
function syncTopbar(): void {
  if (!topbar) return
  if (topbarEnabled && gep.gameFocused) topbar.showInactive()
  else topbar.hide()
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

// Toggle the always-on top bar on/off (persisted), broadcasting so the dashboard
// checkbox stays in sync. Bound to the hotkey + tray.
function toggleTopbar(): void {
  const cfg = loadOverlayConfig()
  cfg.topbar = !cfg.topbar
  saveOverlayConfig(cfg)
  applyTopbar(cfg.topbar)
  for (const w of [dashboard, topbar]) w?.webContents.send('aowa:overlay:config', cfg)
}

// Desktop global shortcut → toggle the top bar (in-game exclusive fullscreen uses
// the overlay package's own hotkey — see overlay.ts). Re-applied on rebind.
function applyGlobalShortcut(): void {
  globalShortcut.unregisterAll()
  const accel = toAccelerator(hotkey)
  if (!accel) return
  try {
    globalShortcut.register(accel, () => toggleTopbar())
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
      { label: 'Toggle top bar', click: () => toggleTopbar() },
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
  for (const w of [dashboard]) w?.webContents.send('aowa:status', s)
}

// ---- GEP inventory → AOWA ingest ----------------------------------------
let pending: IngestItem[] | null = null
let pendingParts: import('../lib/api').IngestPart[] | null = null
let pendingProgress: import('../lib/api').IngestProgress | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(flush, INGEST_DEBOUNCE_MS)
}
async function flush(): Promise<void> {
  flushTimer = null
  const items = pending
  const parts = pendingParts
  const progress = pendingProgress
  pending = null
  pendingParts = null
  pendingProgress = null
  const token = loadToken()
  if (!items?.length || !token) return
  // Log exactly what we send so the real GEP item naming can be mapped (#42):
  // if relics aren't matching in AOWA, these are the names to reconcile.
  console.log('[AOWA-INGEST] sending', items.length, 'items,', parts?.length ?? 0, 'parts')
  try {
    const res = await ingestInventory(token, items, lastCurrencies, parts, progress)
    console.log('[AOWA-INGEST] result:', JSON.stringify(res))
    lastSync = {
      relics: res.relics,
      gear: res.gear,
      mastered: res.mastered,
      received: res.received,
      currency: !!lastCurrencies,
      parts: parts?.length ?? 0,
      quests: progress?.quests.length ?? 0,
      starChart: progress?.starChartNodes ?? 0,
      at: Date.now(),
    }
    broadcastSync()
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
// gameFocused: Warframe is the foreground window (from GEP game_info focus) — the
// top bar only shows when this is true, so it never covers the desktop/browser.
const gep = { gameRunning: false, gameFocused: false, lastUpdate: 0 as number }

// setGameFocused updates focus and re-syncs the top bar's visibility.
function setGameFocused(focused: boolean): void {
  if (gep.gameFocused === focused) return
  gep.gameFocused = focused
  console.log('[AOWA-GEP] game focus →', focused)
  syncTopbar()
}

function gepState(): { gameRunning: boolean; lastUpdate: number } {
  return { gameRunning: gep.gameRunning, lastUpdate: gep.lastUpdate }
}
function broadcastGep(): void {
  const s = gepState()
  for (const w of [dashboard]) w?.webContents.send('aowa:gep', s)
}

// ---- last inventory sync result (surfaced to the dashboard, #47) ---------
// Per-category counts + time of the most recent successful ingest. The dashboard
// splits this: the "Account sync" card shows a checklist (which categories
// synced), and the "Account" card shows the numbers. null until first sync.
type SyncState = {
  relics: number
  gear: number
  mastered: number
  received: number
  currency: boolean
  parts: number
  quests: number
  starChart: number
  at: number
} | null
let lastSync: SyncState = null
function broadcastSync(): void {
  for (const w of [dashboard]) w?.webContents.send('aowa:sync', lastSync)
}

// ---- account currencies (surfaced to the dashboard, #52) -----------------
// Plat/credits/ducats/endo read off the same GEP inventory payload as the
// mastery sync. null until the first inventory pull carries them.
let lastCurrencies: Currencies | null = null
function broadcastCurrencies(): void {
  for (const w of [dashboard]) w?.webContents.send('aowa:currencies', lastCurrencies)
}

// ---- EE.log activity (surfaced to the UI) --------------------------------
type Activity = { kind: string; label: string; detail?: string; at: number }
const activity: Activity[] = [] // newest first, capped
const ACTIVITY_MAX = 20

function broadcastActivity(): void {
  for (const w of [dashboard]) w?.webContents.send('aowa:activity', activity)
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

let infoPollTimer: ReturnType<typeof setInterval> | null = null

// pullInventory reads GEP's CURRENT cached game state on demand (getInfo) rather
// than waiting for the one-shot `match_info.inventory` event, which only fires at
// the login inventory load — easily missed if the agent starts after login.
// getInfo returns whatever GEP has cached, so it works even if we missed the event.
async function pullInventory(gameId: number, api: NonNullable<typeof owApp.overwolf.packages.gep>): Promise<void> {
  if (!api.getInfo) return
  try {
    const info = await api.getInfo(gameId)
    const inv = findInventoryValue(info)
    if (inv === undefined) return // not cached yet — a later poll may have it
    const wrapped = { inventory: inv } as Record<string, unknown>
    const items = normalizeInventory(wrapped)
    console.log('[AOWA-GEP] getInfo → inventory present,', items.length, 'items')
    const cur = extractCurrencies(wrapped)
    if (cur) {
      lastCurrencies = cur
      broadcastCurrencies()
      console.log('[AOWA-GEP] currencies', JSON.stringify(cur))
    }
    const parts = extractParts(wrapped)
    if (parts.length) {
      pendingParts = parts
      console.log('[AOWA-GEP] sellable prime parts:', parts.length)
    }
    const progress = extractProgress(wrapped)
    if (progress) {
      pendingProgress = progress
      console.log('[AOWA-GEP] progress:', progress.quests.length, 'quests,', progress.starChartNodes, 'nodes')
    }
    if (items.length) {
      pending = items
      scheduleFlush()
    }
  } catch (e) {
    console.error('[AOWA-GEP] getInfo failed', e)
  }
}

// focusFromInfo pulls a game-focus boolean out of a GEP info-update, whichever
// shape it arrives in (flat {feature:'game_info',key:'focus',value} or a nested
// game_info object). Returns undefined when the update isn't about focus.
function focusFromInfo(info: Record<string, unknown>): boolean | undefined {
  const truthy = (v: unknown) => v === true || v === 1 || String(v).toLowerCase() === 'true' || String(v) === '1'
  if (String(info.feature ?? '') === 'game_info' && typeof info.key === 'string' && /focus/i.test(info.key)) {
    return truthy(info.value)
  }
  const gi = info.game_info as Record<string, unknown> | undefined
  if (gi && typeof gi === 'object') {
    if ('focus' in gi) return truthy(gi.focus)
    if ('focused' in gi) return truthy(gi.focused)
    if ('isInFocus' in gi) return truthy(gi.isInFocus)
  }
  return undefined
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
        .then(async (r) => {
          console.log('[AOWA-GEP] setRequiredFeatures(null=all) →', JSON.stringify(r))
          const feats = await api.getFeatures?.(gameId).catch(() => undefined)
          if (feats) console.log('[AOWA-GEP] getFeatures →', JSON.stringify(feats))
          // Pull the current inventory now, then a few more times as the game
          // finishes loading it, then keep a slow poll so re-syncs are caught.
          for (const ms of [1500, 6000, 20000]) setTimeout(() => void pullInventory(gameId, api), ms)
          if (infoPollTimer) clearInterval(infoPollTimer)
          infoPollTimer = setInterval(() => void pullInventory(gameId, api), 120_000)
        })
        .catch((err) => console.error('[AOWA-GEP] setRequiredFeatures failed', err))
      gep.gameRunning = true
      setGameFocused(true) // a game-detect means it just came to the foreground
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
    const focus = focusFromInfo(info)
    if (focus !== undefined) setGameFocused(focus)
    broadcastGep()
    const items = normalizeInventory(info)
    if (items.length) {
      pending = items
      scheduleFlush()
    }
  })

  api.on('game-exit', (_e: unknown, gameId: number, name?: string) => {
    console.log('[AOWA-GEP] game-exit', gameId, name)
    if (infoPollTimer) {
      clearInterval(infoPollTimer)
      infoPollTimer = null
    }
    gep.gameRunning = false
    setGameFocused(false) // game gone → hide the top bar
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
  // Windows groups taskbar buttons and picks the taskbar/notification icon by
  // AppUserModelID; the packaged app must match the NSIS appId so the running
  // app and its installed shortcut share one taskbar slot + icon (#51).
  // PACKAGED ONLY: in dev, adopting this AUMID makes Windows show the *installed*
  // shortcut's icon (the old placeholder, if a prior build was installed) instead
  // of the live window icon — so leave dev on the default AUMID and let the
  // window's NativeImage icon win.
  if (process.platform === 'win32' && app.isPackaged) app.setAppUserModelId('io.ashguard.aowa-agent')

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
  // Custom-titlebar window controls (#53). Close hides to tray (the app lives in
  // the tray; reopen from its menu) rather than quitting.
  ipcMain.handle('aowa:win:minimize', () => dashboard?.minimize())
  ipcMain.handle('aowa:win:maximize', () => {
    if (!dashboard) return false
    if (dashboard.isMaximized()) dashboard.unmaximize()
    else dashboard.maximize()
    return dashboard.isMaximized()
  })
  ipcMain.handle('aowa:win:close', () => dashboard?.close())
  ipcMain.handle('aowa:win:isMaximized', () => dashboard?.isMaximized() ?? false)
  ipcMain.handle('aowa:gep', () => gepState())
  ipcMain.handle('aowa:sync', () => lastSync)
  ipcMain.handle('aowa:currencies', () => lastCurrencies)
  ipcMain.handle('aowa:activity', () => activity)
  ipcMain.handle('aowa:hotkey', () => ({ hotkey, label: hotkeyLabel(hotkey) }))
  ipcMain.handle('aowa:hotkey:set', (_e, h: HotkeyBinding) => {
    setHotkey(h)
    return { hotkey, label: hotkeyLabel(hotkey) }
  })
  ipcMain.handle('aowa:open-aowa', () => shell.openExternal('https://aowa.ashguard.io/profile'))
  // Open a saved build's page in the browser (#37). Web base = API_BASE minus /api.
  ipcMain.handle('aowa:open-build', (_e, slug: string) => {
    const web = API_BASE.replace(/\/api\/?$/, '')
    return shell.openExternal(`${web}/build/${encodeURIComponent(String(slug))}`)
  })
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

  // Overlay config (#60/#61): which sections show + whether the top bar is on.
  const broadcastOverlayConfig = (cfg: OverlayConfig) => {
    for (const w of [dashboard, topbar]) w?.webContents.send('aowa:overlay:config', cfg)
  }
  ipcMain.handle('aowa:overlay:config', () => loadOverlayConfig())
  ipcMain.handle('aowa:overlay:config:set', (_e, cfg: OverlayConfig) => {
    saveOverlayConfig(cfg)
    applyTopbar(cfg.topbar)
    setHudVisible(cfg.hud) // show/hide the in-game HUD live
    broadcastOverlayConfig(cfg)
    return cfg
  })
  // The user's fissure subscriptions (via bearer) — the top bar shows only these.
  ipcMain.handle('aowa:subscriptions', async () => {
    const token = loadToken()
    if (!token) return []
    try {
      return await fetchSubscriptions(token)
    } catch {
      return []
    }
  })
  // Personal data via the stored agent token (backend #37). Returns paired:false
  // when unlinked; drops the token if the server rejects it.
  ipcMain.handle('aowa:me', async () => {
    const token = loadToken()
    if (!token) return { paired: false }
    try {
      // Builds is best-effort: a failure there shouldn't blank todos/relics.
      const [todos, relics, builds] = await Promise.all([
        fetchTodos(token),
        fetchOwnedRelics(token),
        fetchBuilds(token).catch((e) => {
          if (e instanceof UnauthorizedError) throw e
          return []
        }),
      ])
      return { paired: true, todos, relics, builds }
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
              hudEnabled: () => loadOverlayConfig().hud,
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
    applyTopbar(loadOverlayConfig().topbar) // restore top bar (stays hidden until Warframe is focused, #60)
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
