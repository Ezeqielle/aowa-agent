// Preload: exposes a minimal, safe API to the renderer (contextIsolation on).
import { contextBridge, ipcRenderer } from 'electron'

export interface AgentStatus {
  paired: boolean
}

contextBridge.exposeInMainWorld('aowa', {
  status: (): Promise<AgentStatus> => ipcRenderer.invoke('aowa:status'),
  pair: (code: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('aowa:pair', code),
  unpair: (): Promise<void> => ipcRenderer.invoke('aowa:unpair'),
  openAowa: (): Promise<void> => ipcRenderer.invoke('aowa:open-aowa'),
  worldState: (): Promise<unknown> => ipcRenderer.invoke('aowa:worldstate'),
  onStatus: (cb: (s: AgentStatus) => void) => {
    ipcRenderer.on('aowa:status', (_e, s: AgentStatus) => cb(s))
  },
})
