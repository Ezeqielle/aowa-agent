// Regenerates src/lib/resources.ts — DE inventory ItemType (uniqueName) → crafting
// resource name (Orokin Cell, Fieldron, Seriglass Shard, …), for the Foundry
// owned-vs-needed component counts (#66/#95). Resources live in the DE inventory
// `MiscItems` array keyed by uniqueName; the same uniqueName appears as a recipe
// component across buildable items, so we collect them from every recipe.
// Run:  node scripts/gen-resources.mjs
//
// Why the whole dataset and not `?category=Resources` (#95): **warframestat.us
// ignores an unrecognised category and returns everything** — `?category=Resources`
// yields ~17.5k rows spanning Skins/Relics/Mods/Glyphs, so filtering on it is
// meaningless. Worse, taking every `/MiscItems/` row out of that payload pulls in
// captura scenes, "Additional Mod Config Slot" and Incarnon Genesis adapters. The
// honest definition of "a resource the Foundry needs a count for" is *a recipe
// component*, so that is what we walk.
//
// The previous version walked only 9 gear categories AND required a `/MiscItems/`
// path, which missed the clan-research resources — Fieldron, Detonite Injector,
// Mutagen Mass and their samples live under `/Lotus/Types/Items/Research/…` — plus
// every Deimos infested part, fish part and Predasite/Velocipod tag.
import { writeFileSync } from 'node:fs'

const BASE = 'https://api.warframestat.us'

// Some resources are also sold, and DE then uses a StoreItems-prefixed ItemType:
// `/Lotus/StoreItems/Types/Items/MiscItems/Kuva` vs `/Lotus/Types/Items/MiscItems/Kuva`.
// Collapse to the plain form here and at lookup time (see resourceName) so either
// shape resolves.
const normalizeItemType = (un) => un.replace('/StoreItems/Types/', '/Types/')

const res = await fetch(`${BASE}/items/`, {
  headers: { 'User-Agent': 'aowa-agent/resources-gen' },
})
if (!res.ok) throw new Error(`WFCD items fetch failed: ${res.status}`)
const items = await res.json()

const map = {} // normalized uniqueName -> resource name
let skippedParts = 0
for (const item of items) {
  for (const c of item.components ?? []) {
    const un = c.uniqueName
    const name = (c.name ?? '').trim()
    if (!un || !name) continue
    // "Blueprint" is every recipe's own blueprint entry, not a resource.
    if (name.toLowerCase() === 'blueprint') continue
    // A ducat value marks a tradable prime part (covered by parts.ts), not a
    // shared crafting resource.
    const ducats = Number(c.ducats)
    if (Number.isFinite(ducats) && ducats > 0) {
      skippedParts++
      continue
    }
    // Everything DE keeps as an inventory item lives under /Types/Items/ —
    // MiscItems (most resources), Research (Fieldron/Detonite/Mutagen), and the
    // Deimos/fish/tag families. Over-inclusion is harmless: a map entry that never
    // appears in an inventory simply never matches.
    if (!un.includes('/Types/Items/') && c.type !== 'Resource') continue
    map[normalizeItemType(un)] = name
  }
}

const keys = Object.keys(map).sort()
const entries = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(map[k])}`).join(',\n')
const header =
  `// AUTO-GENERATED — DE inventory ItemType (uniqueName) → crafting resource name,\n` +
  `// for the Foundry owned-vs-needed component counts (#66/#95). Collected from every\n` +
  `// WFCD recipe component under /Types/Items/ (MiscItems, Research, Deimos/fish/tags),\n` +
  `// excluding tradable prime parts. Regenerate: scripts/gen-resources.mjs.\n` +
  `// ${keys.length} entries. Keys are normalized: /StoreItems/Types/ -> /Types/.\n`
const body =
  `export const RESOURCE_NAMES: Record<string, string> = {\n${entries}\n}\n\n` +
  `// resourceName resolves a DE inventory ItemType to its resource name, tolerating\n` +
  `// the StoreItems-prefixed variant DE uses for resources that are also sold\n` +
  `// (Kuva, Forma). Returns undefined when the ItemType isn't a known resource.\n` +
  `export function resourceName(itemType: string): string | undefined {\n` +
  `  if (!itemType) return undefined\n` +
  `  return (\n` +
  `    RESOURCE_NAMES[itemType] ??\n` +
  `    RESOURCE_NAMES[itemType.replace('/StoreItems/Types/', '/Types/')]\n` +
  `  )\n` +
  `}\n`
writeFileSync('src/lib/resources.ts', header + body)
console.log(`wrote src/lib/resources.ts — ${keys.length} entries (skipped ${skippedParts} prime-part components)`)
