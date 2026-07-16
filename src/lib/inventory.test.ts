import { describe, expect, it } from 'vitest'
import { normalizeInventory } from './inventory'

describe('normalizeInventory', () => {
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
