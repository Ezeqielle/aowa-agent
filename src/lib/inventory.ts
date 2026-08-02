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
import { RELIC_NAMES } from './relics'

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

// parseDeInventory extracts owned relics from the real payload: every MiscItem
// whose ItemType resolves in RELIC_NAMES is a relic; counts are summed per base
// relic across refinements. (Non-relic MiscItems — resources, the Void Relic
// Segment ship feature, etc. — aren't in the map and are skipped.)
function parseDeInventory(inv: Record<string, unknown>): IngestItem[] {
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
  return [...counts].map(([name, count]) => ({ name, count }))
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
