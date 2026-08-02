import type { Cycle, WorldState } from '../lib/aowa-data'
import type { Activity, GepState } from './global'
import { archonHtml, baroHtml, cyclesHtml, fissuresHtml, sortieHtml } from './panels'

const $ = (id: string) => document.getElementById(id) as HTMLElement

let ws: WorldState | null = null
let cycles: Cycle[] = []
let gep: GepState = { gameRunning: false, lastUpdate: 0 }

function ago(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`
}

// Live in-game data indicator. Green = receiving GEP updates; amber = Warframe
// detected but no data yet; grey = waiting for the game.
function renderGep(): void {
  const dot = $('gep-dot')
  const text = $('gep-text')
  const fresh = gep.lastUpdate > 0 && Date.now() - gep.lastUpdate < 120_000
  dot.classList.toggle('on', fresh)
  dot.classList.toggle('warn', gep.gameRunning && !fresh)
  if (gep.lastUpdate > 0) {
    text.textContent = fresh
      ? `Game data: live · ${ago(Date.now() - gep.lastUpdate)}`
      : `Game data: idle · last ${ago(Date.now() - gep.lastUpdate)}`
  } else {
    text.textContent = gep.gameRunning ? 'Warframe detected — awaiting data' : 'Game data: waiting for Warframe'
  }
}

function render(): void {
  renderGep()
  if (!ws) return
  $('baro').innerHTML = baroHtml(ws)
  $('fissures').innerHTML = fissuresHtml(ws)
  $('sortie').innerHTML = sortieHtml(ws)
  $('archon').innerHTML = archonHtml(ws)
  $('cycles').innerHTML = cyclesHtml(cycles)
}

async function refresh(): Promise<void> {
  try {
    const data = await window.aowa.worldState()
    ws = data.ws
    cycles = data.cycles ?? []
    $('err').textContent = ''
    render()
  } catch (e) {
    $('err').textContent = `Couldn't reach AOWA: ${e}`
  }
}

function renderStatus(s: { paired: boolean }): void {
  $('dot').classList.toggle('on', s.paired)
  $('status-text').textContent = s.paired ? 'Agent linked' : 'Not linked'
  ;($('unpair') as HTMLButtonElement).disabled = !s.paired
}

const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)

async function refreshMe(): Promise<void> {
  const me = await window.aowa.me()
  if (!me.paired) {
    $('mytodos').innerHTML = '<p class="muted">Link the agent to see your daily/weekly tasks.</p>'
    return
  }
  const todos = me.todos ?? []
  const done = todos.filter((t) => t.done).length
  const rows = todos
    .slice(0, 12)
    .map(
      (t) =>
        `<li><span class="tag">${t.cadence === 'weekly' ? 'W' : 'D'}</span>
        <span class="name" style="${t.done ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(t.title)}</span>
        ${t.node ? `<span class="muted">${esc(t.node)}</span>` : ''}</li>`,
    )
    .join('')
  const relicTotal = Object.values(me.relics ?? {}).reduce((a, b) => a + b, 0)
  $('mytodos').innerHTML =
    `<div class="sub">${done}/${todos.length} done · ${relicTotal} relics owned</div>` +
    (rows ? `<ul class="list">${rows}</ul>` : '<p class="muted">No tasks.</p>')
}

async function initStatus(): Promise<void> {
  const onStatus = (s: { paired: boolean }) => {
    renderStatus(s)
    void refreshMe()
  }
  onStatus(await window.aowa.status())
  window.aowa.onStatus(onStatus)
}

// Overlay-hotkey rebinding: click the button, then press a combo. Uses
// KeyboardEvent.code so the binding is keyboard-layout independent.
async function initHotkey(): Promise<void> {
  const btn = $('hk-btn') as HTMLButtonElement
  const info = await window.aowa.getHotkey()
  btn.textContent = info.label
  let capturing = false
  const stop = () => {
    capturing = false
    btn.classList.remove('capturing')
    window.removeEventListener('keydown', onKey, true)
  }
  const onKey = (ev: Event) => {
    if (!capturing) return
    const e = ev as KeyboardEvent
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      void window.aowa.getHotkey().then((i) => (btn.textContent = i.label))
      stop()
      return
    }
    // Wait for a non-modifier key so the combo has a real key.
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return
    void window.aowa
      .setHotkey({ code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey })
      .then((i) => (btn.textContent = i.label))
    stop()
  }
  btn.addEventListener('click', () => {
    if (capturing) {
      stop()
      return
    }
    capturing = true
    btn.classList.add('capturing')
    btn.textContent = 'Press keys…'
    window.addEventListener('keydown', onKey, true)
  })
}

function renderActivity(list: Activity[]): void {
  if (!list.length) {
    $('activity').innerHTML = '<p class="muted">Waiting for in-game activity (EE.log)…</p>'
    return
  }
  const rows = list
    .slice(0, 12)
    .map(
      (a) =>
        `<li><span class="tag">${esc(a.kind)}</span>
        <span class="name">${esc(a.label)}</span>
        ${a.detail ? `<span class="muted">${esc(a.detail)}</span>` : ''}
        <span class="time">${ago(Date.now() - a.at)}</span></li>`,
    )
    .join('')
  $('activity').innerHTML = `<ul class="list">${rows}</ul>`
}

async function initActivity(): Promise<void> {
  renderActivity(await window.aowa.activity())
  window.aowa.onActivity(renderActivity)
}

async function initGepIndicator(): Promise<void> {
  const onGep = (s: GepState) => {
    const wasFresh = gep.lastUpdate
    gep = s
    renderGep()
    // A fresh inventory push means the server just ingested new data — reflect it.
    if (s.lastUpdate > wasFresh) void refreshMe()
  }
  gep = await window.aowa.gep()
  renderGep()
  window.aowa.onGep(onGep)
}

function wireControls(): void {
  $('open-aowa').addEventListener('click', () => void window.aowa.openAowa())
  $('unpair').addEventListener('click', () => void window.aowa.unpair())
  const pair = async () => {
    const input = $('code') as HTMLInputElement
    const res = await window.aowa.pair(input.value)
    if (res.ok) input.value = ''
    else $('err').textContent = res.error ?? 'pairing failed'
  }
  $('pair').addEventListener('click', () => void pair())
  ;($('code') as HTMLInputElement).addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void pair()
  })
}

wireControls()
void initStatus()
void initHotkey()
void initActivity()
void initGepIndicator()
void refresh()
setInterval(() => {
  void refresh()
  void refreshMe()
}, 60_000) // fresh data
setInterval(render, 1_000) // live countdowns
