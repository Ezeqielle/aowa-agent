// Regenerates src/lib/quests.ts — DE quest key ItemType (uniqueName) → quest
// display name (#58). The DE inventory `QuestKeys` array carries these ItemTypes
// with a `Completed` flag; we resolve them to names to drive the progression
// guide. Source: WFCD items whose uniqueName is a quest keychain under /Keys/.
// Run:  node scripts/gen-quests.mjs
import { writeFileSync } from 'node:fs'

const res = await fetch('https://api.warframestat.us/items/', { headers: { 'User-Agent': 'aowa-agent/quests-gen' } })
if (!res.ok) throw new Error(`WFCD items fetch failed: ${res.status}`)
const items = await res.json()

const map = {}
for (const it of items) {
  const u = it.uniqueName
  const n = it.name
  if (typeof u !== 'string' || typeof n !== 'string' || !n.trim()) continue
  // Quest keychains live under /Keys/ and end in QuestKeyChain; also accept an
  // explicit Quest type. Skip obvious junk names.
  const isQuest = /\/Keys\/.*Quest.*KeyChain$/i.test(u) || (it.type === 'Quest' && u.includes('/Keys/'))
  if (!isQuest) continue
  map[u] = n.replace(/\s+/g, ' ').trim()
}

const entries = Object.keys(map)
  .sort()
  .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(map[k])}`)
  .join(',\n')
const header =
  `// AUTO-GENERATED — DE quest key ItemType (uniqueName) → quest name, for the\n` +
  `// progression guide (#58). The inventory QuestKeys array carries these with a\n` +
  `// Completed flag. Regenerate with scripts/gen-quests.mjs. ${Object.keys(map).length} entries.\n`
writeFileSync('src/lib/quests.ts', `${header}export const QUEST_NAMES: Record<string, string> = {\n${entries}\n}\n`)
console.log(`wrote src/lib/quests.ts — ${Object.keys(map).length} entries`)
