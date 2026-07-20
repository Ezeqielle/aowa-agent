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

async function initStatus(): Promise<void> {
  renderStatus(await window.aowa.status())
  window.aowa.onStatus(renderStatus)
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
setInterval(() => void refresh(), 60_000) // fresh data
setInterval(render, 1_000) // live countdowns
