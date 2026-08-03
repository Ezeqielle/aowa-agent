// The API exposed by preload (contextBridge) on the renderer's window.
export interface AgentStatus {
  paired: boolean
}
export interface GepState {
  gameRunning: boolean
  lastUpdate: number
}
export interface HotkeyBinding {
  code: string
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  meta?: boolean
}
export interface HotkeyInfo {
  hotkey: HotkeyBinding
  label: string
}
export interface Activity {
  kind: string
  label: string
  detail?: string
  at: number
}
export interface SyncState {
  relics: number
  gear: number
  mastered: number
  received: number
  currency: boolean
  parts: number
  quests: number
  starChart: number
  at: number
}
export interface Currencies {
  credits?: number
  platinum?: number
  ducats?: number
  endo?: number
}
import type { Cycle, WorldState } from '../lib/aowa-data'
import type { Build, Todo } from '../lib/api'

export interface MeData {
  paired: boolean
  todos?: Todo[]
  relics?: Record<string, number>
  builds?: Build[]
}

export type OverlaySection = 'cycles' | 'baro' | 'fissures' | 'sortie' | 'archon'
export interface OverlayConfig {
  sections: Record<OverlaySection, boolean>
  topbar: boolean
  hud: boolean
}
export interface Subscription {
  eventKind: string
  leadMinutes: number
  enabled: boolean
  filter?: { tier?: string; missionType?: string; steelPath?: boolean; railjack?: boolean }
}

export interface AowaBridge {
  overlayConfig(): Promise<OverlayConfig>
  setOverlayConfig(c: OverlayConfig): Promise<OverlayConfig>
  onOverlayConfig(cb: (c: OverlayConfig) => void): void
  subscriptions(): Promise<Subscription[]>
  status(): Promise<AgentStatus>
  gep(): Promise<GepState>
  sync(): Promise<SyncState | null>
  currencies(): Promise<Currencies | null>
  activity(): Promise<Activity[]>
  getHotkey(): Promise<HotkeyInfo>
  setHotkey(h: HotkeyBinding): Promise<HotkeyInfo>
  pair(code: string): Promise<{ ok: boolean; error?: string }>
  unpair(): Promise<void>
  openAowa(): Promise<void>
  openBuild(slug: string): Promise<void>
  worldState(): Promise<{ ws: WorldState | null; cycles: Cycle[] | null }>
  me(): Promise<MeData>
  onStatus(cb: (s: AgentStatus) => void): void
  onGep(cb: (s: GepState) => void): void
  winMinimize(): Promise<void>
  winMaximize(): Promise<boolean>
  winClose(): Promise<void>
  winIsMaximized(): Promise<boolean>
  onWinMaximized(cb: (max: boolean) => void): void
  onSync(cb: (s: SyncState | null) => void): void
  onCurrencies(cb: (c: Currencies | null) => void): void
  onActivity(cb: (a: Activity[]) => void): void
}
declare global {
  interface Window {
    aowa: AowaBridge
  }
}
export {}
