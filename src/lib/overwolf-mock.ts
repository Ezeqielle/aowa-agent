// Dev-only mock of the Overwolf runtime, so the agent can be exercised in a
// plain browser (`npm run dev`) without Overwolf/Warframe. It stubs just the
// APIs the agent touches and lets the dev harness push a simulated inventory
// update through the *real* GEP handler → normalize → debounce → ingest path.
// Never imported by the production bundle (only by src/dev).

type Listener = (u: unknown) => void

export function installOverwolfMock(): void {
  const g = globalThis as unknown as { overwolf?: unknown }
  if (g.overwolf) return

  const infoListeners: Listener[] = []
  g.overwolf = {
    games: {
      getRunningGameInfo: (cb: (i: unknown) => void) =>
        cb({ isRunning: true, id: 89541, classId: 8954, title: 'Warframe (mock)' }),
      events: {
        setRequiredFeatures: (features: string[], cb: (r: unknown) => void) =>
          cb({ success: true, supportedFeatures: features }),
        getInfo: (cb: (r: unknown) => void) => cb({ success: true, res: {} }),
        onInfoUpdates2: {
          addListener: (l: Listener) => infoListeners.push(l),
          removeListener: (l: Listener) => {
            const i = infoListeners.indexOf(l)
            if (i >= 0) infoListeners.splice(i, 1)
          },
        },
        onNewEvents: { addListener: () => {} },
        // Dev helper: fire all registered info listeners.
        __emit: (u: unknown) => infoListeners.forEach((l) => l(u)),
      },
    },
    extensions: { onAppLaunchTriggered: { addListener: () => {} } },
    utils: {
      openUrlInDefaultBrowser: (url: string) => window.open(url, '_blank'),
    },
    // Single-page dev harness: background + settings share this window.
    windows: { getMainWindow: () => window },
  }
}

// emitInventory feeds a simulated GEP inventory update into the agent.
export function emitInventory(items: { name: string; count: number }[]): void {
  const ev = (globalThis as unknown as {
    overwolf?: { games?: { events?: { __emit?: (u: unknown) => void } } }
  }).overwolf?.games?.events?.__emit
  ev?.({ feature: 'inventory', info: { inventory: items } })
}
