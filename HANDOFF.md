# Handoff: Temporal GIS POC

Last updated: 2026-11-01, after moving the `Satellite` area to Al Madinah and re-tracing its changes. Build, all three data tests and the headless smoke test pass (except the known 3D load-test timeout).

**Start here:** the POC is demo-ready on `Satellite`, opening on a real 3-month comparison. Open items are under "Next steps". The biggest risk left is 3D performance on the 20K load test, which needs a real GPU.

The user often writes in Egyptian Arabic but has asked for answers in English. They stressed that this is **just a POC**: keep changes simple. They plan to pitch it to a client as a software company.

## Goal

A small frontend-only Angular + Esri ArcGIS POC, to win approval before any backend work starts.

- Two synchronized maps show the same view at two different dates. Moving one moves the other.
- Supports 2D and 3D, and both images and satellite.
- Highlights what changed in the current view with transparent polygons, using graphics layers.
- Compares many epochs, picked by **month and year**. A 3-month comparison should show changes.
- Changes spread over several areas within a few km, so panning shows new ones.
- Change kinds include building progress, new buildings, new roads, vehicles and demolitions.
- Handles very high geometry.

## Decisions already made by the user

Do not reopen these.

| Topic | Decision |
|---|---|
| Data | Static, drawn or prepared by the agent, at an acceptable accuracy |
| Change detection | None. Changes are static metadata. No backend |
| "High geometry" | Both many buildings and many vertices per polygon. Target: about 20,000 buildings with 30–100 vertices each |
| Imagery | Real imagery, using Esri Wayback |
| Many epochs | Two maps, with any two dates picked from a timeline. Not 3–4 maps at once |
| Epoch granularity | The user picks **month and year**. Epochs are `YYYYMM` integers everywhere |
| Area | **Al Madinah al Munawwarah**, Bani Muawiyah, from the user's Google Maps link: `39.6224786, 24.4704609`. About 3 × 3 km. (The earlier east-Cairo area is in git history, commit `b9401ae`.) |
| Git | The user set up the repo. Push straight to `main` at https://github.com/mahmoudamgad/TEMPORALGIS, when the user asks |

## Current state

Git repository on `main`, tracking `origin`. Pushed: `df9848d` (whole POC, Cairo area) and `b9401ae` (Wayback level cap). The Madinah move and everything after it are **not committed yet** unless the log says otherwise.

### Done

- **`Satellite` is the default source**, opening on **Mar 2025 → Jun 2025** (a real 3-month window with its own imagery update) at zoom 15.5.
- **Madinah imagery**: all zoom-16 tiles of the ~3 km area change together at exactly 10 Wayback releases: Jan 2018, Mar 2018, Dec 2019, Oct 2020, Apr 2021, Jun 2022, Jun 2023, **Mar 2025, Jun 2025**, Mar 2026. These are the timeline stops (`REAL_IMAGERY`). Every month from Jan 2018 to Mar 2026 can be picked (`REAL_EPOCHS`, derived from the first and last stop); a month shows the latest imagery up to it.
- **32 real change polygons** in `REAL_FEATURES`, mostly the large redevelopment project east of the Prophet's Mosque:
  - 10 `Construction` with progress revisions: the north–south spine tunnel (graded Jun 2022 → trench Jun 2023 → structure Mar 2025 → roofed Jun 2025), three cross-structures, a pit grid, two towers, a northern construction site.
  - 8 `Building`, 5 `Earthwork`, 2 `Road`, 7 `Vehicles` (dump trucks, parked cars, coaches, excavators, an equipment yard; traced at zoom 19 for the bus park).
  - 8 removals: demolished residential blocks west of the highway (gone by Mar 2025), houses, tents, a hall, the old ring-road arc, a filled-in excavation, dump trucks that left.
  - Areas: project core, the cleared blocks west of the highway, the north construction site, the northern tunnel works, the camps.
- **Change counts**: Mar → Jun 2025: 18 (9 added, 2 removed, 7 modified); Dec 2025 → Mar 2026: 4; Jan 2018 → Mar 2026: 30. Mar 2018 and Oct 2020 show no traced change: nothing confirmable at this scale. `verify_real_data.py` allows that (at least 7 of 9 updates must have changes).
- Each Wayback release has a `maxLevel` (17 for Jan 2018, 19 for the rest at Madinah); the `WebTileLayer` `tileInfo` uses it, so close-ups upsample instead of hitting tiles that fail CORS. `MapView` gets explicit `constraints.lods`.
- Map attribution now reads "Esri, Vantor, Earthstar Geographics, and the GIS User Community" (Maxar's new name), as the Wayback items require.
- Sidebar shows "N of M changes in view"; when all are off-screen, the empty list says so.
- Month and Year selects per map, month-labelled timeline with change counts, Baseline/Comparison toggle, Play.
- `Images` (synthetic, 105 buildings) and `Load test 20K` (20,000 buildings, 1,397,560 vertices) sources are unchanged.

### Verified

On 2026-11-01, on the final code:

- `ng build` exits 0. `verify_demo_data.py`, `verify_load_test.py`, `verify_real_data.py` pass.
- Overlay screenshots of the whole area (Jan 2018 vs Mar 2026) and of the project core (Mar → Jun 2025): every polygon sits on its object; removals show as dashed ghosts.
- Headless smoke test (`node tools/browser-check/smoke.mjs http://localhost:4200/`): Satellite default window has 18 changes; Baseline and Comparison clicks set the right map; Play advanced two stops in 4 s; Satellite 3D loaded; wheel-zoom sync works; **0 console errors**; the only failed request is `favicon.ico`. It then timed out on `Load test` 3D, as before.
- In the browser pane: Play wraps from the last stop to the first; Pause stops it in place.
- Wayback licence: every release item says "licensed under the Esri Master License Agreement", attribution as above, not for offline tile export. For a commercial product the client needs an Esri licence (ArcGIS Location Platform, ArcGIS Online or Enterprise); confirm with Esri.

### Not verified / known issues

- **`Load test` in 3D never reached idle** on SwiftShader (smoke test timeout). No real-GPU numbers.
- Polygons are traced by eye, roughly ±5–20 m. The user has not reviewed them yet.
- Switching 2D/3D while a view is still loading can log `FeatureSourceEventLog` errors from the destroyed view.
- 3D ghost symbols have not been looked at closely.

## Next steps

1. **Commit and push** the Madinah move when the user asks.
2. **Test the load test on a real GPU** in 2D and 3D, using the FPS badge (the user's machine).
3. **User reviews the polygons**; adjust `tools/trace/traced.json` and regenerate.
4. Before the client demo: rehearse; present it as the visualisation and review layer, with detection, imagery licensing and monthly imagery as phase 2.

### How polygons were traced (`tools/trace/`)

- `capture.mjs <config.json>` opens the app in headless Chrome, switches to `Satellite`, sets the right map to each epoch in `config.epochs`, overlays a 50 px grid and saves a screenshot plus `<prefix>-view.json`. Config: `{ center: [lon, lat], zoom, epochs, prefix, size, grid, changes }`. The epochs must be months the app knows, so update `WAYBACK_RELEASES` first when moving the area. **Do not edit `src/` while it runs**: the dev server reloads the page and the capture fails with `app is not defined`.
- `traced.json` holds every feature in screenshot pixels; each revision points at a view file in `views/` (`mad` zoom 16 area, `madc` project core and `madnw` west side at zoom 17, `madbus` bus park at zoom 19). Shapes: `px`, `rect` (`[cx, cy, length, width, angleDeg]`) or `line` + `width`.
- `convert.mjs traced.json out.json` turns pixels into closed, clockwise WGS84 rings. Paste into `REAL_FEATURES`, then run `tests/verify_real_data.py`.
- To find imagery months for a new area: hash every zoom-16 tile of the area for each release in `waybackconfig.json` and keep releases where tiles change (zoom 15 refreshes on a different schedule, so it is not a reliable test). Then probe levels 17–20 per release for 200 vs 301/404 to set `maxLevel`.

## Things to watch

- Wayback dates are **release** dates, not capture dates.
- Release list: `https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json`.
- This machine has no Python on PATH. Run tests with `uv run --no-project --with pillow python tests/<file>.py` (uv is in `~/.local/bin`).
- `npm ci` rejected the lockfile; `npm install` worked.
- `DEMO_ROADS` and `DEMO_PARKS` are unused by the app, but `tests/verify_demo_data.py` matches on `DEMO_PARKS`.
- `load-test.json` is copied into `dist` on every build. Regenerate with `node tools/generate-load-test.mjs`.
- The `app` and `ng` globals exist only in dev builds.
- The user watches a dev server on port 4200 (`.claude/launch.json` in the desktop app's browser pane). It hot-reloads edits. Leave it alone.
- Run long jobs in the background and wait for the result.

## Key files

| File | Purpose |
|---|---|
| `src/app/app.component.ts` | Views, sync, layers, symbols, comparison logic, UI state, `SCENES` |
| `src/app/app.component.html` | UI |
| `src/app/real-data.ts` | Madinah Wayback releases, `REAL_IMAGERY`, `REAL_EPOCHS`, `REAL_CENTER`, `REAL_FEATURES` |
| `src/app/demo-data.ts` | Synthetic 105 buildings for `Images`, shared types |
| `public/data/load-test.json` | 20,000 synthetic buildings |
| `tools/trace/` | Capture, traced pixel shapes and converter for `REAL_FEATURES` |
| `tools/browser-check/` | Headless Chrome driver and smoke test, no dependencies |
| `tests/` | Offline data checks |

## Commands

```bash
npm start                             # http://localhost:4200
npm run build
uv run --no-project --with pillow python tests/verify_demo_data.py
uv run --no-project python tests/verify_load_test.py
uv run --no-project python tests/verify_real_data.py
node tools/browser-check/smoke.mjs http://localhost:4200/
node tools/trace/convert.mjs tools/trace/traced.json out.json
```
