// Background controller (invisible window, always running while the game is up).
// Responsibilities:
//   1. Receive the pairing code from the `aowa://pair?code=` deep link and
//      exchange it for a long-lived agent token.
//   2. Subscribe to the Warframe GEP inventory feed and push debounced snapshots
//      to AOWA using the token.
//   3. Drop the token and return to unpaired if AOWA reports it revoked.
import { INGEST_DEBOUNCE_MS } from '../lib/config'
import { ingestInventory, pair, UnauthorizedError, type IngestItem } from '../lib/api'
import { clearToken, loadToken, saveToken } from '../lib/storage'
import { onPairCode, startInventoryFeed } from '../lib/overwolf'

type State = 'unpaired' | 'connected' | 'syncing' | 'error'

let stopFeed: (() => void) | null = null
let pendingItems: IngestItem[] | null = null
let flushTimer: number | null = null

function log(msg: string): void {
  // Console is inspectable via Overwolf's dev tools; a real build would also
  // surface recent lines to the settings window.
  console.log(`[aowa-agent] ${msg}`)
}

function setState(state: State, detail = ''): void {
  log(`state=${state} ${detail}`.trim())
  // Cross-window notification hook — the settings window reads this.
  ;(overwolf.windows.getMainWindow() as unknown as { aowaState?: { state: State; detail: string } }).aowaState = {
    state,
    detail,
  }
}

// scheduleFlush coalesces a burst of GEP updates into a single POST.
function scheduleFlush(): void {
  if (flushTimer != null) return
  flushTimer = window.setTimeout(flush, INGEST_DEBOUNCE_MS)
}

async function flush(): Promise<void> {
  flushTimer = null
  const items = pendingItems
  pendingItems = null
  if (!items || !items.length) return
  const token = loadToken()
  if (!token) return
  try {
    setState('syncing')
    const res = await ingestInventory(token, items)
    setState('connected', `synced ${res.received} items (${res.relics} relics, ${res.gear} gear)`)
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      log('token revoked — returning to unpaired')
      teardown()
      clearToken()
      setState('unpaired', 'agent was revoked; link again from AOWA')
      return
    }
    setState('error', String(e))
  }
}

function onInventory(items: IngestItem[]): void {
  pendingItems = items // absolute snapshot — latest wins
  scheduleFlush()
}

function startFeed(): void {
  if (stopFeed) return
  stopFeed = startInventoryFeed(onInventory, (msg) => setState('error', msg))
  setState('connected', 'watching inventory')
}

function teardown(): void {
  if (stopFeed) {
    stopFeed()
    stopFeed = null
  }
  if (flushTimer != null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  pendingItems = null
}

async function handlePairing(code: string): Promise<void> {
  try {
    setState('unpaired', 'pairing…')
    const { token } = await pair(code)
    saveToken(token)
    log('paired successfully')
    startFeed()
  } catch (e) {
    setState('error', `pairing failed: ${e}`)
  }
}

function main(): void {
  onPairCode((code) => void handlePairing(code))
  if (loadToken()) {
    log('existing token found — starting feed')
    startFeed()
  } else {
    setState('unpaired', 'not linked — open AOWA → Profile → Link agent')
  }
}

main()
