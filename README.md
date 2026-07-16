# AOWA Agent (Overwolf) — #34 P2

Desktop companion for [AOWA](https://aowa.ashguard.io) that reads the player's
live Warframe session via Overwolf and syncs it to their AOWA account. This is
**phase P2** of enhancement #34; the AOWA-side pairing + ingest API (**P1**) is
already live.

> **Status: scaffold.** The project structure, pairing flow, GEP subscription,
> and ingest loop are written and type-check/build cleanly, but this has **not
> yet been run inside Overwolf on Windows**. Several values need on-device
> verification before it can ship — see [Before it ships](#before-it-ships).

## What it does

```
Warframe client ──GEP──▶ AOWA Agent (this app) ──HTTPS(bearer)──▶ AOWA API ──▶ your account
```

1. **Pair** — the AOWA web app (Profile → Game agent → Link agent) opens
   `aowa://pair?code=<code>`, which launches this app. The background window
   exchanges the code at `POST /api/agent/pair` for a long-lived bearer token
   and stores it.
2. **Sync** — it subscribes to Warframe's Game Events Provider (GEP) `inventory`
   feature and pushes debounced snapshots to `POST /api/me/agent/events`. AOWA
   reconciles them: relic names → owned relic counts, gear names → craftables
   marked owned.
3. **Revoke** — if AOWA reports the token revoked (401), the agent drops it and
   returns to the unpaired state.

## Layout

| Path | Role |
| --- | --- |
| `public/manifest.json` | Overwolf app manifest (game target, windows, `url_protocol`) |
| `src/background/` | invisible controller: pairing + GEP feed + ingest loop |
| `src/settings/` | small status window (connection state, open AOWA, unpair) |
| `src/lib/config.ts` | API base, game id, GEP features, debounce, constants |
| `src/lib/api.ts` | typed AOWA agent-API client (`pair`, `ingestInventory`) |
| `src/lib/overwolf.ts` | deep-link code parsing + GEP inventory subscription |
| `src/lib/inventory.ts` | normalize the GEP inventory payload → `{name,count}[]` |
| `src/lib/storage.ts` | token persistence (localStorage) |
| `src/types/overwolf.d.ts` | minimal ambient Overwolf typings (see below) |

## Develop

```bash
npm install
npm run typecheck      # tsc --noEmit
npm run build          # tsc && vite build → dist/
npm run dev            # vite dev server (window debug_url points at :5173)
```

Sideload in Overwolf: **Overwolf → Settings → About → Development options →
Load unpacked extension** → select the built `dist/` folder (contains
`manifest.json`). Use the background window's `debug_url` for DevTools.

## Dev testing (no Overwolf / no Windows)

Everything except the live GEP capture can be exercised on any OS:

```bash
npm test          # unit tests: deep-link parsing + inventory normalization
npm run dev        # then open http://localhost:5173/src/dev/dev.html
```

The **dev harness** (`src/dev/`) installs a mock Overwolf runtime and runs the
real pair → normalize → debounce → ingest pipeline in a plain browser:

1. Run AOWA locally with `FRONTEND_ORIGIN=http://localhost:5173` (browser CORS),
   or point the harness at it with `VITE_AOWA_API_BASE=http://localhost:8097/api`.
2. In AOWA → Profile → Game agent → **Link agent**, copy the one-time code.
3. Paste it into the harness and hit **Pair**, then **Simulate inventory sync**.
4. The fake inventory posts to AOWA; watch Inventory/Relics update and the
   status dot turn green.

This validates the whole flow end-to-end; only Warframe's *real* inventory feed
(shape + item-name format) needs Overwolf + Windows to confirm.

### Types

`src/types/overwolf.d.ts` declares only the API subset used here so the scaffold
builds offline. For full, accurate typings install the official package and drop
the local file:

```bash
npm i -D @overwolf/types
# then add "types": ["@overwolf/types"] to tsconfig.json compilerOptions
```

## Before it ships

Concrete items to verify on a Windows machine with Overwolf + Warframe, in order:

1. **Game id** — `config.WARFRAME_CLASS_ID` / `manifest game_ids` are set to
   `8954`. Confirm against Overwolf's supported-games list; Overwolf distinguishes
   a game's short *class id* from the longer runtime *game id*.
2. **GEP inventory granularity** — run Overwolf's GEP sample app against a live
   session and dump `match_info.inventory`. Confirm whether it includes **relics
   with counts** or only equippable gear, and capture the exact **item-name
   format** (e.g. `"Axi A1 Relic"` vs `"AxiA1"`). If relics aren't in GEP, they
   wait for P3 (EE.log).
3. **`normalizeInventory()`** — adjust to the real payload shape captured above
   (it currently handles the two likely shapes defensively).
4. **Name matching** — AOWA's `relicBase()` normalization must line up with the
   captured names; tune on either side as needed.
5. **Icons** — replace the placeholders in `public/icons/`
   (`icon256.png`, `icon256_gray.png`, `icon.ico`) with real assets; Overwolf
   packaging requires them.
6. **Package & submit** — build the `.opk` and submit to the Overwolf store for
   review (the main lead-time item). Update the AOWA Profile panel's install link.

**Done:** manual code entry — the settings window has a "one-time pairing code"
input + Pair button (delegates to the background controller via `lib/bridge`),
so pairing works even if the `aowa://` deep link doesn't fire.

## Later phases

- **P3** — tail `EE.log` for relic-reward choices, mission start/end, standing →
  relic-run history + live todo progress (unofficial; behind a clear opt-in).
- **P4** — in-game overlay window (today's todos / Baro / fissures).
