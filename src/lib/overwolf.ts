// Thin, typed wrappers over the Overwolf APIs the agent needs: the deep-link
// pairing code and the Game Events Provider (GEP) inventory feed.
import { REQUIRED_FEATURES, URL_SCHEME } from './config'
import type { IngestItem } from './api'
import { normalizeInventory } from './inventory'

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
  overwolf.games.events.setRequiredFeatures([...REQUIRED_FEATURES], (result) => {
    if (!result.success) {
      onError(`setRequiredFeatures failed: ${result.error ?? 'unknown'}`)
      return
    }
    // Pull the current snapshot immediately (GEP only pushes deltas afterwards).
    overwolf.games.events.getInfo((info) => {
      if (info.success && info.res) {
        const items = normalizeInventory(info.res)
        if (items.length) onInventory(items)
      }
    })
  })

  const handler = (update: overwolf.games.events.InfoUpdate) => {
    if (update.feature !== 'inventory') return
    const items = normalizeInventory(update.info)
    if (items.length) onInventory(items)
  }
  overwolf.games.events.onInfoUpdates2.addListener(handler)

  return () => overwolf.games.events.onInfoUpdates2.removeListener(handler)
}
