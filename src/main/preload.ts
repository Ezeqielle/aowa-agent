// Preload: exposes a minimal, safe API to the renderer (contextIsolation on).
import { contextBridge, ipcRenderer } from 'electron'

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

contextBridge.exposeInMainWorld('aowa', {
  status: (): Promise<AgentStatus> => ipcRenderer.invoke('aowa:status'),
  gep: (): Promise<GepState> => ipcRenderer.invoke('aowa:gep'),
  activity: (): Promise<Activity[]> => ipcRenderer.invoke('aowa:activity'),
  getHotkey: (): Promise<HotkeyInfo> => ipcRenderer.invoke('aowa:hotkey'),
  setHotkey: (h: HotkeyBinding): Promise<HotkeyInfo> => ipcRenderer.invoke('aowa:hotkey:set', h),
  pair: (code: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('aowa:pair', code),
  unpair: (): Promise<void> => ipcRenderer.invoke('aowa:unpair'),
  openAowa: (): Promise<void> => ipcRenderer.invoke('aowa:open-aowa'),
  worldState: (): Promise<unknown> => ipcRenderer.invoke('aowa:worldstate'),
  me: (): Promise<unknown> => ipcRenderer.invoke('aowa:me'),
  onStatus: (cb: (s: AgentStatus) => void) => {
    ipcRenderer.on('aowa:status', (_e, s: AgentStatus) => cb(s))
  },
  onGep: (cb: (s: GepState) => void) => {
    ipcRenderer.on('aowa:gep', (_e, s: GepState) => cb(s))
  },
  onActivity: (cb: (a: Activity[]) => void) => {
    ipcRenderer.on('aowa:activity', (_e, a: Activity[]) => cb(a))
  },
})
