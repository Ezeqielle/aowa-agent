// The API exposed by preload (contextBridge) on the renderer's window.
export interface AgentStatus {
  paired: boolean
}
import type { Cycle, WorldState } from '../lib/aowa-data'

export interface AowaBridge {
  status(): Promise<AgentStatus>
  pair(code: string): Promise<{ ok: boolean; error?: string }>
  unpair(): Promise<void>
  openAowa(): Promise<void>
  worldState(): Promise<{ ws: WorldState; cycles: Cycle[] }>
  onStatus(cb: (s: AgentStatus) => void): void
}
declare global {
  interface Window {
    aowa: AowaBridge
  }
}
export {}
