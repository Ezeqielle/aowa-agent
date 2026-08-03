// Typed client for the AOWA agent API (backend #34 P1, already live).
//   POST /api/agent/pair        (public)  code → long-lived bearer token
//   POST /api/me/agent/events   (bearer)  push an inventory snapshot
import { API_BASE } from './config'

export interface IngestItem {
  name: string
  count: number
  /** Gear leveled to max at least once (Mastery Rank) — surfaced in AOWA (#39/#42). */
  mastered?: boolean
}

export interface PairResponse {
  token: string
  tokenId: string
}

export interface IngestResult {
  received: number
  relics: number
  gear: number
  mastered: number
}

// pair exchanges a one-time pairing code (from the `aowa://pair?code=` deep link)
// for a long-lived agent token. The token is returned exactly once — persist it.
export async function pair(code: string, label = 'Overwolf agent'): Promise<PairResponse> {
  const res = await fetch(`${API_BASE}/agent/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, label }),
  })
  if (!res.ok) throw new Error(`pair failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as PairResponse
}

// Account balances pushed alongside the inventory snapshot (#52). Mirrors the
// Currencies shape in inventory.ts; forwarded so the web profile can show them.
export interface IngestCurrencies {
  platinum?: number
  credits?: number
  ducats?: number
  endo?: number
}

// A sellable prime part snapshot entry (#54): part name, owned count, ducat value.
export interface IngestPart {
  name: string
  count: number
  ducats: number
}

// ingestInventory pushes an inventory snapshot. The backend reconciles it:
// relic names → owned relic counts, gear names → craftables marked owned. Any
// currencies are stored per-user and surfaced on the web Account tab (#52);
// prime parts power the sellables view (#54).
export async function ingestInventory(
  token: string,
  items: IngestItem[],
  currencies?: IngestCurrencies | null,
  parts?: IngestPart[] | null,
  at: string = new Date().toISOString(),
): Promise<IngestResult> {
  const body: Record<string, unknown> = { events: [{ type: 'inventory', items, at }] }
  if (currencies) body.currencies = currencies
  if (parts && parts.length) body.parts = parts
  const res = await fetch(`${API_BASE}/me/agent/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (res.status === 401) throw new UnauthorizedError()
  if (!res.ok) throw new Error(`ingest failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as IngestResult
}

// Personal data the agent may read with its bearer token (backend #37).
export interface Todo {
  id: string
  title: string
  cadence: 'daily' | 'weekly'
  detail?: string
  node?: string
  done: boolean
}

async function getWithToken<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (res.status === 401) throw new UnauthorizedError()
  if (!res.ok) throw new Error(`${path} ${res.status}`)
  return (await res.json()) as T
}

// A saved build, trimmed to what the agent surfaces (the API returns more).
export interface Build {
  id: string
  name: string
  slug: string
  public: boolean
  craftable?: { name?: string }
  likeCount?: number
  updatedAt?: string
}

export const fetchTodos = (token: string) => getWithToken<Todo[]>('/me/todos', token)
export const fetchOwnedRelics = (token: string) => getWithToken<Record<string, number>>('/me/relics', token)
export const fetchBuilds = (token: string) => getWithToken<Build[]>('/me/builds', token)

// UnauthorizedError signals the token was revoked/invalid; the caller should drop
// it and return to the unpaired state.
export class UnauthorizedError extends Error {
  constructor() {
    super('agent token unauthorized')
    this.name = 'UnauthorizedError'
  }
}
