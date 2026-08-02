// Regenerates src/lib/relics.ts (DE relic ItemType → base relic name) from the
// WFCD community dataset. Run when DE ships new relics:  node scripts/gen-relics.mjs
import { writeFileSync } from 'node:fs'

const URL = 'https://api.warframestat.us/items/?category=Relics'
const REFINEMENTS = new Set(['Intact', 'Exceptional', 'Flawless', 'Radiant'])
const base = (name) => {
  const p = name.split(' ')
  if (p.length && REFINEMENTS.has(p[p.length - 1])) p.pop()
  return p.join(' ')
}

const res = await fetch(URL, { headers: { 'User-Agent': 'aowa-agent/relics-gen' } })
if (!res.ok) throw new Error(`WFCD fetch failed: ${res.status}`)
const items = await res.json()

const map = {}
for (const i of items) {
  if (i.category !== 'Relics') continue
  const un = i.uniqueName ?? ''
  const name = i.name ?? ''
  if (un.startsWith('/Lotus/Types/Game/Projections/') && name) {
    const b = base(name)
    if (b) map[un] = b
  }
}

const entries = Object.keys(map)
  .sort()
  .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(map[k])}`)
  .join(',\n')
const header =
  `// AUTO-GENERATED — DE relic ItemType (uniqueName) → base relic name.\n` +
  `// Source: WFCD community dataset (api.warframestat.us, category=Relics),\n` +
  `// refinement suffix (Intact/Exceptional/Flawless/Radiant) stripped so all\n` +
  `// four refinements of a relic collapse to one base (e.g. "Lith S8").\n` +
  `// Regenerate with scripts/gen-relics.mjs when DE ships new relics.\n` +
  `// ${Object.keys(map).length} entries.\n`
writeFileSync('src/lib/relics.ts', `${header}export const RELIC_NAMES: Record<string, string> = {\n${entries}\n}\n`)
console.log(`wrote src/lib/relics.ts — ${Object.keys(map).length} entries`)
