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
  at: number
}
import type { Cycle, WorldState } from '../lib/aowa-data'
import type { Todo } from '../lib/api'

export interface MeData {
  paired: boolean
  todos?: Todo[]
  relics?: Record<string, number>
}

export interface AowaBridge {
  status(): Promise<AgentStatus>
  gep(): Promise<GepState>
  sync(): Promise<SyncState | null>
  activity(): Promise<Activity[]>
  getHotkey(): Promise<HotkeyInfo>
  setHotkey(h: HotkeyBinding): Promise<HotkeyInfo>
  pair(code: string): Promise<{ ok: boolean; error?: string }>
  unpair(): Promise<void>
  openAowa(): Promise<void>
  worldState(): Promise<{ ws: WorldState | null; cycles: Cycle[] | null }>
  me(): Promise<MeData>
  onStatus(cb: (s: AgentStatus) => void): void
  onGep(cb: (s: GepState) => void): void
  onSync(cb: (s: SyncState | null) => void): void
  onActivity(cb: (a: Activity[]) => void): void
}
declare global {
  interface Window {
    aowa: AowaBridge
  }
}
export {}
