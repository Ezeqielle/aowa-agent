import type { Cycle, WorldState } from '../lib/aowa-data'
import type { Activity, Currencies, GepState, SyncState } from './global'
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
    $('mybuilds').innerHTML = '<p class="muted">Link the agent to see your saved builds.</p>'
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

  // Saved builds (#37): open the shared build page in the browser on click.
  const builds = me.builds ?? []
  const buildRows = builds
    .slice(0, 12)
    .map(
      (b) =>
        `<li><span class="tag">${b.public ? '↗' : '🔒'}</span>
        <a class="name build-link" href="#" data-slug="${esc(b.slug)}">${esc(b.name)}</a>
        ${b.craftable?.name ? `<span class="muted">${esc(b.craftable.name)}</span>` : ''}
        ${b.likeCount ? `<span class="time">♥ ${b.likeCount}</span>` : ''}</li>`,
    )
    .join('')
  $('mybuilds').innerHTML =
    `<div class="sub">${builds.length} saved</div>` +
    (buildRows ? `<ul class="list">${buildRows}</ul>` : '<p class="muted">No builds yet.</p>')
  $('mybuilds')
    .querySelectorAll<HTMLAnchorElement>('a.build-link')
    .forEach((a) =>
      a.addEventListener('click', (e) => {
        e.preventDefault()
        const slug = a.dataset.slug
        if (slug) void window.aowa.openBuild(slug)
      }),
    )
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

// Account sync (#47): a checklist of which data categories synced this run. The
// numbers live in the Account card; this card just confirms each category came
// through (✓) and shows staleness.
let syncState: SyncState | null = null
function renderSync(): void {
  if (!syncState) {
    $('sync').innerHTML = '<p class="muted">No inventory synced yet — launch Warframe with the agent running.</p>'
    return
  }
  const s = syncState
  const items: Array<[string, boolean]> = [
    ['Relics', s.relics > 0],
    ['Owned', s.gear > 0],
    ['Mastered', s.mastered > 0],
    ['Currency', s.currency],
    ['Sellables', s.parts > 0],
    ['Quests', s.quests > 0],
    ['Star chart', s.starChart > 0],
    ['Syndicates', s.syndicates > 0],
    ['Todos auto-checked', s.autoChecked > 0],
  ]
  const rows = items
    .map(([label, ok]) => `<li class="${ok ? 'ok' : 'off'}"><span class="tick">${ok ? '✓' : '○'}</span> ${label}</li>`)
    .join('')
  $('sync').innerHTML = `<ul class="sync-list">${rows}</ul><div class="sub">Last sync ${ago(Date.now() - s.at)} · ${s.received} items</div>`
}

async function initSync(): Promise<void> {
  syncState = await window.aowa.sync()
  renderSync()
  renderCurrencies()
  window.aowa.onSync((s) => {
    syncState = s
    renderSync()
    renderCurrencies() // counts live in the Account card
  })
}

// Account balances (#52): plat / credits / ducats / endo read off the same GEP
// inventory payload as the mastery sync. Large numbers get thousands separators.
let currencies: Currencies | null = null
const fmt = (n: number) => n.toLocaleString('en-US')
// Account card (#52 + enhancement): the numbers — currency balances plus the
// relics/owned/mastered/quest/star-chart counts (moved here from Account sync).
function renderCurrencies(): void {
  const c = currencies
  const s = syncState
  const curCells: Array<[string, number | undefined, string]> = [
    ['Platinum', c?.platinum, 'plat'],
    ['Credits', c?.credits, 'cr'],
    ['Ducats', c?.ducats, 'ducats'],
    ['Endo', c?.endo, 'endo'],
    ['Heartcell', c?.heartcell, 'heartcell'],
  ]
  const curRows = curCells
    .filter(([, v]) => typeof v === 'number')
    .map(([label, v, cls]) => `<span class="stat cur cur-${cls}"><b>${fmt(v as number)}</b>${label}</span>`)
    .join('')
  const countCells: Array<[string, number | undefined]> = [
    ['Relics', s?.relics],
    ['Owned', s?.gear],
    ['Mastered', s?.mastered],
    ['Quests', s?.quests],
    ['Star chart', s?.starChart],
  ]
  const countRows = countCells
    .filter(([, v]) => typeof v === 'number')
    .map(([label, v]) => `<span class="stat"><b>${fmt(v as number)}</b>${label}</span>`)
    .join('')
  const html =
    (curRows ? `<div class="sync-stats currencies">${curRows}</div>` : '') +
    (countRows ? `<div class="sync-stats">${countRows}</div>` : '')
  $('currencies').innerHTML = html || '<p class="muted">Balances appear once Warframe syncs your inventory.</p>'
}

async function initCurrencies(): Promise<void> {
  currencies = await window.aowa.currencies()
  renderCurrencies()
  window.aowa.onCurrencies((c) => {
    currencies = c
    renderCurrencies()
  })
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

// Custom titlebar window controls (#53): frameless window, so min/max/close live
// in-page. The maximize glyph reflects the current OS window state.
function wireTitlebar(): void {
  const maxBtn = $('win-max')
  const setMaxState = (max: boolean) => {
    maxBtn.classList.toggle('is-max', max)
    maxBtn.title = max ? 'Restore' : 'Maximize'
  }
  $('win-min').addEventListener('click', () => void window.aowa.winMinimize())
  maxBtn.addEventListener('click', () => void window.aowa.winMaximize().then(setMaxState))
  $('win-close').addEventListener('click', () => void window.aowa.winClose())
  window.aowa.onWinMaximized(setMaxState)
  void window.aowa.winIsMaximized().then(setMaxState)
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

// Overlay settings (#60/#61): top-bar toggle + which sections show.
async function initOverlaySettings(): Promise<void> {
  const cfg = await window.aowa.overlayConfig()
  const topbar = $('ov-topbar') as HTMLInputElement
  const background = $('ov-background') as HTMLInputElement
  topbar.checked = cfg.topbar
  background.checked = cfg.background
  const secBoxes = Array.from(document.querySelectorAll<HTMLInputElement>('#overlay-settings input[data-sec]'))
  for (const b of secBoxes) b.checked = !!cfg.sections[b.dataset.sec as keyof typeof cfg.sections]
  const save = () => {
    const sections = { ...cfg.sections }
    for (const b of secBoxes) sections[b.dataset.sec as keyof typeof sections] = b.checked
    void window.aowa.setOverlayConfig({ topbar: topbar.checked, hud: cfg.hud, background: background.checked, sections })
  }
  topbar.addEventListener('change', save)
  background.addEventListener('change', save)
  for (const b of secBoxes) b.addEventListener('change', save)
  // Keep the checkboxes in sync when toggled elsewhere (hotkey / tray).
  window.aowa.onOverlayConfig((c) => {
    topbar.checked = c.topbar
    background.checked = c.background
    for (const b of secBoxes) b.checked = !!c.sections[b.dataset.sec as keyof typeof c.sections]
  })
}

wireTitlebar()
wireControls()
void initOverlaySettings()
void initStatus()
void initHotkey()
void initActivity()
void initGepIndicator()
void initSync()
void initCurrencies()

// Re-render the "last sync ... ago" relative time periodically.
setInterval(renderSync, 30_000)
void refresh()
setInterval(() => {
  void refresh()
  void refreshMe()
}, 60_000) // fresh data
setInterval(render, 1_000) // live countdowns
