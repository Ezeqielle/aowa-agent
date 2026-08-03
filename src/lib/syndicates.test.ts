import { describe, expect, it } from 'vitest'
import { extractSyndicates } from './syndicates'

describe('extractSyndicates', () => {
  it('maps Affiliations to standing + MR-scaled daily cap', () => {
    // MR10 ⇒ cap = 1000 + 500*10 = 6000.
    const inv = {
      Suits: [],
      PlayerLevel: 10,
      DailyAffiliation: 4000, // shared core pool
      DailyAffiliationCetus: 6000, // Ostron capped
      Affiliations: [
        { Tag: 'SteelMeridianSyndicate', Standing: 132000, Title: 'General' },
        { Tag: 'CetusSyndicate', Standing: 70000 },
      ],
    }
    const got = extractSyndicates({ inventory: JSON.stringify(inv) })
    // Sorted by name: Ostron before Steel Meridian.
    expect(got).toEqual([
      { key: 'ostron', name: 'Ostron', standing: 70000, title: undefined, dailyEarned: 6000, dailyCap: 6000, dailyShared: undefined },
      {
        key: 'steel_meridian',
        name: 'Steel Meridian',
        standing: 132000,
        title: 'General',
        dailyEarned: 4000,
        dailyCap: 6000,
        dailyShared: true,
      },
    ])
  })

  it('humanizes unknown tags and gives them no daily bar', () => {
    const inv = { Suits: [], PlayerLevel: 5, Affiliations: [{ Tag: 'SomeFutureSyndicate', Standing: 100 }] }
    const got = extractSyndicates({ inventory: inv })
    expect(got).toEqual([
      { key: 'some_future', name: 'Some Future', standing: 100, title: undefined, dailyEarned: 0, dailyCap: 0, dailyShared: undefined },
    ])
  })

  it('drops localization-path titles', () => {
    const inv = {
      Suits: [],
      PlayerLevel: 0,
      Affiliations: [{ Tag: 'EntratiSyndicate', Standing: 5000, Title: '/Lotus/Language/Syndicates/EntratiRank3' }],
    }
    expect(extractSyndicates({ inventory: inv })[0].title).toBeUndefined()
  })

  it('returns [] for non-DE / empty / affiliation-less payloads', () => {
    expect(extractSyndicates({})).toEqual([])
    expect(extractSyndicates({ inventory: [{ name: 'x', count: 1 }] })).toEqual([])
    expect(extractSyndicates({ inventory: { Suits: [], Affiliations: [] } })).toEqual([])
  })
})
