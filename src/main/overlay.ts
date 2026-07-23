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
import { loadOverlayBounds, saveOverlayBounds, type Bounds } from './store'

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

function persistBounds(win: OWindow): void {
  win.window.on?.('moved', () => {
    const b = win.window.getBounds?.()
    if (b) saveOverlayBounds(b)
  })
}

async function ensureWindow(): Promise<void> {
  if (!api || !loadOverlay) return
  if (findWindow()) return
  try {
    const win = await api.createWindow({ ...baseOptions, name: WINDOW_NAME })
    loadOverlay(win)
    const saved = loadOverlayBounds()
    if (saved) win.window.setBounds?.(saved)
    persistBounds(win)
    win.window.show?.()
  } catch (e) {
    console.error('[AOWA-OV] createWindow failed', e)
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
  deps: { hotkey: HotkeyBinding; baseWindowOptions: Record<string, unknown>; loadOverlay: (win: OWindow) => void },
): void {
  api = overlayApi
  current = deps.hotkey
  baseOptions = deps.baseWindowOptions
  loadOverlay = deps.loadOverlay

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
    void ensureWindow()
  })
  api.on('game-injection-error', (_info: unknown, error: unknown) =>
    console.error('[AOWA-OV] injection-error', error),
  )
  api.on('game-exit', () => console.log('[AOWA-OV] game-exit'))

  registerHotkey()
}
