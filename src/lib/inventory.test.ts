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
