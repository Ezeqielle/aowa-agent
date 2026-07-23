import type { Cycle, WorldState } from '../lib/aowa-data'
import { baroHtml, cyclesHtml, fissuresHtml } from './panels'

const $ = (id: string) => document.getElementById(id) as HTMLElement

let ws: WorldState | null = null
let cycles: Cycle[] = []

function render(): void {
  if (!ws) return
  $('o-baro').innerHTML = baroHtml(ws)
  $('o-fissures').innerHTML = fissuresHtml(ws, 5)
  $('o-cycles').innerHTML = cyclesHtml(cycles)
}

async function refresh(): Promise<void> {
  try {
    const data = await window.aowa.worldState()
    ws = data.ws
    cycles = data.cycles
    render()
  } catch {
    /* overlay stays quiet on transient errors */
  }
}

async function initHint(): Promise<void> {
  try {
    const info = await window.aowa.getHotkey()
    $('o-hint').textContent = `${info.label} to toggle · drag to move`
  } catch {
    $('o-hint').textContent = 'drag to move'
  }
}

void initHint()
void refresh()
setInterval(() => void refresh(), 60_000)
setInterval(render, 1_000)
