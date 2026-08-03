import { timeUntil } from '../lib/aowa-data'
import type { Cycle, Fissure, WorldState } from '../lib/aowa-data'
import type { OverlayConfig, Subscription } from './global'

// Always-on top bar (#60): a slim strip of world cycles + Baro + the void
// fissures the user is subscribed to. Sections are toggled from the dashboard
// (#61). Data comes from the main process (worldState + subscriptions).
const $ = (id: string) => document.getElementById(id) as HTMLElement

let ws: WorldState | null = null
let cycles: Cycle[] = []
let subs: Subscription[] = []
let cfg: OverlayConfig = { sections: { cycles: true, baro: true, fissures: true, sortie: false, archon: false }, topbar: true, hud: false, background: true }

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// A fissure matches a filter the same way the backend engine does: empty fields
// match anything; tier exact, mission substring, Steel Path / Railjack required
// only when set. A fissure shows if it matches ANY enabled fissure rule.
function subscribedFissures(): Fissure[] {
  const rules = subs.filter((s) => s.eventKind === 'fissure' && s.enabled).map((s) => s.filter ?? {})
  if (!rules.length) return []
  return (ws?.fissures ?? []).filter((f) =>
    rules.some(
      (flt) =>
        (!flt.tier || f.tier?.toLowerCase() === flt.tier.toLowerCase()) &&
        (!flt.missionType || (f.missionType ?? '').toLowerCase().includes(flt.missionType.toLowerCase())) &&
        (!flt.steelPath || f.steelPath) &&
        (!flt.railjack || f.railjack),
    ),
  )
}

function render(): void {
  const on = cfg.sections
  // #65: toggle the dark strip behind the bar; the chips keep their own pills.
  $('tb').classList.toggle('no-bg', cfg.background === false)
  const parts: string[] = []

  if (on.cycles && cycles.length) {
    const chips = cycles
      .map((c) => `<span class="tb-chip"><b>${esc(cap(c.world))}</b> ${esc(c.state)} · ${timeUntil(c.expiry)}</span>`)
      .join('')
    parts.push(`<span class="tb-group">${chips}</span>`)
  }

  if (on.baro && ws?.voidTraders?.length) {
    const b = ws.voidTraders[0]
    const label = b.active ? `at ${esc(b.node)} · leaves ${timeUntil(b.expiry)}` : `in ${timeUntil(b.activation)}`
    parts.push(`<span class="tb-group"><span class="tb-chip tb-baro"><b>Baro</b> ${label}</span></span>`)
  }

  if (on.fissures) {
    const fs = subscribedFissures()
    if (fs.length) {
      const chips = fs
        .slice(0, 6)
        .map(
          (f) =>
            `<span class="tb-chip tb-fissure${f.steelPath ? ' sp' : ''}"><b>${esc(f.tier)}</b> ${esc(f.missionType)} · ${timeUntil(f.expiry)}</span>`,
        )
        .join('')
      parts.push(`<span class="tb-group">${chips}</span>`)
    }
  }

  if (on.sortie && ws?.sorties?.length) {
    parts.push(`<span class="tb-group"><span class="tb-chip"><b>Sortie</b> ${esc(ws.sorties[0].boss)}</span></span>`)
  }
  if (on.archon && ws?.archonHunts?.length) {
    parts.push(`<span class="tb-group"><span class="tb-chip"><b>Archon</b> ${esc(ws.archonHunts[0].boss)}</span></span>`)
  }

  $('tb').innerHTML = parts.length ? parts.join('<span class="tb-sep"></span>') : '<span class="tb-loading">AOWA — no active sections</span>'
}

async function refresh(): Promise<void> {
  try {
    const [data, s] = await Promise.all([window.aowa.worldState(), window.aowa.subscriptions()])
    ws = data.ws
    cycles = data.cycles ?? []
    subs = s ?? []
  } catch {
    /* keep last data */
  }
  render()
}

async function init(): Promise<void> {
  cfg = await window.aowa.overlayConfig()
  window.aowa.onOverlayConfig((c) => {
    cfg = c
    render()
  })
  await refresh()
  setInterval(render, 1000) // live countdowns
  setInterval(refresh, 60_000) // fresh data
}

void init()
