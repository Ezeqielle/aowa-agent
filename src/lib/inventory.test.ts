import { describe, expect, it } from 'vitest'
import { findInventoryValue, normalizeInventory } from './inventory'

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
