// Normalizes the Overwolf GEP `inventory` payload into the { name, count }[] that
// AOWA's ingest endpoint expects.
//
// CONFIRMED on-device (2026-08): Warframe GEP (8954) emits `match_info.inventory`
// once `match_info` is an explicitly-required feature. The value is a stringified
// JSON of DE's real `inventory.php` — relics live in `MiscItems` as
// `{ ItemCount, ItemType: "/Lotus/Types/Game/Projections/T<tier>VoidProjection…" }`,
// keyed by DE internal path (not display name). We resolve those paths to base
// relic names via the embedded WFCD map (`relics.ts`) and sum by relic, so the
// backend's existing relic-count ingest (matched by name) works unchanged.
import type { IngestItem } from './api'
import { GEAR_NAMES } from './gear'
import { PART_INFO } from './parts'
import { RELIC_NAMES } from './relics'

// DE inventory arrays of masterable gear → the mastery cap for that class.
// Mastery XP (lifetime, from XPInfo) ≥ cap ⇒ leveled to max at least once.
// Rank-30 caps: warframes/companions/archwing/mech use ×1000 (900k); weapons
// ×500 (450k). (A handful of rank-40 weapons are approximated at the 450k mark.)
const FRAME_ARRAYS = ['Suits', 'SpaceSuits', 'Sentinels', 'KubrowPets', 'MechSuits'] as const
const WEAPON_ARRAYS = ['LongGuns', 'Pistols', 'Melee', 'SentinelWeapons', 'SpaceGuns', 'SpaceMelee', 'DataKnives', 'DrifterMelee', 'OperatorAmps'] as const
const MASTERY_CAP: Record<string, number> = {
  ...Object.fromEntries(FRAME_ARRAYS.map((a) => [a, 900_000])),
  ...Object.fromEntries(WEAPON_ARRAYS.map((a) => [a, 450_000])),
}

// GEP delivers info-updates flat as { feature, category, key, value } (confirmed
// on-device). Fall back to nested/top-level shapes for safety. Returns the value
// of the `inventory` key wherever it appears.
export function findInventoryValue(info: unknown, depth = 4): unknown {
  if (info == null || typeof info !== 'object' || depth < 0) return undefined
  const obj = info as Record<string, unknown>
  if (typeof obj['key'] === 'string' && 'value' in obj) {
    return String(obj['key']).toLowerCase() === 'inventory' ? obj['value'] : undefined
  }
  if ('inventory' in obj && obj['inventory'] != null) return obj['inventory']
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const found = findInventoryValue(v, depth - 1)
      if (found !== undefined) return found
    }
  }
  return undefined
}

// isDeInventory recognises DE's real inventory.php shape (vs. the legacy toy
// shapes below) by its signature arrays.
function isDeInventory(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && (Array.isArray((v as Record<string, unknown>).MiscItems) || Array.isArray((v as Record<string, unknown>).Suits))
}

// parseDeInventory extracts owned relics AND owned/mastered gear from the real
// payload:
//   • relics — every MiscItem whose ItemType resolves in RELIC_NAMES, summed per
//     base relic across refinements (non-relic MiscItems are skipped).
//   • gear — every entry across the masterable gear arrays whose ItemType resolves
//     in GEAR_NAMES is owned; mastered when its lifetime XP (XPInfo ledger, or the
//     item's current XP as a floor) meets the class cap.
function parseDeInventory(inv: Record<string, unknown>): IngestItem[] {
  const out: IngestItem[] = []

  // --- relics ---
  const counts = new Map<string, number>()
  const misc = Array.isArray(inv.MiscItems) ? inv.MiscItems : []
  for (const raw of misc) {
    if (!raw || typeof raw !== 'object') continue
    const mi = raw as Record<string, unknown>
    const type = typeof mi.ItemType === 'string' ? mi.ItemType : ''
    const name = RELIC_NAMES[type]
    if (!name) continue
    const c = Number(mi.ItemCount)
    counts.set(name, (counts.get(name) ?? 0) + (Number.isFinite(c) && c > 0 ? c : 0))
  }
  for (const [name, count] of counts) out.push({ name, count })

  // --- gear (owned + mastered) ---
  const ledger = new Map<string, number>() // ItemType → lifetime XP
  const xpInfo = Array.isArray(inv.XPInfo) ? inv.XPInfo : []
  for (const raw of xpInfo) {
    if (raw && typeof raw === 'object') {
      const e = raw as Record<string, unknown>
      if (typeof e.ItemType === 'string') ledger.set(e.ItemType, Number(e.XP) || 0)
    }
  }
  const seen = new Set<string>() // dedupe an item across arrays
  for (const arr of [...FRAME_ARRAYS, ...WEAPON_ARRAYS]) {
    const list = Array.isArray(inv[arr]) ? (inv[arr] as unknown[]) : []
    const cap = MASTERY_CAP[arr] ?? 450_000
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue
      const g = raw as Record<string, unknown>
      const type = typeof g.ItemType === 'string' ? g.ItemType : ''
      const name = GEAR_NAMES[type]
      if (!name || seen.has(name)) continue
      seen.add(name)
      const life = Math.max(ledger.get(type) ?? 0, Number(g.XP) || 0)
      const item: IngestItem = { name, count: 1 }
      if (life >= cap) item.mastered = true
      out.push(item)
    }
  }
  return out
}

// Account currencies surfaced in the dashboard (#52). Read straight off the DE
// inventory payload the mastery sync already consumes — DE stores them as flat
// top-level integers. Fields absent from the payload are simply omitted.
export type Currencies = {
  credits?: number // RegularCredits
  platinum?: number // PremiumCredits
  ducats?: number // PrimeTokens
  endo?: number // FusionPoints
}
const CURRENCY_KEYS: Array<[keyof Currencies, string]> = [
  ['credits', 'RegularCredits'],
  ['platinum', 'PremiumCredits'],
  ['ducats', 'PrimeTokens'],
  ['endo', 'FusionPoints'],
]

// extractCurrencies pulls the account balances from the same GEP inventory info
// wrapper normalizeInventory takes. Returns null when the payload isn't the real
// DE inventory or carries no recognised currency field.
export function extractCurrencies(info: Record<string, unknown>): Currencies | null {
  const raw = findInventoryValue(info)
  if (raw == null) return null
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!isDeInventory(value)) return null
  const inv = value as Record<string, unknown>
  const out: Currencies = {}
  for (const [key, deKey] of CURRENCY_KEYS) {
    const n = Number(inv[deKey])
    if (Number.isFinite(n)) out[key] = n
  }
  return Object.keys(out).length ? out : null
}

// A sellable prime part the player owns (#54): count owned + its Baro ducat value.
export interface SellablePart {
  name: string
  count: number
  ducats: number
}

// extractParts pulls owned prime parts from the DE inventory. Blueprints live in
// the `Recipes` array, components in `MiscItems`; both key on ItemType, which
// joins to PART_INFO (generated from WFCD). Counts are summed per part. Returns
// [] for a non-DE / empty payload.
export function extractParts(info: Record<string, unknown>): SellablePart[] {
  const raw = findInventoryValue(info)
  if (raw == null) return []
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!isDeInventory(value)) return []
  const inv = value as Record<string, unknown>

  const counts = new Map<string, { count: number; ducats: number }>()
  for (const arr of ['Recipes', 'MiscItems'] as const) {
    const list = Array.isArray(inv[arr]) ? (inv[arr] as unknown[]) : []
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue
      const e = raw as Record<string, unknown>
      const type = typeof e.ItemType === 'string' ? e.ItemType : ''
      const info = PART_INFO[type]
      if (!info) continue
      const c = Number(e.ItemCount)
      if (!Number.isFinite(c) || c <= 0) continue
      const cur = counts.get(info.n) ?? { count: 0, ducats: info.d }
      cur.count += c
      counts.set(info.n, cur)
    }
  }
  return Array.from(counts, ([name, v]) => ({ name, count: v.count, ducats: v.ducats }))
}

export function normalizeInventory(info: Record<string, unknown>): IngestItem[] {
  const raw = findInventoryValue(info)
  if (raw == null) return []

  // GEP stringifies the inventory value.
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return []
    }
  }

  // Real DE inventory → extract relics (owned gear/mastery is a later phase).
  if (isDeInventory(value)) return parseDeInventory(value)

  // ---- legacy/simple shapes (kept for forward-compat + unit tests) ----------
  const out: IngestItem[] = []
  const push = (name: unknown, count: unknown, mastered?: boolean) => {
    if (typeof name !== 'string' || !name.trim()) return
    const n = typeof count === 'number' ? count : parseInt(String(count ?? '1'), 10)
    const item: IngestItem = { name: name.trim(), count: Number.isFinite(n) ? n : 1 }
    if (mastered) item.mastered = true
    out.push(item)
  }
  const isMastered = (e: Record<string, unknown>): boolean => {
    if (typeof e.mastered === 'boolean') return e.mastered
    const rank = Number(e.rank ?? e.itemRank ?? NaN)
    const max = Number(e.maxRank ?? e.rankCap ?? NaN)
    return Number.isFinite(rank) && Number.isFinite(max) && max > 0 && rank >= max
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (entry && typeof entry === 'object') {
        const e = entry as Record<string, unknown>
        push(e.name ?? e.item ?? e.type, e.count ?? e.amount ?? e.quantity, isMastered(e))
      }
    }
  } else if (value && typeof value === 'object') {
    for (const [name, count] of Object.entries(value as Record<string, unknown>)) {
      push(name, count)
    }
  }
  return out
}
