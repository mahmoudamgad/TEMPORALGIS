# Handoff: Temporal GIS POC

Last updated: 2026-11-01, after tracing 44 real change polygons on `Satellite`. The build and all three data tests pass.

**Start here:** the POC is demo-ready on `Satellite`. Open items are under "Next steps". The biggest risk left is 3D performance on the 20K load test.

The user often writes in Egyptian Arabic but has asked for answers in English. They stressed that this is **just a POC**: keep changes simple.

## Goal

A small frontend-only Angular + Esri ArcGIS POC, to win approval before any backend work starts.

- Two synchronized maps show the same view at two different dates. Moving one moves the other.
- Supports 2D and 3D, and both images and satellite.
- Highlights what changed in the current view with transparent polygons, using graphics layers.
- Compares many epochs, picked by **month and year**. A 3-month comparison should show changes.
- Changes spread over several areas within a few km, so panning shows new ones.
- Change kinds include building progress, new buildings, new roads and vehicles.
- Handles very high geometry.

## Decisions already made by the user

Do not reopen these.

| Topic | Decision |
|---|---|
| Data | Static, drawn or prepared by the agent, at an acceptable accuracy |
| Change detection | None. Changes are static metadata. No backend |
| "High geometry" | Both many buildings and many vertices per polygon. Target: about 20,000 buildings with 30–100 vertices each |
| Imagery | Real imagery is preferred, using Esri Wayback |
| Many epochs | Two maps, with any two dates picked from a timeline. Not 3–4 maps at once |
| Epoch granularity | The user picks **month and year**. Epochs are `YYYYMM` integers everywhere |
| Area | A few km, not more. The demo area east of Cairo, centered near `31.679, 29.9805`, dates 2018–2026 |

## Current state

Git repository on `main`, tracking `origin` = https://github.com/mahmoudamgad/TEMPORALGIS. The first commit `df9848d` (the whole POC with the 44 polygons) is pushed. The user asked to push straight to `main`. `node_modules`, `dist` and `.angular` are ignored by `.gitignore`.

### Done

- **`Satellite` is the default source**, comparing Jun 2022 with Sep 2026 at zoom 15.5.
- **44 real change polygons** in `REAL_FEATURES` (`src/app/real-data.ts`), traced over Wayback imagery across about 2.9 × 2.9 km:
  - 13 `Construction` (building progress: several revisions with growing height, e.g. the central plot goes graded → foundations → structure → finished from Nov 2022 to Sep 2025).
  - 10 `Building`, 11 `Road`, 5 `Earthwork`, 5 `Vehicles` (parked trucks and cars traced at zoom 19).
  - Two demolitions (a pond and stockpiles at an old plant, gone by Jul 2020) and one vehicle that left.
  - Areas: residential compound (NW), logistics park, a new road district (NE), data centre and interchange (SE), factory plots and an industrial compound (SW).
  - Every change is dated to the **first imagery month that shows it**. Every imagery update has at least one change.
  - Accuracy: corners read from gridded screenshots, roughly ±5–20 m. Overlay checked at zoom 16 and at zoom 19 for the industrial compound: all polygons sit on their objects. The user should still review them.
- **Imagery months vs pickable months** (`SceneConfig.epochs` and `SceneConfig.stops`):
  - All zoom-16 tiles of the ~3 km area change together at exactly 10 Wayback releases: Jan 2018, Oct 2019, Jul 2020, Feb 2021, Jun 2022, Nov 2022, Aug 2023, Aug 2024, Sep 2025, Sep 2026. Those are the timeline stops (`REAL_IMAGERY`).
  - Every month Jan 2018 – Sep 2026 can be picked (`REAL_EPOCHS`). A month shows the latest imagery up to it (`stopOf`), and the map footer names that imagery date.
  - So a 3-month window shows changes only if an imagery update falls in it. Examples: Jun → Sep 2026 gives 8, Aug → Nov 2022 gives 10, Apr → Jul 2022 gives 4, Jan → Apr 2023 gives 0. The shortest gap between updates here is 5 months; free Wayback imagery cannot do better at this spot.
  - Zoom-15 tiles refresh on a different schedule from zoom 16, so they are not a reliable change test.
- Sidebar shows "N of M changes in view"; when all are off-screen, the empty list says so and suggests zooming out.
- Categories `Building | Construction | Road | Vehicles | Earthwork` were added to `Category` in `demo-data.ts`.
- Month + year epochs everywhere: Month and Year selects per map (months with no epoch disabled), month-labelled timeline. `Images` epochs `201603, 201911, 202206, 202402, 202608`; `Load test` epochs `201801, 202003, 202206, 202409, 202607`.
- Three-way **Source** control: `Satellite`, `Images` (synthetic PNGs, 105 buildings), `Load test 20K` (20,000 buildings, 1,397,560 vertices, `public/data/load-test.json`, ~33 MB).
- Buildings render through one client-side `FeatureLayer` (one row per building version; switching epoch changes `definitionExpression`). Change highlights are in a `GraphicsLayer` with cached symbols.
- Earlier fixes: wheel-zoom sync, filters apply to the map, ghosts for footprints missing in a map's epoch, change list capped at 200 rows, FPS badge in the load test.

### Verified

On 2026-11-01, in the desktop app's browser pane (dev server on 4200), on the final code:

- `ng build` exits 0. `verify_demo_data.py`, `verify_load_test.py` and `verify_real_data.py` pass.
- `Satellite` loads by default in 2D and 3D. Jun 2022 → Sep 2026: 29 changes, 18 in the default view. The 3D overlay draws all 29.
- The change counts above for 3-month windows, from the running app.
- 2D zoomed to level 19 on the industrial compound: no console errors.
- **Wayback CORS errors fixed.** Probing showed level 17 works for every release, levels 18–19 of the Jan 2018 and Oct 2019 releases answer with a 301 to a URL without CORS headers, and level 20 is a 404 everywhere. Each release now has `maxLevel` (17 or 19) in `WAYBACK_RELEASES`, used as the `WebTileLayer` `tileInfo`, so deeper views upsample. `MapView` gets explicit `constraints.lods`, otherwise the first backdrop (Jan 2018, level 17) would cap 2D zoom. In a fresh tab, Jan 2018 vs Oct 2019 in a low 3D close-up and then 2D at levels 19 and 20 gave zero console errors, and both maps showed imagery.

### Not verified / known issues

- Switching 2D/3D while a view is still loading can log `FeatureSourceEventLog` tile errors from the destroyed view. Not seen when switching after load.
- **`Load test` in 3D never reached idle within 120 s** on SwiftShader. No real-GPU numbers exist yet.
- `tools/browser-check/smoke.mjs` was updated for month epochs but not re-run. It still assumes `Images` is the default scene.
- Play and the timeline Baseline toggle have not been exercised. 3D ghost symbols have not been looked at.
- Esri Wayback terms of use have not been checked.

## Next steps

1. **Test the load test on a real GPU** in 2D and 3D, using the FPS badge. If 3D is too slow, the first levers are fewer highlights and a lower `qualityProfile`.
2. **Update `smoke.mjs`** for `Satellite` as the default scene, and re-run it.
3. **Check** Play and the Baseline toggle.
4. **Check Wayback terms of use** and tell the user the result.
5. If the user reviews the polygons and wants changes, edit `tools/trace/traced.json` and regenerate (below).

### How polygons were traced (`tools/trace/`)

- `capture.mjs <config.json>` opens the app in headless Chrome, switches to `Satellite`, sets the right map to each epoch in `config.epochs`, overlays a 50 px grid and saves a screenshot plus `<prefix>-view.json` (the view extent). Config: `{ center: [lon, lat], zoom, epochs, prefix, size, grid, changes }`. It needs the dev server on 4200 (or `url`). **Do not edit `src/` while it runs**: the dev server reloads the page and the capture fails with `app is not defined`.
- `traced.json` holds every feature in screenshot pixels, each revision pointing at its capture's view file in `views/`. Shapes: `px` (corners), `rect` (`[cx, cy, length, width, angleDeg]`) or `line` + `width` (roads).
- `convert.mjs traced.json out.json` turns pixels into closed, clockwise WGS84 rings. Paste the result into `REAL_FEATURES`, then run `tests/verify_real_data.py`.
- Captures used: the whole area at zoom 16 (1400 px) for all 10 imagery months to date changes, zoom-17 close-ups for tracing, and zoom 19 for vehicles.

## Things to watch

- Wayback dates are **release** dates, not capture dates.
- The full release list is at `https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json`. A tile-hash difference can be a small reprocessing rather than new capture.
- This machine has no Python on PATH. Run the tests with `uv run --no-project --with pillow python tests/<file>.py` (uv is in `~/.local/bin`).
- `npm ci` rejected the lockfile; `npm install` worked and updated `package-lock.json` slightly.
- `DEMO_ROADS` and `DEMO_PARKS` are no longer used by the app, but `tests/verify_demo_data.py` matches on the `DEMO_PARKS` export. Do not remove it without updating the test.
- `load-test.json` is copied into `dist` on every build. Regenerate it with `node tools/generate-load-test.mjs`; output is deterministic.
- The `app` and `ng` globals exist only in dev builds.
- The user watches a dev server on port 4200 (their own, or one started from `.claude/launch.json` in the desktop app's browser pane). It hot-reloads edits. Leave it alone.
- Run long jobs in the background and wait for the result.

## Key files

| File | Purpose |
|---|---|
| `src/app/app.component.ts` | Views, sync, layers, symbols, comparison logic, UI state, `SCENES` |
| `src/app/app.component.html` | UI |
| `src/app/real-data.ts` | Wayback releases, `REAL_IMAGERY`, `REAL_EPOCHS`, `REAL_FEATURES` |
| `src/app/demo-data.ts` | Synthetic 105 buildings for `Images`, shared types |
| `public/data/load-test.json` | 20,000 synthetic buildings |
| `tools/trace/` | Capture, traced pixel shapes and converter for `REAL_FEATURES` |
| `tools/generate-load-test.mjs` | Regenerates the load-test data |
| `tools/browser-check/` | Headless Chrome driver and smoke test, no dependencies |
| `tests/` | Offline data checks |

## Commands

```bash
npm start                             # http://localhost:4200
npm run build
uv run --no-project --with pillow python tests/verify_demo_data.py
uv run --no-project python tests/verify_load_test.py
uv run --no-project python tests/verify_real_data.py
node tools/trace/convert.mjs tools/trace/traced.json out.json
```
