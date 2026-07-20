import type { Cycle, WorldState } from '../lib/aowa-data'
import { archonHtml, baroHtml, cyclesHtml, fissuresHtml, sortieHtml } from './panels'

const $ = (id: string) => document.getElementById(id) as HTMLElement

let ws: WorldState | null = null
let cycles: Cycle[] = []

function render(): void {
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
    cycles = data.cycles
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
void refresh()
setInterval(() => {
  void refresh()
  void refreshMe()
}, 60_000) // fresh data
setInterval(render, 1_000) // live countdowns
