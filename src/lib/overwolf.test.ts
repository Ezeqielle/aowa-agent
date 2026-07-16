import { describe, expect, it } from 'vitest'
import { extractPairCode } from './overwolf'

describe('extractPairCode', () => {
  it('parses a well-formed deep link', () => {
    expect(extractPairCode('aowa://pair?code=ABC123')).toBe('ABC123')
  })
  it('parses with extra params and trims', () => {
    expect(extractPairCode('aowa://pair?code=xY_9-8&foo=bar')).toBe('xY_9-8')
  })
  it('rejects a foreign scheme', () => {
    expect(extractPairCode('https://pair?code=ABC123')).toBeNull()
  })
  it('rejects the wrong action', () => {
    expect(extractPairCode('aowa://open?code=ABC123')).toBeNull()
  })
  it('rejects a missing code', () => {
    expect(extractPairCode('aowa://pair')).toBeNull()
  })
  it('rejects junk', () => {
    expect(extractPairCode('not a url')).toBeNull()
    expect(extractPairCode('')).toBeNull()
  })
})
