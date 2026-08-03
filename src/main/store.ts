// Token persistence in the main process (a small JSON file in userData).
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HotkeyBinding } from './hotkey'

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

// Overlay sections the user can toggle on/off (#61). Applies to the top-bar
// overlay (#60) and the HUD.
export type OverlaySection = 'cycles' | 'baro' | 'fissures' | 'sortie' | 'archon'
export const OVERLAY_SECTIONS: OverlaySection[] = ['cycles', 'baro', 'fissures', 'sortie', 'archon']
export interface OverlayConfig {
  sections: Record<OverlaySection, boolean>
  topbar: boolean // is the always-on top bar shown (#60)
  hud: boolean // does the in-game HUD auto-show when Warframe injects
}
const DEFAULT_OVERLAY: OverlayConfig = {
  sections: { cycles: true, baro: true, fissures: true, sortie: false, archon: false },
  topbar: false,
  // The big in-game HUD panel is OFF by default now — the slim top bar (#60) is
  // the primary overlay. Enable the HUD from the dashboard if you want it.
  hud: false,
}

interface State {
  token?: string
  hotkey?: HotkeyBinding
  overlayBounds?: Bounds
  overlay?: OverlayConfig
}

const file = () => join(app.getPath('userData'), 'agent.json')

function read(): State {
  try {
    return existsSync(file()) ? (JSON.parse(readFileSync(file(), 'utf8')) as State) : {}
  } catch {
    return {}
  }
}
function write(s: State): void {
  writeFileSync(file(), JSON.stringify(s))
}

export const loadToken = (): string | null => read().token ?? null
export const saveToken = (t: string): void => write({ ...read(), token: t })
export const clearToken = (): void => {
  const s = read()
  delete s.token
  write(s)
}

export const loadHotkey = (): HotkeyBinding | null => read().hotkey ?? null
export const saveHotkey = (h: HotkeyBinding): void => write({ ...read(), hotkey: h })

export const loadOverlayBounds = (): Bounds | null => read().overlayBounds ?? null
export const saveOverlayBounds = (b: Bounds): void => write({ ...read(), overlayBounds: b })

export const loadOverlayConfig = (): OverlayConfig => {
  const o = read().overlay
  // hud defaults OFF: only enabled when explicitly turned on (so existing users
  // stop seeing the old in-game HUD panel unless they opt back in).
  return o
    ? { sections: { ...DEFAULT_OVERLAY.sections, ...o.sections }, topbar: !!o.topbar, hud: o.hud === true }
    : { ...DEFAULT_OVERLAY, sections: { ...DEFAULT_OVERLAY.sections } }
}
export const saveOverlayConfig = (o: OverlayConfig): void => write({ ...read(), overlay: o })
