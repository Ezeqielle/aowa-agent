// Live tailer for Warframe's EE.log. Polls for appended bytes, parses new lines
// (src/lib/eelog.ts), and emits recognized events. Handles truncation (the game
// rewrites the log from scratch on restart) by resetting the read offset.
import { promises as fsp } from 'node:fs'
import { DEBUG_EE, EE_POLL_MS } from '../lib/config'
import { matchEvent, parseLine, type EELogEvent } from '../lib/eelog'

export interface EELogTailer {
  stop(): void
}

export function startEELogTail(
  path: string,
  onEvent: (e: EELogEvent) => void,
  pollMs: number = EE_POLL_MS,
): EELogTailer {
  let offset = 0
  let carry = ''
  let stopped = false
  let timer: ReturnType<typeof setInterval> | null = null

  async function tick(): Promise<void> {
    let st: { size: number }
    try {
      st = await fsp.stat(path)
    } catch {
      return // file missing / transient — retry next tick
    }
    if (st.size < offset) {
      offset = 0 // truncated → game restarted
      carry = ''
    }
    if (st.size <= offset) return

    const fh = await fsp.open(path, 'r').catch(() => null)
    if (!fh) return
    try {
      const len = st.size - offset
      const buf = Buffer.alloc(len)
      await fh.read(buf, 0, len, offset)
      offset = st.size
      const text = carry + buf.toString('utf8')
      const lines = text.split(/\r?\n/)
      carry = lines.pop() ?? '' // last element is a partial line; keep for next read
      for (const raw of lines) {
        const line = parseLine(raw)
        if (!line) continue
        if (DEBUG_EE) console.log('[AOWA-EE]', line.category, `[${line.level}]`, line.message)
        const ev = matchEvent(line)
        if (ev) onEvent(ev)
      }
    } catch (e) {
      console.error('[AOWA-EE] read failed', e)
    } finally {
      await fh.close().catch(() => {})
    }
  }

  // Start at the current end so we follow new activity rather than replaying the
  // whole existing log on launch.
  fsp
    .stat(path)
    .then((st) => {
      offset = st.size
    })
    .catch(() => {
      offset = 0
    })
    .finally(() => {
      if (!stopped) timer = setInterval(() => void tick(), pollMs)
    })

  return {
    stop() {
      stopped = true
      if (timer) clearInterval(timer)
    },
  }
}
