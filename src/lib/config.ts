// Shared constants (usable in both the Electron main process and the renderer —
// no Vite-only `import.meta.env`, so it compiles for Node too).

// AOWA API base. Override in the main process via AOWA_API_BASE.
export const API_BASE = 'https://aowa.ashguard.io/api'

// Custom URL scheme for one-click pairing deep links (aowa://pair?code=…).
export const URL_SCHEME = 'aowa'

// Warframe's GEP game id — confirmed present in ow-electron's supported-games
// list (`overwolf/ow-electron-packages-types`: `Warframe = 8954`).
export const WARFRAME_GAME_ID = 8954

// GEP *features* to request (confirmed from the live registry
// game-events-status.overwolf.com/8954_prod.json). Note `inventory` is a KEY
// under the `match_info` feature — not a feature itself — so we must request
// `match_info`, not `inventory`. `game_info` gives the username.
export const GEP_FEATURES = ['match_info', 'game_info'] as const

// Coalesce bursts of inventory updates into one POST.
export const INGEST_DEBOUNCE_MS = 4000

// Log the FULL raw GEP inventory JSON on every update (huge). Off by default now
// that the shape is captured — the handler still logs a compact `[AOWA-GEP] info`
// shape + a truncated `inventory raw` line, which is enough to see it fire.
export const DEBUG_GEP = false

// Dump every parsed EE.log line to the console (very noisy — floods GEP/INGEST
// logs). Off by default; the EE parser still runs and feeds the activity card.
// Turn on only when tuning the EE.log rules in src/lib/eelog.ts.
export const DEBUG_EE = false

// How often the EE.log tailer polls for appended lines.
export const EE_POLL_MS = 2000
