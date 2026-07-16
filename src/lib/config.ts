// Static configuration for the agent.

// AOWA API base. The agent talks to the same public API as the web app.
// Override at build time with VITE_AOWA_API_BASE for staging/local testing.
export const API_BASE: string =
  (import.meta.env.VITE_AOWA_API_BASE as string | undefined) ?? 'https://aowa.ashguard.io/api'

// Custom URL scheme registered in manifest.json (url_protocol). The AOWA web app
// hands the pairing code to the agent via `aowa://pair?code=<code>`.
export const URL_SCHEME = 'aowa'

// Warframe's Overwolf game/class id. Used in manifest game_targeting.game_ids
// and to gate GEP subscription. VERIFY against Overwolf's supported-games list
// and the GEP sample app before shipping — Overwolf distinguishes a game's
// short "class id" (used here) from the longer runtime "game id".
export const WARFRAME_CLASS_ID = 8954

// GEP features we subscribe to. Warframe's GEP is narrow — inventory + game_info
// are what AOWA's P1 ingest consumes. Confirm exact feature keys with the GEP
// simulator; they occasionally change.
export const REQUIRED_FEATURES = ['inventory', 'game_info'] as const

// How long to coalesce a burst of inventory updates before POSTing, so opening a
// menu that emits many updates results in one request, not dozens.
export const INGEST_DEBOUNCE_MS = 4000

// localStorage key for the persisted agent bearer token.
export const TOKEN_KEY = 'aowa.agent.token'
