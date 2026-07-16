// Thin, typed wrappers over the Overwolf APIs the agent needs: the deep-link
// pairing code and the Game Events Provider (GEP) inventory feed.
import { DEBUG_GEP, REQUIRED_FEATURES, URL_SCHEME } from './config'
import type { IngestItem } from './api'
import { normalizeInventory } from './inventory'

// Greppable console tag for the on-device GEP capture (see README step 4).
const TAG = '[AOWA-GEP]'

// dump logs a value with the raw string, a parsed-JSON attempt (GEP often
// stringifies), so the real payload shape is easy to read off DevTools.
function dump(label: string, value: unknown): void {
  if (!DEBUG_GEP) return
  let parsed: unknown = undefined
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      /* not JSON */
    }
  }
  // eslint-disable-next-line no-console
  console.log(TAG, label, { raw: value, parsed })
}

// extractPairCode pulls the code out of an `aowa://pair?code=XXXX` deep link.
export function extractPairCode(rawUrl: string): string | null {
  if (!rawUrl || !rawUrl.startsWith(`${URL_SCHEME}://`)) return null
  try {
    // aowa://pair?code=XXXX → treat the part after the scheme as a URL.
    const u = new URL(rawUrl.replace(`${URL_SCHEME}://`, 'https://'))
    if (!u.pathname.replace(/\//g, '').startsWith('pair') && u.host !== 'pair') return null
    const code = u.searchParams.get('code')
    return code && code.trim() ? code.trim() : null
  } catch {
    return null
  }
}

// onPairCode fires cb with a pairing code from either a cold-start launch
// parameter or a subsequent `onAppLaunchTriggered` (app already running).
export function onPairCode(cb: (code: string) => void): void {
  // Cold start: the launch URL may arrive as this window's query string.
  const fromQuery = new URLSearchParams(location.search).get('source')
  if (fromQuery) {
    const code = extractPairCode(decodeURIComponent(fromQuery))
    if (code) cb(code)
  }
  // Warm start: the OS routed a new `aowa://` link into the running app.
  overwolf.extensions.onAppLaunchTriggered.addListener((e) => {
    if (e.origin === 'urlscheme' && e.parameter) {
      const code = extractPairCode(e.parameter)
      if (code) cb(code)
    }
  })
}

// startInventoryFeed subscribes to the Warframe GEP inventory feature and calls
// onInventory with a normalized item list whenever it updates. Returns a stop().
//
// NOTE: the exact shape of the GEP `inventory` payload for Warframe must be
// confirmed with Overwolf's GEP sample app; normalizeInventory() encapsulates
// that assumption so only one place changes once the real shape is known.
export function startInventoryFeed(
  onInventory: (items: IngestItem[]) => void,
  onError: (msg: string) => void,
): () => void {
  // One-time: log the running game so the real id/classId can be confirmed
  // against manifest game_ids (WARFRAME_CLASS_ID).
  if (DEBUG_GEP) overwolf.games.getRunningGameInfo((g) => dump('getRunningGameInfo', g))

  overwolf.games.events.setRequiredFeatures([...REQUIRED_FEATURES], (result) => {
    if (DEBUG_GEP) dump('setRequiredFeatures result', result)
    if (!result.success) {
      onError(`setRequiredFeatures failed: ${result.error ?? 'unknown'}`)
      return
    }
    // Pull the current snapshot immediately (GEP only pushes deltas afterwards).
    overwolf.games.events.getInfo((info) => {
      if (DEBUG_GEP) dump('getInfo res', info.res)
      if (info.success && info.res) {
        const items = normalizeInventory(info.res)
        if (DEBUG_GEP) dump('getInfo → normalized', items)
        if (items.length) onInventory(items)
      }
    })
  })

  const handler = (update: overwolf.games.events.InfoUpdate) => {
    // Log EVERY feature's raw payload so the capture shows what Warframe exposes
    // (not just inventory) — this is the shape to send back for normalizer tuning.
    if (DEBUG_GEP) dump(`onInfoUpdates2 [${update.feature}]`, update.info)
    if (update.feature !== 'inventory') return
    const items = normalizeInventory(update.info)
    if (DEBUG_GEP) dump('inventory → normalized', items)
    if (items.length) onInventory(items)
  }
  overwolf.games.events.onInfoUpdates2.addListener(handler)

  return () => overwolf.games.events.onInfoUpdates2.removeListener(handler)
}
