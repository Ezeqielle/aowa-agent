// Regenerates src/lib/gear.ts (DE gear ItemType → display name) from the WFCD
// dataset: every masterable item across the gear categories AOWA tracks. The
// name equals AOWA's Equipment craftable name (both are WFCD `name`), so the
// backend marks owned/mastered by name. Run:  node scripts/gen-gear.mjs
import { writeFileSync } from 'node:fs'

const CATEGORIES = ['Warframes', 'Primary', 'Secondary', 'Melee', 'Sentinels', 'SentinelWeapons', 'Archwing', 'Arch-Gun', 'Arch-Melee', 'Pets', 'Misc']

const map = {}
for (const cat of CATEGORIES) {
  const res = await fetch(`https://api.warframestat.us/items/?category=${encodeURIComponent(cat)}`, {
    headers: { 'User-Agent': 'aowa-agent/gear-gen' },
  })
  if (!res.ok) throw new Error(`WFCD ${cat} fetch failed: ${res.status}`)
  for (const i of await res.json()) {
    if (i.masterable && i.uniqueName && i.name) map[i.uniqueName] = i.name
  }
}

const entries = Object.keys(map)
  .sort()
  .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(map[k])}`)
  .join(',\n')
const header =
  `// AUTO-GENERATED — DE gear ItemType (uniqueName) → display name, for the\n` +
  `// masterable equipment AOWA tracks (WFCD \`masterable:true\`). Name matches\n` +
  `// AOWA's Equipment craftable name (both are the WFCD \`name\`), so the backend\n` +
  `// marks owned/mastered by name. Regenerate with scripts/gen-gear.mjs.\n` +
  `// ${Object.keys(map).length} entries.\n`
writeFileSync('src/lib/gear.ts', `${header}export const GEAR_NAMES: Record<string, string> = {\n${entries}\n}\n`)
console.log(`wrote src/lib/gear.ts — ${Object.keys(map).length} entries`)
