// Typed client for the AOWA agent API (backend #34 P1, already live).
//   POST /api/agent/pair        (public)  code → long-lived bearer token
//   POST /api/me/agent/events   (bearer)  push an inventory snapshot
import { API_BASE } from './config'

export interface IngestItem {
  name: string
  count: number
}

export interface PairResponse {
  token: string
  tokenId: string
}

export interface IngestResult {
  received: number
  relics: number
  gear: number
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

// ingestInventory pushes an inventory snapshot. The backend reconciles it:
// relic names → owned relic counts, gear names → craftables marked owned.
export async function ingestInventory(
  token: string,
  items: IngestItem[],
  at: string = new Date().toISOString(),
): Promise<IngestResult> {
  const res = await fetch(`${API_BASE}/me/agent/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ events: [{ type: 'inventory', items, at }] }),
  })
  if (res.status === 401) throw new UnauthorizedError()
  if (!res.ok) throw new Error(`ingest failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as IngestResult
}

// UnauthorizedError signals the token was revoked/invalid; the caller should drop
// it and return to the unpaired state.
export class UnauthorizedError extends Error {
  constructor() {
    super('agent token unauthorized')
    this.name = 'UnauthorizedError'
  }
}
