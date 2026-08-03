import { describe, expect, it } from 'vitest'
import { extractCompletedTodos, extractCurrencies, extractParts, extractProgress, findInventoryValue, normalizeInventory } from './inventory'

describe('normalizeInventory', () => {
  it('finds inventory nested under a GEP feature category (match_info.inventory)', () => {
    // GEP delivers info-updates nested by category, so Warframe's
    // match_info.inventory arrives wrapped — must still be found.
    const got = normalizeInventory({ match_info: { inventory: [{ name: 'Axi A1 Relic', count: 2 }] } })
    expect(got).toEqual([{ name: 'Axi A1 Relic', count: 2 }])
  })
  it('finds a stringified inventory nested under match_info', () => {
    const got = normalizeInventory({ match_info: { inventory: JSON.stringify({ 'Meso B4 Relic': 5 }) } })
    expect(got).toContainEqual({ name: 'Meso B4 Relic', count: 5 })
  })
  it('findInventoryValue prefers a top-level inventory but descends when absent', () => {
    expect(findInventoryValue({ inventory: 7 })).toBe(7)
    expect(findInventoryValue({ a: { b: { inventory: 'x' } } })).toBe('x')
    expect(findInventoryValue({ nope: 1 })).toBeUndefined()
  })
  it('parses the real DE inventory: relics from MiscItems, summed by base relic', () => {
    // Shape confirmed on-device: GEP flat event whose value is a stringified
    // inventory.php. Relics are MiscItems keyed by DE ItemType path.
    const inv = {
      MiscItems: [
        { ItemCount: 3, ItemType: '/Lotus/Types/Game/Projections/T1VoidProjectionAtlasPrimeABronze' }, // Lith S8
        { ItemCount: 2, ItemType: '/Lotus/Types/Game/Projections/T1VoidProjectionAtlasPrimeASilver' }, // Lith S8 (refined) → sums
        { ItemCount: 4, ItemType: '/Lotus/Types/Game/Projections/T1VoidProjectionAtlasPrimeBBronze' }, // Lith L2
        { ItemCount: 1, ItemType: '/Lotus/Types/Items/ShipFeatureItems/VoidProjectionFeatureItem' }, // Void Relic Segment → not a relic
        { ItemCount: 9999, ItemType: '/Lotus/Types/Items/MiscItems/Rubedo' }, // resource → skipped
      ],
      Suits: [
        { ItemType: '/Lotus/Powersuits/Excalibur/Excalibur', XP: 1626966 }, // ≥900k → mastered
        { ItemType: '/Lotus/Powersuits/Ninja/Ninja', XP: 0 }, // owned, never leveled → not mastered
      ],
      Melee: [{ ItemType: '/Lotus/Weapons/Tenno/Melee/PrimeFragor/PrimeFragor', XP: 6965294 }], // ≥450k → mastered
      XPInfo: [{ ItemType: '/Lotus/Powersuits/Ninja/Ninja', XP: 950000 }], // ledger overrides current XP=0 → mastered
    }
    const event = { gameId: 8954, feature: 'match_info', category: 'match_info', key: 'inventory', value: JSON.stringify(inv) }
    const got = normalizeInventory(event)
    // relics
    expect(got).toContainEqual({ name: 'Lith S8', count: 5 })
    expect(got).toContainEqual({ name: 'Lith L2', count: 4 })
    expect(got.find((i) => i.name.includes('Rubedo'))).toBeUndefined()
    // gear: owned + mastered (mastery from XPInfo ledger, not just current XP)
    expect(got).toContainEqual({ name: 'Excalibur', count: 1, mastered: true })
    expect(got).toContainEqual({ name: 'Fragor Prime', count: 1, mastered: true })
    expect(got).toContainEqual({ name: 'Ash', count: 1, mastered: true }) // ledger 950k ≥ 900k
  })
  it('marks owned-but-unleveled gear as not mastered', () => {
    const inv = { Suits: [{ ItemType: '/Lotus/Powersuits/Ninja/Ninja', XP: 0 }] }
    const event = { feature: 'match_info', key: 'inventory', value: JSON.stringify(inv) }
    expect(normalizeInventory(event)).toEqual([{ name: 'Ash', count: 1 }]) // owned, no mastered flag
  })
  it('handles the real ow-electron flat shape {feature,key,value}', () => {
    // Confirmed on-device: GEP emits e.g.
    // {gameId,feature:"match_info",category:"match_info",key:"inventory",value:…}
    const info = { gameId: 8954, feature: 'match_info', category: 'match_info', key: 'inventory', value: [{ name: 'Lith K9 Relic', count: 4 }] }
    expect(findInventoryValue(info)).toEqual([{ name: 'Lith K9 Relic', count: 4 }])
    expect(normalizeInventory(info)).toEqual([{ name: 'Lith K9 Relic', count: 4 }])
    // A non-inventory flat update (e.g. username) yields nothing.
    expect(findInventoryValue({ feature: 'game_info', key: 'username', value: 'Ezeqielle' })).toBeUndefined()
    expect(normalizeInventory({ feature: 'game_info', key: 'username', value: 'Ezeqielle' })).toEqual([])
  })
  it('handles an array of {name,count}', () => {
    const got = normalizeInventory({ inventory: [{ name: 'Excalibur', count: 1 }, { name: 'Axi A1 Relic', count: 3 }] })
    expect(got).toEqual([{ name: 'Excalibur', count: 1 }, { name: 'Axi A1 Relic', count: 3 }])
  })
  it('handles a keyed map', () => {
    const got = normalizeInventory({ inventory: { Excalibur: 1, 'Axi A1 Relic': 3 } })
    expect(got).toContainEqual({ name: 'Excalibur', count: 1 })
    expect(got).toContainEqual({ name: 'Axi A1 Relic', count: 3 })
  })
  it('parses a stringified JSON payload (GEP often stringifies)', () => {
    const got = normalizeInventory({ inventory: JSON.stringify([{ item: 'Braton', amount: 2 }]) })
    expect(got).toEqual([{ name: 'Braton', count: 2 }])
  })
  it('defaults a missing/NaN count to 1', () => {
    const got = normalizeInventory({ inventory: [{ name: 'Skana' }] })
    expect(got).toEqual([{ name: 'Skana', count: 1 }])
  })
  it('drops blank names and returns [] on missing/garbage', () => {
    expect(normalizeInventory({ inventory: [{ name: '' }, { count: 5 }] })).toEqual([])
    expect(normalizeInventory({})).toEqual([])
    expect(normalizeInventory({ inventory: 'not json' })).toEqual([])
  })
})

describe('extractCurrencies', () => {
  it('reads plat/credits/ducats/endo off the DE inventory (stringified GEP value)', () => {
    const inv = { Suits: [], RegularCredits: 1234567, PremiumCredits: 480, PrimeTokens: 92, FusionPoints: 55000 }
    const event = { feature: 'match_info', key: 'inventory', value: JSON.stringify(inv) }
    expect(extractCurrencies(event)).toEqual({ credits: 1234567, platinum: 480, ducats: 92, endo: 55000 })
  })
  it('omits currency fields absent from the payload', () => {
    const inv = { MiscItems: [], RegularCredits: 1000 }
    expect(extractCurrencies({ inventory: inv })).toEqual({ credits: 1000 })
  })
  it('returns null for non-DE / empty payloads', () => {
    expect(extractCurrencies({ inventory: [{ name: 'Braton', count: 1 }] })).toBeNull() // legacy shape, not DE
    expect(extractCurrencies({})).toBeNull()
    expect(extractCurrencies({ inventory: JSON.stringify({ Suits: [] }) })).toBeNull() // DE but no currencies
  })
})

describe('extractParts', () => {
  it('pulls prime parts (Recipes + MiscItems) with counts + ducats, summed', () => {
    const inv = {
      Suits: [],
      // Blueprints live in Recipes; components in MiscItems. Real WFCD ItemTypes.
      Recipes: [
        { ItemType: '/Lotus/Types/Recipes/WarframeRecipes/SarynPrimeBlueprint', ItemCount: 2 },
      ],
      MiscItems: [
        { ItemType: '/Lotus/Types/Recipes/WarframeRecipes/SarynPrimeChassisComponent', ItemCount: 3 },
        { ItemType: '/Lotus/Types/Recipes/WarframeRecipes/SarynPrimeSystemsComponent', ItemCount: 1 },
        { ItemType: '/Lotus/Types/Items/MiscItems/OrokinCell', ItemCount: 9999 }, // not a prime part → skipped
        { ItemCount: 3, ItemType: '/Lotus/Types/Game/Projections/T1VoidProjectionAtlasPrimeABronze' }, // relic → skipped
      ],
    }
    const got = extractParts({ inventory: JSON.stringify(inv) })
    const bp = got.find((p) => p.name === 'Saryn Prime Blueprint')
    const chassis = got.find((p) => p.name === 'Saryn Prime Chassis')
    const systems = got.find((p) => p.name === 'Saryn Prime Systems')
    expect(bp).toEqual({ name: 'Saryn Prime Blueprint', count: 2, ducats: 65 })
    expect(chassis).toEqual({ name: 'Saryn Prime Chassis', count: 3, ducats: 100 })
    expect(systems).toEqual({ name: 'Saryn Prime Systems', count: 1, ducats: 15 })
    expect(got.find((p) => /Orokin Cell/.test(p.name))).toBeUndefined()
    expect(got.length).toBe(3)
  })
  it('returns [] for non-DE / empty payloads', () => {
    expect(extractParts({})).toEqual([])
    expect(extractParts({ inventory: [{ name: 'x', count: 1 }] })).toEqual([])
  })
})

describe('extractProgress', () => {
  it('reads completed quests + star-chart node count', () => {
    const inv = {
      Suits: [],
      QuestKeys: [
        { ItemType: '/Lotus/Types/Keys/OrokinMoonQuest/OrokinMoonQuestKeyChain', Completed: true }, // Second Dream ✓
        { ItemType: '/Lotus/Types/Keys/WarWithinQuest/WarWithinQuestKeyChain', Completed: false }, // in progress → skip
        { ItemType: '/Lotus/Types/Keys/SomeUnknownQuest/UnknownQuestKeyChain', Completed: true }, // unknown → skip
      ],
      Missions: [
        { Tag: 'SolNode1', Completes: 5 },
        { Tag: 'SolNode2', Completes: 1 },
        { Tag: 'SolNode3', Completes: 0 }, // never cleared → not counted
      ],
    }
    const got = extractProgress({ inventory: JSON.stringify(inv) })
    expect(got).toEqual({ quests: ['The Second Dream'], starChartNodes: 2 })
  })
  it('returns null for non-DE / empty payloads', () => {
    expect(extractProgress({})).toBeNull()
    expect(extractProgress({ inventory: [{ name: 'x', count: 1 }] })).toBeNull()
  })
})

describe('extractCompletedTodos', () => {
  it('always reports daily_login for a live DE inventory', () => {
    const inv = { Suits: [], PlayerLevel: 10 }
    expect(extractCompletedTodos({ inventory: inv })).toEqual(['daily_login'])
  })
  it('adds standing when a syndicate hit the MR-scaled daily cap', () => {
    // MR10 cap = 1000 + 500*10 = 6000. Ostron capped, others below.
    const inv = {
      Suits: [],
      PlayerLevel: 10,
      DailyAffiliation: 3000,
      DailyAffiliationCetus: 6000,
      DailyAffiliationSolaris: 500,
    }
    expect(extractCompletedTodos({ inventory: JSON.stringify(inv) })).toEqual(['daily_login', 'standing'])
  })
  it('omits standing when no syndicate reached the cap', () => {
    const inv = { Suits: [], PlayerLevel: 10, DailyAffiliation: 5999 }
    expect(extractCompletedTodos({ inventory: inv })).toEqual(['daily_login'])
  })
  it('returns [] for non-DE / empty payloads', () => {
    expect(extractCompletedTodos({})).toEqual([])
    expect(extractCompletedTodos({ inventory: [{ name: 'x', count: 1 }] })).toEqual([])
  })
})
