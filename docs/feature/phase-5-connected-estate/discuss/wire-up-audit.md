# Wire-Up Audit — Phase 5 "Connected Estate" (all 17 tabs)

> The depth backlog and the source of the per-tab slices. Produced in DISCUSS by reading
> the actual tab code (`src/app/(app)/<tab>/` + `src/components/sections/<tab>/*`) across a
> 4-cluster parallel audit, then reconciled against a definitive grep for `@/lib/data/*`
> imports in production code. Per Andres's mandate: **no dead UI — wire everything, deepen
> everything.**

## Classification legend

| State | Meaning |
|---|---|
| **WIRED** | reads/writes real DB via a `src/lib/db/*` getter or `src/lib/db/commands/*` / `src/lib/actions/*` / Server Action (RPC), OR navigates via `<Link href>` to a real route. |
| **MOCK-DATA** | renders data imported from `src/lib/data/*` (seed/mock) instead of a live getter. |
| **COSMETIC** | purely visual control (status chip, hover, sparkline, KPI tile) that persists/navigates nothing. Acceptable when it is genuinely display-only — but under the mandate, an entity-bearing COSMETIC element (a row/card that names a Lot/Plot/Worker/Crew/Batch) **should become a dossier link**. |
| **STUB** | control exists but handler is a no-op / disabled with the real action elsewhere. |
| **DEAD** | a clickable element (pointer affordance) with no href/handler, or that 404s. |

## Audit method note — calibration

The Dashboard, Dispatch, and several other pages mount **prop-less Server Components** (e.g. `<DispatchBoard />`, `<SeasonHero />`) that fetch live getters **internally**. The page-level comment on `src/app/(app)/page.tsx` ("every section reads from canonical mock data") is **stale and false** — verified: those sections read `season_summary_view`, `daily_cherries_view`, etc. via `src/lib/db/*`. KPI summary tiles flagged "MOCK-DATA" by the sub-audits were re-classified **COSMETIC (live-sourced)** here, because they render live-getter output but are display-only. The single authoritative mock-leak test — `grep "from '@/lib/data/'"` over non-test `src/` — returns exactly **two UI files** (Workers), recorded below.

---

## Per-tab summary (depth scorecard)

| # | Tab | Depth | Elements | WIRED | COSMETIC | STUB | MOCK | DEAD | Top Phase-5 gap |
|---|-----|-------|----------|-------|----------|------|------|------|-----------------|
| 1 | Dashboard | partial | 20 | 13 | 7 | 0 | 0 | 0 | KPI/plot/activity rows are dead-end COSMETIC — should drill into dossiers; stale "mock data" comment |
| 2 | Plots | partial | 17 | 14 | 3 | 0 | 0 | 0 | plot cards/rows are COSMETIC — no `/plots/[id]` dossier to open |
| 3 | Map | partial | 13 | 11 | 1 | 0 | 0 | **1** | **DEAD plot polygon click** (pointer cursor, no handler, no `/plots/[id]`) |
| 4 | Weigh | deep | 9 | 9 | 0 | 0 | 0 | 0 | walking-skeleton origin; tally is local-optimistic — surface cross-tab ripple proof |
| 5 | Harvests | deep | 28 | 27 | 1 | 0 | 0 | 0 | top-picker rows COSMETIC — should open `/workers/[id]` |
| 6 | Plan | deep | 12 | 12 | 0 | 0 | 0 | 0 | readiness/timeline rows don't open a plot/pasada dossier |
| 7 | Dispatch | deep | 11 | 9 | 2 | 0 | 0 | 0 | dispatch cards don't open a `/dispatch/[id]` dossier |
| 8 | Processing | deep | 18 | 16 | 2 | 0 | 0 | 0 | links to `/lots/[code]` (good); batch rows could deepen |
| 9 | Ferment | deep | 16 | 12 | 4 | 0 | 0 | 0 | cards link `/ferment/[batch]` (good); curves COSMETIC |
| 10 | Drying | deep | 22 | 12 | 9 | **1** | 0 | 0 | station cards have no drying-station dossier; "Mill" STUB defers to /processing |
| 11 | Inventory | deep | 23 | 15 | 7 | **1** | 0 | 0 | green-lot rows link `/lots/[code]` (good); "Sold out" STUB is DB-guard courtesy |
| 12 | QC | deep | 43 | 20 | 23 | 0 | 0 | 0 | rich; cup-to-cause plot/worker references are COSMETIC (no dossier) |
| 13 | Satellite | thin | 7 | 1 | 6 | 0 | 0 | 0 | **read-only surveillance** — vegetation/PHI grid cards open nothing; no plot drill-in |
| 14 | Scouting | deep | 16 | 13 | 3 | 0 | 0 | 0 | threshold "control task" never links to `/tasks`; spray rows open no dossier |
| 15 | Costing | deep | 17 | 14 | 3 | 0 | 0 | 0 | provenance links `/lots/[code]#cost-entries` (good); KPI tiles COSMETIC |
| 16 | EUDR | deep | 15 | 4 | 11 | 0 | 0 | 0 | lot cards link `/lots/[code]#eudr` (good); origin-plot rows open no `/plots/[id]` |
| 17 | Workers | partial | 20 | 14 | 6 | 0 | **6** | 0 | **`CREWS` mock-constant** (worker-form, crew-board); crew cards/rows open no dossier |

**Totals across 17 tabs: ~307 interactive elements — WIRED ~ 246 · COSMETIC ~ 88 · STUB 3 · MOCK-DATA 6 (1 source: `CREWS`) · DEAD 1.**

### Headline findings

1. **The app is already deeply wired for WRITES.** Every form across Weigh/Plan/Dispatch/Processing/Ferment/Drying/Inventory/QC/Scouting/Costing/EUDR/Workers submits to a real RPC or Server Action. The "dead UI" risk is **not** broken write paths.
2. **The mandate gap is CONNECTIVITY, not data.** Three patterns dominate:
   - **Orphan dossiers (J2):** `/lots/[code]`, `/ferment/[batch]`, `/qc/cup/[lot]` exist and are **deep**, but the sidebar (`sidebar.tsx` NAV) links to **none** of them — reachable only from a handful of inline links or a typed URL. The lot page's own header confirms: "nav/command-palette wiring TO this URL is a later slice."
   - **Entity rows that go nowhere (J4):** plot cards (Plots, Map, Satellite, EUDR origin), worker/picker rows (Harvests top-pickers, Workers roster, QC cup-to-cause), crew cards (Workers, Dispatch), pasada rows (Plan) are COSMETIC — they NAME a connected entity but clicking does nothing. Under the mandate these must become dossier links.
   - **Missing dossiers (J2/J4):** no `/plots/[id]`, `/workers/[id]`, `/crew/[id]`, `/dispatch/[id]`, `/pay-period/[id]`, drying-station, spray-record dossier exists yet.
3. **One true DEAD click:** Map plot polygons render `cursor:pointer` on hover but have **no click handler** — a UX trap. (`src/components/islands/FarmMap.client.tsx`).
4. **One true MOCK-DATA leak:** `CREWS` constant from `src/lib/data/workers.ts`, imported by `src/components/sections/workers/worker-form.tsx` and `crew-board.tsx`. Crews exist as a real table (`crews`, `crew_memberships`) — the UI should read them live.
5. **Three intentional STUBs** (acceptable, document as such): Drying "Mill — locked" button (DB reposo gate fail-closed; real advance lives at `/processing`), Inventory "Sold out" Reserve (DB oversell guard), and the disabled-applicator option in Scouting (cert gate). These are courtesy-disabled, not dead — keep.

---

## Detailed per-tab element inventories

> Format per row: `Element | State | Should tie to | Click should do | Connects to`. Only the
> rows that drive Phase-5 work are reproduced here; the four cluster audits hold the full
> element-by-element tables (this file is the reconciled, decisioned view).

### 1. Dashboard — `src/app/(app)/page.tsx` + `sections/dashboard/*`
| Element | State | Should tie to | Click should do | Connects to |
|---|---|---|---|---|
| SeasonHero, KpiRow, YieldTrend, VarietyMix, Weather, PlotHealth, ProcessingPipeline | WIRED | live: `getSeason`, `getDailyCherries`, `getVarietyShares`, `getWorkers`, `getBatches`, `getActivity` | render headline numbers | `season_summary_view`, `daily_cherries_view`, `variety_shares_view`, `activity` view |
| PlotHealth plot rows | COSMETIC → **make WIRED** | a plot | open the plot dossier | **needs `/plots/[id]`** |
| ProcessingPipeline "closest to green" rows | COSMETIC → **make WIRED** | a lot | open the lot dossier | `/lots/[code]` (exists) |
| ActivityFeed event rows | COSMETIC → **make WIRED** | the event's entity | jump to the entity it references | lot/worker/plot dossier |
| "View all" → /plots | WIRED | — | navigate | `/plots` |
| (stale comment line 18: "reads from canonical mock data") | — | — | **delete/fix** — false | — |

### 2. Plots — `plots/page.tsx` + `sections/plots/*`
| Element | State | Should tie to | Click should do | Connects to |
|---|---|---|---|---|
| New plot / Edit / Delete (PlotForm, PlotRowActions) | WIRED | `createPlot`/`updatePlot`/`deletePlot` actions | CRUD a plot | `src/lib/actions/plots.ts` |
| variety filter chips, grid/list segmented | COSMETIC (filter state — OK) | — | filter view | client state |
| plot card (grid) / plot row (list) / table row | COSMETIC → **make WIRED** | a plot | open the plot dossier | **needs `/plots/[id]`** |

### 3. Map — `map/page.tsx` + `islands/FarmMap.client.tsx`
| Element | State | Should tie to | Click should do | Connects to |
|---|---|---|---|---|
| plot/reserve GeoJSON layers | WIRED | `getPlotsGeoJSON`, `getReserveGeoJSON` | render farm geometry | `src/lib/db/geo.ts` |
| **plot polygon click** | **DEAD** | a plot | **open the plot dossier** | **needs `/plots/[id]` + a click handler** |
| nav control, hover feature-state | WIRED / COSMETIC | — | pan/zoom / highlight | MapLibre |

### 4. Weigh — `weigh/page.tsx` + `sections/weigh/*` (WALKING-SKELETON ORIGIN)
| Element | State | Should tie to | Click should do | Connects to |
|---|---|---|---|---|
| badge picker, plot select, GPS, numeric pad, ripeness, BLE | WIRED | `getCrewRoster`, `getWeighPlots`, `getWeighTodayByPicker` | build a weigh-in | `v_weigh_today_by_picker`, `getWeighPlots` |
| **Capture** | WIRED | `recordWeighIn` → `record_weigh_in` RPC (offline outbox) | write the genesis event | ripples to PAY/ATTENDANCE/TRACEABILITY/MILL |
| Tally (kg/latas) | WIRED (local-optimistic) → **deepen** | `v_weigh_today_by_picker` + reactive refresh | show the ripple landing | **surface cross-tab "this also updated Dashboard + Costing"** |

### 5. Harvests — top-picker rows COSMETIC → open `/workers/[id]`; intake success links `/lots/[code]` (WIRED, good).
### 6. Plan — readiness/timeline rows COSMETIC → open plot/pasada dossier.
### 7. Dispatch — cards COSMETIC → open `/dispatch/[id]`; generate/share WIRED.
### 8. Processing — resting-lot chips link `/lots/[code]` (WIRED, good); advance/CRUD WIRED.
### 9. Ferment — cards link `/ferment/[batch]` (WIRED, good); curves COSMETIC.
### 10. Drying — `Mill` STUB (DB gate, keep); station cards COSMETIC → **needs drying-station dossier**.
### 11. Inventory — green rows link `/lots/[code]` (WIRED); "Sold out" STUB (DB guard, keep).
### 12. QC — richest tab; cup-to-cause plot/worker refs COSMETIC → open `/plots/[id]` / `/workers/[id]`; cup link `/qc/cup/[lot]` WIRED.
### 13. Satellite — **thinnest tab**: vegetation grid + PHI chips all COSMETIC → vegetation card should drill into the plot dossier (Satellite section); PHI chip should link to the spray that set it.
### 14. Scouting — spray form fully WIRED (`log_spray`, cert+PHI gate); threshold "control task" → **should link to `/tasks`**; spray-history rows → open a spray-record view.
### 15. Costing — provenance links `/lots/[code]#cost-entries` (WIRED, good); book-cost WIRED; KPI tiles COSMETIC.
### 16. EUDR — lot cards link `/lots/[code]#eudr` (WIRED, good); declare-plot form WIRED; **origin-plot rows COSMETIC → open `/plots/[id]`**.
### 17. Workers — CRUD WIRED; **`CREWS` mock-constant (MOCK-DATA)** in worker-form + crew-board → read `crews` live; crew cards + roster rows COSMETIC → open `/crew/[id]` / `/workers/[id]`.

---

## The depth backlog (what each slice must close)

Grouped by the connective work the mandate requires. Each maps to slices in `slices/`.

- **D1 — Entity dossier set (J2 core):** build `/plots/[id]`, `/workers/[id]`, `/crew/[id]` dossiers (each = the entity's whole story across tabs), and **wire the existing orphans** (`/lots/[code]`, `/ferment/[batch]`, `/qc/cup/[lot]`) into nav + a ⌘K entity jump.
- **D2 — Make every entity-bearing COSMETIC row a dossier link (J4):** plot cards/rows (Dashboard, Plots, Map-click, Satellite, EUDR origin, QC, Plan), worker/picker rows (Harvests, Workers, QC), crew cards (Workers, Dispatch), lot rows (Dashboard pipeline, activity feed), pasada rows (Plan), dispatch cards (Dispatch).
- **D3 — Kill the DEAD click + the MOCK leak:** Map polygon → `/plots/[id]`; `CREWS` constant → live `crews` read.
- **D4 — Cross-tab reactive proof (J1):** Weigh tally + Dashboard headline + Costing reflect a single weigh-in; Satellite/Scouting PHI surfaced on Plan/Map; QC-hold surfaced on Inventory/Dispatch.
- **D5 — Deepen the thin/partial tabs:** Satellite (read-only → plot drill-in + spray linkage), Dashboard/Plots/Workers (partial → full dossier connectivity).
