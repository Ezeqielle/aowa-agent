// Parser for Warframe's EE.log (default %LOCALAPPDATA%\Warframe\EE.log).
//
// It's an extra data source beyond GEP: the client log records session,
// mission and reward activity that GEP doesn't surface. Each line looks like:
//
//     123.456 Category [Level]: message
//
// where Category ∈ {Sys, Game, Script, Net, …} and Level ∈ {Info, Diag,
// Warning, Error, …}. The leading number is seconds since the game launched.
//
// This module is pure (no fs) so it's unit-testable; the tailer that feeds it
// live lines lives in src/main/eelog.ts.

export interface EELogLine {
  seconds: number
  category: string
  level: string
  message: string
  raw: string
}

const LINE_RE = /^\s*(\d+(?:\.\d+)?)\s+(\w+)\s+\[([^\]]+)\]:\s?(.*)$/

export function parseLine(raw: string): EELogLine | null {
  const m = LINE_RE.exec(raw)
  if (!m) return null
  return { seconds: Number(m[1]), category: m[2], level: m[3], message: m[4], raw }
}

export type EELogEventKind = 'session-start' | 'mission-start' | 'mission-end' | 'host-migration' | 'other'

export interface EELogEvent {
  kind: EELogEventKind
  label: string
  detail?: string
  seconds: number
  raw: string
}

interface Rule {
  kind: EELogEventKind
  test: RegExp
  label: (m: RegExpMatchArray, line: EELogLine) => string
  detail?: (m: RegExpMatchArray, line: EELogLine) => string | undefined
}

// Best-effort rules. EE.log wording shifts between game updates, so treat these
// as a starting point: run the agent with DEBUG_EE to dump parsed lines and
// extend/tighten this list against your real log. Add new kinds here only.
const RULES: Rule[] = [
  { kind: 'session-start', test: /Current time:\s*(.+)/i, label: () => 'Game session started' },
  {
    kind: 'mission-start',
    test: /Mission ?name:\s*(.+)/i,
    label: (m) => `Mission: ${m[1].trim()}`,
  },
  {
    kind: 'mission-start',
    test: /ThemedSquadOverlay\.lua:\s*(?:Host|Client) (?:loading|joining) into (.+)/i,
    label: (m) => `Loading: ${m[1].trim()}`,
  },
  {
    kind: 'mission-end',
    test: /EndOfMatch\.lua:\s*(.+)/i,
    label: () => 'Mission complete',
    detail: (m) => m[1].trim(),
  },
  { kind: 'host-migration', test: /host\s*migration/i, label: () => 'Host migration' },
]

export function matchEvent(line: EELogLine): EELogEvent | null {
  for (const r of RULES) {
    const m = line.message.match(r.test)
    if (m) {
      return { kind: r.kind, label: r.label(m, line), detail: r.detail?.(m, line), seconds: line.seconds, raw: line.raw }
    }
  }
  return null
}
