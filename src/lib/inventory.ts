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
import { QUEST_NAMES } from './quests'
import { RELIC_NAMES } from './relics'
import { resourceName } from './resources'

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
  heartcell?: number // Live Heartcell — Coda weapon currency (#64)
}
const CURRENCY_KEYS: Array<[keyof Currencies, string]> = [
  ['credits', 'RegularCredits'],
  ['platinum', 'PremiumCredits'],
  ['ducats', 'PrimeTokens'],
  ['endo', 'FusionPoints'],
]

// Live Heartcell is not a top-level integer like the others — DE stores it in the
// inventory MiscItems array keyed by ItemType (#64). Sum its ItemCount.
const HEARTCELL_TYPE = '/Lotus/Types/Items/MiscItems/CodaWeaponBucks'

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
  // Heartcell lives in MiscItems (ItemType-keyed), so sum it separately.
  const misc = Array.isArray(inv.MiscItems) ? inv.MiscItems : []
  let heartcell = 0
  let sawHeartcell = false
  for (const raw of misc) {
    if (!raw || typeof raw !== 'object') continue
    const mi = raw as Record<string, unknown>
    if (mi.ItemType !== HEARTCELL_TYPE) continue
    const c = Number(mi.ItemCount)
    if (Number.isFinite(c)) {
      heartcell += c
      sawHeartcell = true
    }
  }
  if (sawHeartcell) out.heartcell = heartcell
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

// One owned crafting resource (#66): name + quantity in the inventory.
export interface OwnedResource {
  name: string
  count: number
}

// extractResources reads owned crafting-resource quantities from the DE inventory
// MiscItems (ItemType → resourceName), for the Foundry owned-vs-needed component
// counts. Returns [] for a non-DE / empty payload.
export function extractResources(info: Record<string, unknown>): OwnedResource[] {
  return extractResourcesDetailed(info).resources
}

// extractResourcesDetailed also reports the MiscItems ItemTypes it could NOT map
// (#95). This matters because an unmapped resource is indistinguishable from
// "you own none" in the Foundry — a missing map entry renders a silent 0, which is
// exactly how the previous coverage gap went unnoticed. Callers log `unmapped` so
// a gap is visible instead of looking like an empty stash.
export function extractResourcesDetailed(info: Record<string, unknown>): {
  resources: OwnedResource[]
  unmapped: string[]
} {
  const raw = findInventoryValue(info)
  if (raw == null) return { resources: [], unmapped: [] }
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return { resources: [], unmapped: [] }
    }
  }
  if (!isDeInventory(value)) return { resources: [], unmapped: [] }
  const inv = value as Record<string, unknown>

  const counts = new Map<string, number>()
  const unmapped = new Set<string>()
  const misc = Array.isArray(inv.MiscItems) ? (inv.MiscItems as unknown[]) : []
  for (const raw of misc) {
    if (!raw || typeof raw !== 'object') continue
    const mi = raw as Record<string, unknown>
    const itemType = typeof mi.ItemType === 'string' ? mi.ItemType : ''
    const c = Number(mi.ItemCount)
    if (!Number.isFinite(c) || c <= 0) continue
    // resourceName tolerates the StoreItems-prefixed ItemType DE uses for
    // resources that are also sold (Kuva, Forma) — an exact-match lookup missed
    // those entirely.
    const name = resourceName(itemType)
    if (!name) {
      if (itemType) unmapped.add(itemType)
      continue
    }
    counts.set(name, (counts.get(name) ?? 0) + c)
  }
  return {
    resources: Array.from(counts, ([name, count]) => ({ name, count })),
    unmapped: [...unmapped],
  }
}

// One in-progress foundry build (#66): the item cooking + when it finishes.
export interface PendingBuild {
  name: string // resolved item/blueprint name
  completeAt: number // epoch ms the build is ready to claim (0 if unknown)
}

// humanizeType turns a DE recipe ItemType path into a readable name when it isn't
// in the generated map, e.g. ".../AshPrimeBlueprint" → "Ash Prime Blueprint".
function humanizeType(type: string): string {
  const tail = type.split('/').pop() ?? type
  return (
    tail
      .replace(/Component$/, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .trim() || tail
  )
}

// completionMs decodes DE's build-completion timestamp. It arrives as MongoDB
// extended JSON: { $date: { $numberLong: "<ms>" } } (also tolerates a plain
// number or ISO string). Returns epoch ms, or 0 when absent.
function completionMs(v: unknown): number {
  if (typeof v === 'number') return v
  if (v && typeof v === 'object') {
    const d = (v as Record<string, unknown>).$date
    if (typeof d === 'number') return d
    if (typeof d === 'string') {
      const n = Number(d)
      return Number.isFinite(n) ? n : Date.parse(d) || 0
    }
    if (d && typeof d === 'object' && '$numberLong' in (d as Record<string, unknown>)) {
      return Number((d as Record<string, unknown>).$numberLong) || 0
    }
  }
  return 0
}

// extractPending reads the DE `PendingRecipes` array — the items currently in the
// foundry — resolving each to a readable name (generated map, else humanized
// path) and its completion time. Returns [] for a non-DE / empty payload.
export function extractPending(info: Record<string, unknown>): PendingBuild[] {
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

  const list = Array.isArray(inv.PendingRecipes) ? (inv.PendingRecipes as unknown[]) : []
  const out: PendingBuild[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const e = raw as Record<string, unknown>
    const type = typeof e.ItemType === 'string' ? e.ItemType : ''
    if (!type) continue
    out.push({ name: PART_INFO[type]?.n ?? humanizeType(type), completeAt: completionMs(e.CompletionDate) })
  }
  return out
}

// Account progress for the progression-aware guide (#58): completed quests +
// how many star-chart nodes the player has cleared.
export interface Progress {
  quests: string[] // completed quest display names
  starChartNodes: number // distinct nodes cleared at least once
  masteryRank: number // player MR (PlayerLevel), for the Mastery helper (#75)
}

// extractProgress reads completed quests (QuestKeys, resolved via QUEST_NAMES)
// and the star-chart clear count (Missions entries with Completes > 0) from the
// DE inventory. Returns null for a non-DE / empty payload.
export function extractProgress(info: Record<string, unknown>): Progress | null {
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

  const quests: string[] = []
  const qk = Array.isArray(inv.QuestKeys) ? inv.QuestKeys : []
  for (const raw of qk) {
    if (!raw || typeof raw !== 'object') continue
    const e = raw as Record<string, unknown>
    if (e.Completed !== true) continue
    const name = QUEST_NAMES[typeof e.ItemType === 'string' ? e.ItemType : '']
    if (name) quests.push(name)
  }

  let starChartNodes = 0
  const missions = Array.isArray(inv.Missions) ? inv.Missions : []
  for (const raw of missions) {
    if (!raw || typeof raw !== 'object') continue
    const m = raw as Record<string, unknown>
    if (Number(m.Completes) > 0) starChartNodes++
  }

  const mr = Number(inv.PlayerLevel)
  return { quests: quests.sort(), starChartNodes, masteryRank: Number.isFinite(mr) && mr > 0 ? mr : 0 }
}

// extractCompletedTodos derives which recurring todo *template keys* the live DE
// inventory shows as already done this period (#62), so AOWA can auto-check them
// instead of the player ticking manually. Only structured, reliable inventory
// signals are used (EE.log mission wording is too fragile to map by key):
//
//   • "standing"     — the daily syndicate standing cap. DE tracks daily standing
//                      earned in the `DailyAffiliation*` family (one pooled counter
//                      for the six regular syndicates + one per open-world/hub
//                      faction), each capped at 1000 + 500·MR and reset at daily
//                      reset. We mark it done once the player has capped at least
//                      one syndicate (max daily earned ≥ cap).
//   • "daily_login"  — DE auto-grants the daily login reward the moment you log in,
//                      so a live inventory read means today's login reward is in.
//
// Returns [] for a non-DE / empty payload. Keys map 1:1 to backend templates.ts
// template keys; add more here as reliable signals are identified.
export function extractCompletedTodos(info: Record<string, unknown>): string[] {
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

  const done: string[] = []

  // A live DE inventory read ⇒ the player is logged in today ⇒ daily login claimed.
  done.push('daily_login')

  // Daily standing cap: scan every DailyAffiliation* counter, compare the largest
  // to the MR-scaled cap. PlayerLevel is the mastery rank in inventory.php.
  const mr = Number(inv.PlayerLevel)
  const cap = 1000 + 500 * (Number.isFinite(mr) && mr > 0 ? mr : 0)
  let maxDaily = 0
  for (const [key, v] of Object.entries(inv)) {
    if (!key.startsWith('DailyAffiliation')) continue
    const n = Number(v)
    if (Number.isFinite(n) && n > maxDaily) maxDaily = n
  }
  if (cap > 0 && maxDaily >= cap) done.push('standing')

  return done
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
