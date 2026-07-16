// Dev harness entry: install the Overwolf mock BEFORE the background/settings
// modules run (they touch overwolf.* at import), then wire a "simulate
// inventory" button that pushes a fake snapshot through the real pipeline.
import { emitInventory, installOverwolfMock } from '../lib/overwolf-mock'
import { API_BASE } from '../lib/config'

installOverwolfMock()

// Dynamic imports so the mock is in place before these side-effecting modules.
await import('../background/background')
await import('../settings/settings')

document.getElementById('api-base')!.textContent = API_BASE

const SAMPLE = [
  { name: 'Excalibur', count: 1 },
  { name: 'Braton Prime', count: 1 },
  { name: 'Axi A1 Relic', count: 3 },
  { name: 'Meso F1 Relic', count: 2 },
]

document.getElementById('sim')!.addEventListener('click', () => {
  emitInventory(SAMPLE)
})
