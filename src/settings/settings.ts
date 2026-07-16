// Settings window: shows connection status, lets the user open AOWA to pair,
// paste a one-time code manually (fallback when the aowa:// deep link doesn't
// fire), or unpair. Pairing/unpairing is delegated to the background controller
// via the shared bridge so the GEP feed starts/stops correctly.
import { bridge, type AowaState } from '../lib/bridge'
import { isPaired } from '../lib/storage'

const AOWA_PROFILE_URL = 'https://aowa.ashguard.io/profile'

const $ = (id: string) => document.getElementById(id) as HTMLElement

function readState(): AowaState {
  const s = bridge().aowaState
  if (s) return s
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

async function pairManually(): Promise<void> {
  const input = $('code') as HTMLInputElement
  const code = input.value.trim()
  if (!code) return
  const pairFn = bridge().aowaPairWithCode
  if (!pairFn) {
    $('detail').textContent = 'Agent is still starting — try again in a moment.'
    return
  }
  ;($('pair') as HTMLButtonElement).disabled = true
  try {
    await pairFn(code)
    input.value = ''
  } finally {
    ;($('pair') as HTMLButtonElement).disabled = false
    render()
  }
}

function main(): void {
  $('open-aowa').addEventListener('click', () => {
    overwolf.utils.openUrlInDefaultBrowser(AOWA_PROFILE_URL)
  })
  $('pair').addEventListener('click', () => void pairManually())
  ;($('code') as HTMLInputElement).addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void pairManually()
  })
  $('unpair').addEventListener('click', () => {
    bridge().aowaUnpair?.()
    render()
  })
  render()
  window.setInterval(render, 1000)
}

main()
