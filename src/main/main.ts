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
import { normalizeInventory } from '../lib/inventory'
import { extractPairCode } from '../lib/deeplink'
import { fetchCycles, fetchWorldState } from '../lib/aowa-data'
import { clearToken, loadToken, saveToken } from './store'

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
    }
  }
}

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
  try {
    await ingestInventory(token, items)
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

function initGep(): void {
  const api = owApp.overwolf.packages.gep
  if (!api) return
  api.removeAllListeners?.()

  api.on('game-detected', (e: { enable(): void }, gameId: number, name?: string) => {
    console.log('[AOWA-GEP] game-detected', gameId, name)
    // During discovery, enable Warframe by id OR name so we can confirm the id.
    if (gameId === WARFRAME_GAME_ID || /warframe/i.test(String(name ?? ''))) {
      e.enable()
      // null = all available features (discovery); narrow to GEP_FEATURES later.
      void api.setRequiredFeatures(gameId, null)
      gep.gameRunning = true
      broadcastGep()
    }
  })

  api.on('new-info-update', (_e: unknown, gameId: number, info: Record<string, unknown>) => {
    if (DEBUG_GEP) console.log('[AOWA-GEP] new-info-update', gameId, JSON.stringify(info))
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
  ipcMain.handle('aowa:open-aowa', () => shell.openExternal('https://aowa.ashguard.io/profile'))
  // Fetched in main (Node) so the renderer isn't blocked by CORS.
  ipcMain.handle('aowa:worldstate', async () => {
    const [ws, cycles] = await Promise.all([fetchWorldState(), fetchCycles()])
    return { ws, cycles }
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

  app.whenReady().then(() => {
    try {
      // The gep package object only exists once its 'ready' event fires — never
      // touch owApp.overwolf.packages.gep synchronously at startup.
      owApp.overwolf.packages.on('ready', (_e: unknown, name: string, version: string) => {
        console.log('[AOWA-GEP] package ready:', name, version)
        if (name === 'gep') initGep()
      })
    } catch (e) {
      console.error('[AOWA] GEP wiring failed (ok outside ow-electron):', e)
    }
    createTray()
    createDashboard()
    globalShortcut.register('Alt+Shift+A', toggleOverlay)
    handleDeepLink(process.argv) // cold-start deep link
  })

  app.on('window-all-closed', () => {
    // Stay alive in the tray; quit explicitly via the tray menu.
  })
}
