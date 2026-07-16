// Shared bridge between the background controller and the settings window.
// Overwolf app windows share one JS origin; the background window is the app's
// "main window", so it publishes state and control hooks on its global object
// and the settings window reaches them via overwolf.windows.getMainWindow().

export type AgentState = 'unpaired' | 'connected' | 'syncing' | 'error'

export interface AowaState {
  state: AgentState
  detail: string
}

export interface MainBridge {
  aowaState?: AowaState
  // Exchange a pairing code for a token and start syncing. Resolves once the
  // attempt completes (state reflects success/failure).
  aowaPairWithCode?: (code: string) => Promise<void>
  // Stop syncing and drop the stored token.
  aowaUnpair?: () => void
}

// bridge returns the background window's shared object (may be missing hooks if
// the background window hasn't finished initializing yet).
export function bridge(): MainBridge {
  try {
    return overwolf.windows.getMainWindow() as unknown as MainBridge
  } catch {
    return {}
  }
}
