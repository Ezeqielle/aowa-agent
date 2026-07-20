// Pure render helpers shared by the dashboard and overlay. Each returns an HTML
// string from AOWA worldState data. Text is escaped; timers are recomputed by
// the caller on a tick.
import { timeUntil, type Cycle, type WorldState } from '../lib/aowa-data'

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)

export function baroHtml(ws: WorldState): string {
  const baro = ws.voidTraders?.[0]
  if (!baro) return '<p class="muted">No Baro data.</p>'
  const when = baro.active ? `leaves in ${timeUntil(baro.expiry)}` : `arrives in ${timeUntil(baro.activation)}`
  return `<div class="kv"><span class="k">${esc(baro.character)}</span>
    <span class="v ${baro.active ? 'live' : ''}">${baro.active ? 'HERE' : 'away'}</span></div>
    <div class="sub">${esc(baro.node)} · ${when}</div>`
}

export function fissuresHtml(ws: WorldState, limit = 8): string {
  const fs = (ws.fissures ?? []).slice(0, limit)
  if (!fs.length) return '<p class="muted">No fissures.</p>'
  return (
    '<ul class="list">' +
    fs
      .map(
        (f) =>
          `<li><span class="tag tier-${esc(f.tier.toLowerCase())}">${esc(f.tier)}</span>
        <span class="name">${esc(f.missionType)}${f.steelPath ? ' · SP' : ''}</span>
        <span class="muted">${esc(f.node)}</span>
        <span class="time">${timeUntil(f.expiry)}</span></li>`,
      )
      .join('') +
    '</ul>'
  )
}

export function cyclesHtml(cycles: Cycle[]): string {
  if (!cycles?.length) return ''
  return (
    '<div class="cycles">' +
    cycles
      .map((c) => `<span class="cycle"><b>${esc(c.world)}</b> ${esc(c.state)} <span class="muted">${timeUntil(c.expiry)}</span></span>`)
      .join('') +
    '</div>'
  )
}

export function sortieHtml(ws: WorldState): string {
  const s = ws.sorties?.[0]
  if (!s) return '<p class="muted">No sortie.</p>'
  return `<div class="sub">${esc(s.boss)} · resets ${timeUntil(s.expiry)}</div>
    <ul class="list">${s.variants.map((v) => `<li><span class="name">${esc(v.missionType)}</span> <span class="muted">${esc(v.modifier)} · ${esc(v.node)}</span></li>`).join('')}</ul>`
}

export function archonHtml(ws: WorldState): string {
  const a = ws.archonHunts?.[0]
  if (!a) return '<p class="muted">No archon hunt.</p>'
  return `<div class="sub">${esc(a.boss)} · resets ${timeUntil(a.expiry)}</div>
    <ul class="list">${a.missions.map((m) => `<li><span class="name">${esc(m.missionType)}</span> <span class="muted">${esc(m.node)}</span></li>`).join('')}</ul>`
}
