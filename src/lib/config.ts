// Shared constants (usable in both the Electron main process and the renderer —
// no Vite-only `import.meta.env`, so it compiles for Node too).

// AOWA API base. Override in the main process via AOWA_API_BASE.
export const API_BASE = 'https://aowa.ashguard.io/api'

// Custom URL scheme for one-click pairing deep links (aowa://pair?code=…).
export const URL_SCHEME = 'aowa'

// Warframe's GEP game id — confirmed present in ow-electron's supported-games
// list (`overwolf/ow-electron-packages-types`: `Warframe = 8954`).
export const WARFRAME_GAME_ID = 8954

// GEP features to request. Warframe's GEP is narrow; inventory + game_info are
// what AOWA consumes. Confirm exact feature keys on-device.
export const GEP_FEATURES = ['inventory', 'game_info'] as const

// Coalesce bursts of inventory updates into one POST.
export const INGEST_DEBOUNCE_MS = 4000

// Log raw GEP payloads to help capture Warframe's real inventory shape.
export const DEBUG_GEP = true
