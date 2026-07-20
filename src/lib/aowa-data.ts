// Read-only client for AOWA's public worldState — powers the front-facing
// dashboard + overlay (Baro, Void Fissures, Sortie, Archon, world cycles). All
// public endpoints, no auth. (In ow-electron the renderer can reach these; the
// pairing/ingest for personal data goes through the main process.)
import { API_BASE } from './config'

export interface Win {
  activation: string
  expiry: string
}
export interface VoidTrader extends Win {
  character: string
  node: string
  active: boolean
}
export interface Fissure extends Win {
  node: string
  missionType: string
  tier: string
  tierNum: number
  steelPath: boolean
  railjack: boolean
}
export interface Sortie extends Win {
  boss: string
  variants: { missionType: string; modifier: string; node: string }[]
}
export interface ArchonHunt extends Win {
  boss: string
  missions: { missionType: string; node: string }[]
}
export interface WorldState {
  timestamp: string
  voidTraders: VoidTrader[]
  fissures: Fissure[]
  sorties: Sortie[]
  archonHunts: ArchonHunt[]
  resets: { nextDaily: string; nextWeekly: string }
}
export interface Cycle {
  world: string
  state: string
  expiry: string
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) throw new Error(`AOWA ${res.status} on ${path}`)
  return (await res.json()) as T
}

export const fetchWorldState = () => get<WorldState>('/events')
export const fetchCycles = () => get<Cycle[]>('/events/cycles')

// timeUntil renders a compact "2d 3h", "4h 12m", "8m 30s", or "now".
export function timeUntil(iso: string, now: number = Date.now()): string {
  let s = Math.floor((new Date(iso).getTime() - now) / 1000)
  if (s <= 0) return 'now'
  const d = Math.floor(s / 86400)
  s -= d * 86400
  const h = Math.floor(s / 3600)
  s -= h * 3600
  const m = Math.floor(s / 60)
  s -= m * 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}
