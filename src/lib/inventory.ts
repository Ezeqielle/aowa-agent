// Normalizes the Overwolf GEP `inventory` payload into the { name, count }[] that
// AOWA's ingest endpoint expects.
//
// The precise GEP shape for Warframe is unconfirmed (see docs/README) — this
// function is the single place that encodes the assumption. GEP typically
// delivers `info` values as JSON strings, and inventory is commonly a keyed map
// or an array of entries. We handle the likely shapes defensively; adjust once
// the real payload is captured with the GEP sample app.
import type { IngestItem } from './api'

export function normalizeInventory(info: Record<string, unknown>): IngestItem[] {
  const raw = info['inventory']
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
