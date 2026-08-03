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

export type OverlaySection = 'cycles' | 'baro' | 'fissures' | 'sortie' | 'archon'
export interface OverlayConfig {
  sections: Record<OverlaySection, boolean>
  topbar: boolean
}
export interface Subscription {
  eventKind: string
  leadMinutes: number
  enabled: boolean
  filter?: { tier?: string; missionType?: string; steelPath?: boolean; railjack?: boolean }
}

contextBridge.exposeInMainWorld('aowa', {
  overlayConfig: (): Promise<OverlayConfig> => ipcRenderer.invoke('aowa:overlay:config'),
  setOverlayConfig: (c: OverlayConfig): Promise<OverlayConfig> => ipcRenderer.invoke('aowa:overlay:config:set', c),
  onOverlayConfig: (cb: (c: OverlayConfig) => void) => {
    ipcRenderer.on('aowa:overlay:config', (_e, c: OverlayConfig) => cb(c))
  },
  subscriptions: (): Promise<Subscription[]> => ipcRenderer.invoke('aowa:subscriptions'),
  status: (): Promise<AgentStatus> => ipcRenderer.invoke('aowa:status'),
  gep: (): Promise<GepState> => ipcRenderer.invoke('aowa:gep'),
  sync: (): Promise<SyncState | null> => ipcRenderer.invoke('aowa:sync'),
  currencies: (): Promise<Currencies | null> => ipcRenderer.invoke('aowa:currencies'),
  activity: (): Promise<Activity[]> => ipcRenderer.invoke('aowa:activity'),
  getHotkey: (): Promise<HotkeyInfo> => ipcRenderer.invoke('aowa:hotkey'),
  setHotkey: (h: HotkeyBinding): Promise<HotkeyInfo> => ipcRenderer.invoke('aowa:hotkey:set', h),
  pair: (code: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('aowa:pair', code),
  unpair: (): Promise<void> => ipcRenderer.invoke('aowa:unpair'),
  openAowa: (): Promise<void> => ipcRenderer.invoke('aowa:open-aowa'),
  openBuild: (slug: string): Promise<void> => ipcRenderer.invoke('aowa:open-build', slug),
  worldState: (): Promise<unknown> => ipcRenderer.invoke('aowa:worldstate'),
  me: (): Promise<unknown> => ipcRenderer.invoke('aowa:me'),
  onStatus: (cb: (s: AgentStatus) => void) => {
    ipcRenderer.on('aowa:status', (_e, s: AgentStatus) => cb(s))
  },
  onGep: (cb: (s: GepState) => void) => {
    ipcRenderer.on('aowa:gep', (_e, s: GepState) => cb(s))
  },
  // Custom-titlebar window controls (#53).
  winMinimize: (): Promise<void> => ipcRenderer.invoke('aowa:win:minimize'),
  winMaximize: (): Promise<boolean> => ipcRenderer.invoke('aowa:win:maximize'),
  winClose: (): Promise<void> => ipcRenderer.invoke('aowa:win:close'),
  winIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('aowa:win:isMaximized'),
  onWinMaximized: (cb: (max: boolean) => void) => {
    ipcRenderer.on('aowa:win:maximized', (_e, max: boolean) => cb(max))
  },
  onSync: (cb: (s: SyncState | null) => void) => {
    ipcRenderer.on('aowa:sync', (_e, s: SyncState | null) => cb(s))
  },
  onCurrencies: (cb: (c: Currencies | null) => void) => {
    ipcRenderer.on('aowa:currencies', (_e, c: Currencies | null) => cb(c))
  },
  onActivity: (cb: (a: Activity[]) => void) => {
    ipcRenderer.on('aowa:activity', (_e, a: Activity[]) => cb(a))
  },
})
