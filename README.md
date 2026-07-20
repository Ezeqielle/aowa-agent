# AOWA Agent (ow-electron) — #34 P2

Desktop companion for [AOWA](https://aowa.ashguard.io): a Warframe **overlay +
dashboard** powered by AOWA's data, with optional live **GEP inventory sync**.
Built on **[ow-electron](https://dev.overwolf.com/ow-electron/)** (Overwolf's
Electron fork) so it gets Overwolf's Game Events Provider (GEP) and in-game
overlay while being **self-distributed** — no consumer app-store listing.

> **Why ow-electron (not native Overwolf):** the native-Overwolf build was
> rejected by the store as a "background/websocket relay." ow-electron is
> white-label + self-distributed, so that policy doesn't apply, and it still
> gives GEP (Warframe **is** supported — `Warframe = 8954` in
> `overwolf/ow-electron-packages-types`) + overlay. The previous native scaffold
> is in git history.

## Front-facing features (the value lives in the app)
- **Dashboard window** — live from AOWA: Baro Ki'Teer (location + countdown),
  Void Fissures, Sortie, Archon Hunt, open-world cycles. Plus pairing controls.
- **In-game overlay** (hotkey **Alt+Shift+A**) — a compact glance: Baro, top
  fissures, cycles.
- **System tray** — open dashboard / toggle overlay / quit.
- **Inventory sync** (background) — GEP inventory → AOWA (owned gear + relic
  counts), a supporting feature, not the whole app.

## Layout
| Path | Role |
| --- | --- |
| `src/main/main.ts` | Electron main: windows, tray, GEP subscribe → ingest, deep-link pairing, IPC |
| `src/main/preload.ts` | contextBridge API for the renderer |
| `src/main/store.ts` | agent-token persistence (userData JSON) |
| `src/renderer/dashboard.*` | main dashboard window |
| `src/renderer/overlay.*` | in-game overlay window |
| `src/renderer/panels.ts` | shared render helpers (Baro/fissures/cycles/…) |
| `src/lib/aowa-data.ts` | AOWA worldState client (fetched in main; CORS-safe) |
| `src/lib/api.ts` | AOWA agent API (pair + ingest) |
| `src/lib/inventory.ts` | GEP inventory → `{name,count}[]` normalizer |
| `src/lib/deeplink.ts` | `aowa://pair?code=` parser |

CORS note: the renderer never calls AOWA directly (Chromium would block it);
worldState is fetched in the **main** process (Node, no CORS) and passed over IPC.

## Build & run (Windows)
```powershell
npm install            # pulls @overwolf/ow-electron (+ builder, packages types)
npm run build          # renderer (vite) + main (tsc → dist/main)
npm start              # launches ow-electron
```
- **Dev Mode** runs the gaming packages (GEP/overlay) locally **without signing**.
- **Production** distribution needs your **own code-signing certificate**
  (DigiCert/Sectigo, etc.) — packaged via `npm run dist` (ow-electron-builder).
  No Overwolf store review required.

Verify on any OS (no ow-electron needed): `npm run test` (deeplink + inventory)
and `npx tsc -p tsconfig.web.json --noEmit` + `npx vite build` (renderer).

## Capture the real GEP inventory (on Windows, with Warframe)
`main.ts` logs raw GEP updates (`DEBUG_GEP`) tagged **`[AOWA-GEP]`**. Run the app
with Warframe, open your inventory, read the console, and tune
`src/lib/inventory.ts` `normalizeInventory()` (the single place) + confirm the
game id if needed.

## Pairing
AOWA → Profile → **Link agent** opens `aowa://pair?code=…` → the app pairs
(single-instance/deep-link handled in main). Manual code entry is in the
dashboard as a fallback.

## Next
- On-device GEP capture → finalize `normalizeInventory()`.
- Personal data in the UI (todos/relics/builds) needs the AOWA agent token to be
  accepted on those `/api/me/*` reads (small backend addition).
- Code-signing cert → `npm run dist` → ship.
