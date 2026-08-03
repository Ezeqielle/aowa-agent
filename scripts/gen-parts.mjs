// Regenerates src/lib/parts.ts — DE inventory ItemType (uniqueName) → sellable
// prime-part info { name, ducats }. Source: every WFCD item's `components` whose
// component is tradable with a ducat value (i.e. a Prime part sellable to Baro
// for ducats / on warframe.market for platinum). Blueprints live in the DE
// inventory `Recipes` array, components in `MiscItems`; both key on this
// uniqueName. Run:  node scripts/gen-parts.mjs
import { writeFileSync } from 'node:fs'

const CATEGORIES = ['Warframes', 'Primary', 'Secondary', 'Melee', 'Archwing', 'Arch-Gun', 'Arch-Melee', 'Sentinels', 'Pets']

const map = {} // uniqueName -> { n: "<Item> <Part>", d: ducats }
for (const cat of CATEGORIES) {
  const res = await fetch(`https://api.warframestat.us/items/?category=${encodeURIComponent(cat)}`, {
    headers: { 'User-Agent': 'aowa-agent/parts-gen' },
  })
  if (!res.ok) throw new Error(`WFCD ${cat} fetch failed: ${res.status}`)
  for (const item of await res.json()) {
    for (const c of item.components ?? []) {
      const ducats = Number(c.ducats)
      if (!c.uniqueName || !c.tradable || !Number.isFinite(ducats) || ducats <= 0) continue
      // Display name: "<Item> <Part>", not double-prefixing when the part name
      // already carries the item (rare). Blueprint → "<Item> Blueprint".
      const name = c.name && !c.name.startsWith(item.name) ? `${item.name} ${c.name}` : c.name || item.name
      map[c.uniqueName] = { n: name, d: ducats }
    }
  }
}

const entries = Object.keys(map)
  .sort()
  .map((k) => `  ${JSON.stringify(k)}: { n: ${JSON.stringify(map[k].n)}, d: ${map[k].d} }`)
  .join(',\n')
const header =
  `// AUTO-GENERATED — DE inventory ItemType (uniqueName) → sellable prime-part\n` +
  `// info { n: display name, d: ducats }. Prime parts sell to Baro for ducats and\n` +
  `// trade on warframe.market for platinum (#54). Regenerate: scripts/gen-parts.mjs.\n` +
  `// ${Object.keys(map).length} entries.\n`
writeFileSync(
  'src/lib/parts.ts',
  `${header}export interface PartInfo { n: string; d: number }\n` +
    `export const PART_INFO: Record<string, PartInfo> = {\n${entries}\n}\n`,
)
console.log(`wrote src/lib/parts.ts — ${Object.keys(map).length} entries`)
