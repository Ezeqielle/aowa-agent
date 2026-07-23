import { describe, expect, it } from 'vitest'
import { matchEvent, parseLine } from './eelog'

describe('parseLine', () => {
  it('parses the "<seconds> Category [Level]: message" shape', () => {
    const l = parseLine('123.456 Sys [Info]: Change queue lock state')
    expect(l).toEqual({
      seconds: 123.456,
      category: 'Sys',
      level: 'Info',
      message: 'Change queue lock state',
      raw: '123.456 Sys [Info]: Change queue lock state',
    })
  })

  it('tolerates leading whitespace and integer seconds', () => {
    const l = parseLine('   15 Game [Diag]: hello')
    expect(l?.seconds).toBe(15)
    expect(l?.category).toBe('Game')
    expect(l?.message).toBe('hello')
  })

  it('returns null for non-log lines', () => {
    expect(parseLine('not a log line')).toBeNull()
    expect(parseLine('')).toBeNull()
  })
})

describe('matchEvent', () => {
  it('recognizes a session start', () => {
    const ev = matchEvent(parseLine('0.100 Sys [Diag]: Current time: Wed Jul 23 2026')!)
    expect(ev?.kind).toBe('session-start')
  })

  it('recognizes a mission end + reward detail', () => {
    const ev = matchEvent(parseLine('900.5 Script [Info]: EndOfMatch.lua: Got Void Projections!')!)
    expect(ev?.kind).toBe('mission-end')
    expect(ev?.detail).toBe('Got Void Projections!')
  })

  it('recognizes a host migration', () => {
    const ev = matchEvent(parseLine('500.0 Sys [Info]: Host migration in progress')!)
    expect(ev?.kind).toBe('host-migration')
  })

  it('returns null for unremarkable lines', () => {
    expect(matchEvent(parseLine('1.0 Sys [Info]: nothing interesting here')!)).toBeNull()
  })
})
