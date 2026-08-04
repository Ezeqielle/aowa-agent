// Regenerates src/lib/resources.ts — DE inventory ItemType (uniqueName) → crafting
// resource name (Orokin Cell, Ferrite, Argon Crystal, Forma, …), for the Foundry
// owned-vs-needed component counts (#66). Resources live in the DE inventory
// `MiscItems` array keyed by uniqueName; the same uniqueName appears as a recipe
// component across gear, so we collect them from every buildable item's
// components. Run:  node scripts/gen-resources.mjs
import { writeFileSync } from 'node:fs'

const CATEGORIES = ['Warframes', 'Primary', 'Secondary', 'Melee', 'Archwing', 'Arch-Gun', 'Arch-Melee', 'Sentinels', 'Pets']

const map = {} // uniqueName -> resource name
for (const cat of CATEGORIES) {
  const res = await fetch(`https://api.warframestat.us/items/?category=${encodeURIComponent(cat)}`, {
    headers: { 'User-Agent': 'aowa-agent/resources-gen' },
  })
  if (!res.ok) throw new Error(`WFCD ${cat} fetch failed: ${res.status}`)
  for (const item of await res.json()) {
    for (const c of item.components ?? []) {
      if (!c.uniqueName || !c.name) continue
      // Shared crafting resources are MiscItems (not tradable prime parts, which
      // carry ducats). A ducat value marks a sellable prime part → skip those.
      const ducats = Number(c.ducats)
      const isPart = Number.isFinite(ducats) && ducats > 0
      if (isPart) continue
      if (/\/MiscItems\//i.test(c.uniqueName) || c.type === 'Resource') {
        map[c.uniqueName] = c.name
      }
    }
  }
}

const keys = Object.keys(map).sort()
const entries = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(map[k])}`).join(',\n')
const header =
  `// AUTO-GENERATED — DE inventory ItemType (uniqueName) → crafting resource name,\n` +
  `// for the Foundry owned-vs-needed component counts (#66). Resources live in the\n` +
  `// DE inventory MiscItems array keyed by uniqueName. Regenerate: scripts/gen-resources.mjs.\n` +
  `// ${keys.length} entries.\n`
writeFileSync('src/lib/resources.ts', `${header}export const RESOURCE_NAMES: Record<string, string> = {\n${entries}\n}\n`)
console.log(`wrote src/lib/resources.ts — ${keys.length} entries`)
