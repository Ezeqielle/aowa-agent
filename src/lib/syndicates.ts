// Derives per-syndicate standing + daily-cap usage from the DE inventory for the
// web Syndicates tab (#63). DE stores lifetime standing per faction in the
// `Affiliations` array ({ Tag, Standing, Title }) and the standing earned *today*
// in a family of top-level `DailyAffiliation*` counters (reset at daily reset).
// The daily cap scales with Mastery Rank: 1000 + 500·MR (PlayerLevel).
//
// The six "core" relay syndicates (New Loka, Red Veil, Steel Meridian, Arbiters,
// Cephalon Suda, Perrin Sequence) SHARE a single `DailyAffiliation` daily pool,
// so they all report the same dailyEarned and are flagged dailyShared.

export interface IngestSyndicate {
  key: string // stable slug ("steel_meridian")
  name: string // display ("Steel Meridian")
  standing: number // lifetime standing
  title?: string // rank title when the inventory carries one
  dailyEarned: number // standing earned today
  dailyCap: number // MR-scaled daily cap (0 ⇒ no daily cap shown)
  dailyShared?: boolean // daily pool shared across the core syndicates
}

// DE Affiliation Tag → display name + the DailyAffiliation* field that tracks its
// daily standing. `shared` marks the core six that pool into `DailyAffiliation`.
// Unknown tags still render (humanized) but without a daily bar.
interface Cat {
  name: string
  daily?: string
  shared?: boolean
}
const CATALOG: Record<string, Cat> = {
  // Core six — shared `DailyAffiliation` pool.
  NewLokaSyndicate: { name: 'New Loka', daily: 'DailyAffiliation', shared: true },
  RedVeilSyndicate: { name: 'Red Veil', daily: 'DailyAffiliation', shared: true },
  SteelMeridianSyndicate: { name: 'Steel Meridian', daily: 'DailyAffiliation', shared: true },
  ArbitersSyndicate: { name: 'Arbiters of Hexis', daily: 'DailyAffiliation', shared: true },
  CephalonSudaSyndicate: { name: 'Cephalon Suda', daily: 'DailyAffiliation', shared: true },
  PerrinSequenceSyndicate: { name: 'The Perrin Sequence', daily: 'DailyAffiliation', shared: true },
  // Standalone factions — own daily counters.
  CetusSyndicate: { name: 'Ostron', daily: 'DailyAffiliationCetus' },
  SolarisSyndicate: { name: 'Solaris United', daily: 'DailyAffiliationSolaris' },
  VentkidsSyndicate: { name: 'Ventkids', daily: 'DailyAffiliationVentkids' },
  QuillsSyndicate: { name: 'The Quills', daily: 'DailyAffiliationQuills' },
  CephalonSimarisSyndicate: { name: 'Cephalon Simaris', daily: 'DailyAffiliationLibrary' },
  EntratiSyndicate: { name: 'Entrati', daily: 'DailyAffiliationEntrati' },
  NecraloidSyndicate: { name: 'Necraloid', daily: 'DailyAffiliationNecraloid' },
  ZarimanSyndicate: { name: 'The Holdfasts', daily: 'DailyAffiliationZariman' },
  HexSyndicate: { name: 'The Hex', daily: 'DailyAffiliationHex' },
  KahlSyndicate: { name: "Kahl's Garrison" }, // weekly (Break Narmer) — no daily cap
}

// humanizeTag turns an unknown DE Tag into a readable name: drop a "Syndicate"
// suffix, then split camelCase → "Some New Faction".
function humanizeTag(tag: string): string {
  const base = tag.replace(/Syndicate$/, '')
  return base.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim() || tag
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

// title reads a usable rank title from an Affiliation entry. DE sometimes stores
// a readable string, sometimes a "/Lotus/..."-style path, sometimes nothing.
function title(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return ''
  const s = raw.trim()
  if (s.includes('/')) return '' // localization path — not display-ready
  return s
}

function isDeInventory(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && (Array.isArray((v as Record<string, unknown>).MiscItems) || Array.isArray((v as Record<string, unknown>).Suits))
}

// findInventoryValue mirror kept local to avoid a circular import with inventory.ts.
function unwrap(info: Record<string, unknown>): Record<string, unknown> | null {
  let raw: unknown = info
  if ('inventory' in info && info.inventory != null) raw = info.inventory
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return null
    }
  }
  return isDeInventory(raw) ? (raw as Record<string, unknown>) : null
}

export function extractSyndicates(info: Record<string, unknown>): IngestSyndicate[] {
  const inv = unwrap(info)
  if (!inv) return []
  const affs = Array.isArray(inv.Affiliations) ? inv.Affiliations : []
  if (!affs.length) return []

  const mr = Number(inv.PlayerLevel)
  const cap = 1000 + 500 * (Number.isFinite(mr) && mr > 0 ? mr : 0)

  const out: IngestSyndicate[] = []
  for (const raw of affs) {
    if (!raw || typeof raw !== 'object') continue
    const a = raw as Record<string, unknown>
    const tag = typeof a.Tag === 'string' ? a.Tag : ''
    if (!tag) continue
    const cat = CATALOG[tag]
    const name = cat?.name ?? humanizeTag(tag)
    const standing = Number(a.Standing)
    const dailyEarned = cat?.daily ? Number(inv[cat.daily]) : NaN
    out.push({
      key: slug(name),
      name,
      standing: Number.isFinite(standing) ? standing : 0,
      title: title(a.Title) || undefined,
      dailyEarned: Number.isFinite(dailyEarned) ? dailyEarned : 0,
      dailyCap: cat?.daily ? cap : 0,
      dailyShared: cat?.shared || undefined,
    })
  }
  out.sort((x, y) => x.name.localeCompare(y.name))
  return out
}
