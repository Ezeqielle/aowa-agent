// The API exposed by preload (contextBridge) on the renderer's window.
export interface AgentStatus {
  paired: boolean
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
  pair(code: string): Promise<{ ok: boolean; error?: string }>
  unpair(): Promise<void>
  openAowa(): Promise<void>
  worldState(): Promise<{ ws: WorldState; cycles: Cycle[] }>
  me(): Promise<MeData>
  onStatus(cb: (s: AgentStatus) => void): void
}
declare global {
  interface Window {
    aowa: AowaBridge
  }
}
export {}
