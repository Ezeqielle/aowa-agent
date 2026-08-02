// Normalizes the Overwolf GEP `inventory` payload into the { name, count }[] that
// AOWA's ingest endpoint expects.
//
// The precise GEP shape for Warframe is unconfirmed (see docs/README) — this
// function is the single place that encodes the assumption. GEP typically
// delivers `info` values as JSON strings, and inventory is commonly a keyed map
// or an array of entries. We handle the likely shapes defensively; adjust once
// the real payload is captured with the GEP sample app.
import type { IngestItem } from './api'

// GEP delivers info-updates nested by feature/category, so the Warframe
// `match_info.inventory` key arrives as `{ match_info: { inventory: <value> } }`,
// not `{ inventory: <value> }`. Locate the `inventory` value wherever GEP puts
// it: top level, under its `match_info` category, or nested any deeper. Returns
// the first `inventory`-keyed value found (bounded depth; avoids cycles).
export function findInventoryValue(info: unknown, depth = 4): unknown {
  if (info == null || typeof info !== 'object' || depth < 0) return undefined
  const obj = info as Record<string, unknown>
  // ow-electron delivers each info-update flat: { feature, category, key, value }.
  // Confirmed on-device — so the inventory arrives as { key:'inventory', value }.
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

export function normalizeInventory(info: Record<string, unknown>): IngestItem[] {
  const raw = findInventoryValue(info)
  if (raw == null) return []

  // GEP often stringifies feature values.
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return []
    }
  }

  const out: IngestItem[] = []
  const push = (name: unknown, count: unknown, mastered?: boolean) => {
    if (typeof name !== 'string' || !name.trim()) return
    const n = typeof count === 'number' ? count : parseInt(String(count ?? '1'), 10)
    const item: IngestItem = { name: name.trim(), count: Number.isFinite(n) ? n : 1 }
    if (mastered) item.mastered = true
    out.push(item)
  }

  // Best-effort mastery signal: an explicit `mastered` flag, or rank at max
  // (xp/rank == its cap). Confirm the real field names once GEP is captured.
  const isMastered = (e: Record<string, unknown>): boolean => {
    if (typeof e.mastered === 'boolean') return e.mastered
    const rank = Number(e.rank ?? e.itemRank ?? NaN)
    const max = Number(e.maxRank ?? e.rankCap ?? NaN)
    return Number.isFinite(rank) && Number.isFinite(max) && max > 0 && rank >= max
  }

  if (Array.isArray(value)) {
    // e.g. [{ name: "Axi A1 Relic", count: 3 }, { name: "Excalibur", rank: 30 }]
    for (const entry of value) {
      if (entry && typeof entry === 'object') {
        const e = entry as Record<string, unknown>
        push(e.name ?? e.item ?? e.type, e.count ?? e.amount ?? e.quantity, isMastered(e))
      }
    }
  } else if (value && typeof value === 'object') {
    // e.g. { "Axi A1 Relic": 3, "Excalibur": 1 } — no per-item mastery here.
    for (const [name, count] of Object.entries(value as Record<string, unknown>)) {
      push(name, count)
    }
  }
  return out
}
