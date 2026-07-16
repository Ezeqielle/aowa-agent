// Settings window: shows connection status and lets the user open AOWA to pair,
// or unpair this device. State is published by the background controller on the
// shared main-window object; we poll it for display.
import { clearToken, isPaired } from '../lib/storage'

const AOWA_PROFILE_URL = 'https://aowa.ashguard.io/profile'

interface AowaState {
  state: 'unpaired' | 'connected' | 'syncing' | 'error'
  detail: string
}

const $ = (id: string) => document.getElementById(id) as HTMLElement

function readState(): AowaState {
  try {
    const main = overwolf.windows.getMainWindow() as unknown as { aowaState?: AowaState }
    if (main.aowaState) return main.aowaState
  } catch {
    /* background window not reachable yet */
  }
  return { state: isPaired() ? 'connected' : 'unpaired', detail: '' }
}

const DOT: Record<AowaState['state'], string> = {
  unpaired: '#6b7280',
  connected: '#22c55e',
  syncing: '#eab308',
  error: '#ef4444',
}
const LABEL: Record<AowaState['state'], string> = {
  unpaired: 'Not linked',
  connected: 'Connected',
  syncing: 'Syncing…',
  error: 'Error',
}

function render(): void {
  const s = readState()
  $('dot').style.background = DOT[s.state]
  $('status').textContent = LABEL[s.state]
  $('detail').textContent = s.detail
  ;($('unpair') as HTMLButtonElement).disabled = !isPaired()
}

function main(): void {
  $('open-aowa').addEventListener('click', () => {
    overwolf.utils.openUrlInDefaultBrowser(AOWA_PROFILE_URL)
  })
  $('unpair').addEventListener('click', () => {
    clearToken()
    render()
  })
  render()
  window.setInterval(render, 1000)
}

main()
