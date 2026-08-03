// Overwolf overlay-package integration (in-game overlay + hotkey).
//
// Unlike a plain transparent BrowserWindow (which a fullscreen game paints over),
// the Overwolf overlay package injects a real in-game window and owns a hotkey
// that survives exclusive fullscreen. We:
//   - register Warframe for overlay injection,
//   - inject on game-launched, create our HUD window on game-injected,
//   - register the toggle hotkey through overlay.hotkeys (rebindable from the GUI),
//   - make the window movable and persist its position.
//
// Typed structurally against @overwolf/ow-electron-packages-types so we don't
// take a runtime dependency on a package that only exists inside ow-electron.
import { WARFRAME_GAME_ID } from '../lib/config'
import type { HotkeyBinding } from './hotkey'
import type { Bounds } from './store'

interface OWindow {
  name: string
  window: {
    show?(): void
    hide?(): void
    restore?(): void
    isVisible?(): boolean
    setBounds?(b: Bounds): void
    getBounds?(): Bounds
    on?(event: string, cb: () => void): void
    loadURL?(url: string): Promise<unknown>
    loadFile?(path: string): Promise<unknown>
    // ow-electron's overlay window wraps a real Electron BrowserWindow, so its
    // webContents lets main push IPC (e.g. live overlay-config updates) to it.
    webContents?: { send(channel: string, ...args: unknown[]): void }
  }
}

interface OverlayApi {
  registerGames(filter: { gamesIds?: number[]; all?: boolean; includeUnsupported?: boolean }): void
  createWindow(options: Record<string, unknown>): Promise<OWindow>
  getAllWindows(): OWindow[]
  removeAllListeners?(): void
  on(event: string, cb: (...args: unknown[]) => void): void
  hotkeys: {
    register(hk: Record<string, unknown>, cb: (hk: unknown, state: string) => void): void
    update(hk: Record<string, unknown>): boolean
    unregister(name: string): boolean
  }
}

const WINDOW_NAME = 'aowa-overlay'
const HOTKEY_NAME = 'toggle-overlay'

let api: OverlayApi | null = null
let current: HotkeyBinding
let loadOverlay: ((win: OWindow) => void) | null = null
let baseOptions: Record<string, unknown> = {}
// Whether the top bar should auto-show when Warframe injects (#60/#61 toggle).
let enabled: () => boolean = () => true
// The top-strip bounds (full-width, thin, top of screen).
let boundsOf: () => Bounds = () => ({ x: 0, y: 0, width: 1920, height: 34 })

function toOverlayHotkey(h: HotkeyBinding): Record<string, unknown> {
  return {
    name: HOTKEY_NAME,
    keyCode: h.code,
    modifiers: { alt: !!h.alt, ctrl: !!h.ctrl, shift: !!h.shift, meta: !!h.meta },
    passthrough: false, // captured exclusively by the overlay, not sent to the game
  }
}

function findWindow(): OWindow | null {
  try {
    return api?.getAllWindows().find((w) => w.name === WINDOW_NAME) ?? null
  } catch {
    return null
  }
}

async function ensureWindow(autoShow = true): Promise<void> {
  if (!api || !loadOverlay) return
  if (findWindow()) return
  try {
    const win = await api.createWindow({ ...baseOptions, name: WINDOW_NAME })
    loadOverlay(win)
    win.window.setBounds?.(boundsOf()) // dock the strip to the top
    if (autoShow) win.window.show?.()
    else win.window.hide?.()
  } catch (e) {
    console.error('[AOWA-OV] createWindow failed', e)
  }
}

// Show/hide the top-bar overlay live when the user toggles it (#60/#61).
export function setOverlayVisible(show: boolean, bounds?: Bounds): void {
  const w = findWindow()
  if (!w) {
    if (show) void ensureWindow(true)
    return
  }
  if (bounds) w.window.setBounds?.(bounds)
  if (show) (w.window.restore ?? w.window.show)?.call(w.window)
  else w.window.hide?.()
}

// Push an IPC message to the live top-bar overlay window, so config changes
// (section toggles, the #65 background toggle) update it without a reload. No-op
// if the overlay window doesn't exist yet (it re-reads config on next create).
export function sendToOverlay(channel: string, ...args: unknown[]): void {
  try {
    findWindow()?.window.webContents?.send(channel, ...args)
  } catch (e) {
    console.error('[AOWA-OV] sendToOverlay failed', e)
  }
}

export function toggleOverlayWindow(): void {
  const w = findWindow()
  if (!w) {
    void ensureWindow()
    return
  }
  if (w.window.isVisible?.()) w.window.hide?.()
  else (w.window.restore ?? w.window.show)?.call(w.window)
}

function registerHotkey(): void {
  if (!api) return
  try {
    api.hotkeys.register(toOverlayHotkey(current), (_hk, state) => {
      if (state === 'pressed') toggleOverlayWindow()
    })
  } catch (e) {
    console.error('[AOWA-OV] hotkey register failed', e)
  }
}

// Rebind the overlay hotkey (from the GUI). No-op if the overlay package isn't
// ready yet — main also persists the binding and re-applies on next init.
export function setOverlayHotkey(h: HotkeyBinding): void {
  current = h
  if (!api) return
  try {
    if (!api.hotkeys.update(toOverlayHotkey(h))) registerHotkey()
  } catch (e) {
    console.error('[AOWA-OV] hotkey update failed', e)
  }
}

export function initOverlay(
  overlayApi: OverlayApi,
  deps: {
    hotkey: HotkeyBinding
    baseWindowOptions: Record<string, unknown>
    loadOverlay: (win: OWindow) => void
    enabled?: () => boolean
    bounds?: () => Bounds
  },
): void {
  api = overlayApi
  current = deps.hotkey
  baseOptions = deps.baseWindowOptions
  loadOverlay = deps.loadOverlay
  if (deps.enabled) enabled = deps.enabled
  if (deps.bounds) boundsOf = deps.bounds

  try {
    api.removeAllListeners?.()
  } catch {
    /* ignore */
  }
  try {
    api.registerGames({ gamesIds: [WARFRAME_GAME_ID] })
  } catch (e) {
    console.error('[AOWA-OV] registerGames failed', e)
  }

  api.on('game-launched', (event: unknown, info: unknown) => {
    console.log('[AOWA-OV] game-launched', (info as { id?: number })?.id)
    try {
      ;(event as { inject: () => void }).inject()
    } catch (e) {
      console.error('[AOWA-OV] inject failed', e)
    }
  })
  api.on('game-injected', (info: unknown) => {
    console.log('[AOWA-OV] game-injected', (info as { id?: number })?.id)
    void ensureWindow(enabled()) // only auto-show the top bar if enabled (#60/#61)
  })
  api.on('game-injection-error', (_info: unknown, error: unknown) =>
    console.error('[AOWA-OV] injection-error', error),
  )
  api.on('game-exit', () => console.log('[AOWA-OV] game-exit'))

  registerHotkey()
}
