# Janson Coffee — Phase-1 Spine · DESIGN (Architecture)

> DESIGN wave (full-stack, propose mode). ~55-agent fan-out: 44 design agents across System/Domain/Application/UI/Cross-cutting + 5 track leads + C4 + ADRs + reuse + chief architect + UI critic + architecture critic + build sequencer. World-class UI was a first-class track. Designed against the real `feat/supabase-backend` stack (Next.js 15 + React 19 + Supabase Postgres). Date: 2026-06-20.

- Design agents: 44/44  ·  Track leads: 5/5

## §0 — Build Sequence (the DELIVER-ready plan)

I have enough grounding. One critical correction to the design's stated baseline: the live migration head is `20260620150000_grant_hygiene.sql`, not `20260620140000`. New migrations must sort strictly above **`20260620150000`**. I'll account for this in the sequence.

Here is the build sequence.

---

# PHASE-1 SPINE — BUILD SEQUENCER OUTPUT

## 0. Baseline correction (read first — affects every migration timestamp)

The design briefs lock new migrations at `20260620150000`+ (Cross-Cutting) and `20260620150000`–`190000` (Domain Model). **Both collide with a migration already on disk:** the live head is **`20260620150000_grant_hygiene.sql`** (revokes writes from anon+authenticated, locks default privileges so new tables can't re-open anon access). New migrations must sort strictly above **`20260620150000`**. I renumber the whole lane to **`20260621NNNNNN`** (matching the System & Infrastructure brief's `20260621090000`+ scheme, which is the only fragment that didn't collide).

Two load-bearing consequences of `grant_hygiene.sql` that every slice must honor:
- **`alter default privileges … revoke insert/update/delete from authenticated`** means new tables are write-locked by default — exactly what we want. Writes go only through `SECURITY DEFINER` RPCs granted `EXECUTE`. **Every new migration must explicitly `grant select … to authenticated` on its new tables/views** (the default-privilege lock removes the automatic grant), or reads 404.
- The RLS-loop idiom (`do $$ … foreach t in array[…]`) is the established pattern — reuse it verbatim for stamping `farm_id` policies.

**Pre-slice 0 (gate, ~30 min, not a feature slice):** stand up the test substrate the entire phase depends on and that does not exist yet. `package.json` has **no PGlite, no MapLibre, no d3, vitest env is jsdom-capable but the projects split isn't wired**. This is the hard prerequisite flagged by three briefs. Deliver: `@electric-sql/pglite` (+ postgis contrib) as devDep, the vitest `db` (node) / `ui` (jsdom) project split, a `loadDataDir`-per-file fixture harness that applies the real migration SQL, and the `npm run build && npm run test && tsc --noEmit` local gate wired as the CI replacement. **No feature slice can be TDD'd at the SQL layer until this lands.** Dogfood moment: the existing `20260620120000_init.sql` replays green under PGlite.

---

## 1. The spine-first ordering rule

Across all five briefs the dependency graph is unambiguous: **the event log + RLS/tenancy + lot graph are the trunk; everything else is a branch read or a projection.** Nothing that captures a write or derives a number can be built before the substrate it writes/reads exists. The briefs disagree only on naming (`lot_event` vs `events`, `lot_nodes` vs promote-`lots`); I reconcile to the **Domain Model brief's resolution** (promote `lots(code)` in place, one `lot_edges` table, `lot_event` ledger — it preserves every existing FK and mapper) crossed with the **App Architecture write contract** (mutation + event append in one `SECURITY DEFINER` RPC).

Must-land-first, in strict order: **S0 (test substrate) → S1 (geometry — no deps, EUDR/COGS join key) → S2 (tenancy/RLS factory) → S3 (event log + lot graph + units + first command RPC).** Only after S3 can S4–S10 fan out.

---

## 2. The slices (dependency-ordered, each end-to-end + demo-able + test-first + world-class UI)

Each slice = one migration (or none), its `src/lib/db/*` port(s), its Server Component screen/island, its glass UI, its failing-first tests. "Dogfood moment" = the first time Andres/the family can *use* the slice on real farm data and trust it.

---

### S1 — PostGIS geometry + the map shell *(foundation; no upstream deps)*

**Migration** `20260621090000_postgis_plot_reserve_geometry.sql`: `create extension postgis with schema extensions` (never `postgis_raster` — broken on Supabase managed, per D9); add `plots.geom geometry(MultiPolygon,4326)` + `centroid` + DEM scalars (`elevation_*`, `slope_deg_mean`, `aspect_deg_mean`) + generated `geom_area_ha`; `reserve_zones` table for the 200-ha quetzal reserve; GiST indexes; `plots_geo`/`reserve_geo` views emitting `ST_AsGeoJSON`. **Explicit `grant select … to authenticated`** on the new views. `area_ha`/`altitude_masl` scalars retained, derived-backfilled (ACL-1) — nothing reading them breaks.

**Off-DB prerequisites (Andres-gated, flagged):** `scripts/derive-terrain.mjs` (clips Copernicus GLO-30, circular-mean aspect) must run, and a seed-polygon basemap-tracing pass must produce the 10 plot polygons + reserve, *before the map renders*. **This is a hard human gate inside S1.**

**Ports:** new `src/lib/db/geo.ts` (`getPlotsGeoJSON()`, `getReserveGeoJSON()` → server-computed FeatureCollections, `cache()`'d).

**UI:** `/map` route in a new `(spatial)` full-bleed group; `FarmMap.client` island (`maplibre-gl@^5.6.0`, vanilla — **no react-map-gl** per the App-Arch/UI-track resolution; the Cross-Cutting brief's `react-map-gl@8` is overruled by the two UI-owning tracks that both chose vanilla), `next/dynamic({ssr:false})`, `SkeletonMap` sized to final box (CLS≈0). **D7 glass-over-canvas is mandatory in this slice**: static `.glass-scrim` veil + `.is-panning` blur-kill on movestart/moveend. Plots tint by `status`; reserve as a first-class `glass-sheen` protected overlay. `feature-state` hover (GPU, no React re-render). OpenFreeMap tiles (no key), never proxied through Supabase.

**Tests (PGlite, jsdom):** geometry round-trips valid GeoJSON; `geom_area_ha` reconciles ±5% to `area_ha` as a data-quality signal (not error); MapLibre **mocked** — assert the right GeoJSON/layers/handlers wire, never WebGL pixels; `SkeletonMap` renders under reduced-motion without animation classes.

**Dogfood moment:** the family opens `/map` and sees their actual farm — every plot polygon and the reserve, frosted-glass chrome, buttery pan. The app stops being an abstract dashboard and becomes *their land*. This is the single highest-WOW slice and it has zero data-spine dependencies, so it ships first and earns trust early.

---

### S2 — Tenancy + RLS factory *(depends: S1, because it stamps the geo tables too)*

**Migration** `20260621091000_tenancy_security.sql`: `farms` table (1 seeded row `janson`); `app` schema with `app.current_farm_id()` (coalesces to the sole farm when no JWT claim — today's plain authenticated session works with zero JWT plumbing), `app.can_write()`, `app.apply_farm_rls(tbl)` factory; `farm_id uuid NOT NULL` + index on every business table (**never part of a composite PK** — the TradelyHQ delete-trap lesson); re-stamp policies onto the authenticated-only baseline via the factory. `force row level security` everywhere (required for event-log immutability in S3). **Flag for explicit apply-OK** (RLS rewrite + `force RLS` = security-posture change).

**No new UI.** Pure substrate. **Demo-able via tests, not a screen** — this is the one slice whose "demo" is the RLS fixture matrix proving the gate.

**Tests (PGlite, fail-on-pre-existing-migration):** anon cannot read/write; non-owner cannot write; second-farm row invisible; owner read works with no claim (coalesce path). These tests **fail on the current schema**, proving they catch the gap.

**Dogfood moment:** none user-facing — but this is the slice that makes every later write *safe by construction*. Land it before any capture surface (S4 onward) or you retrofit 18 RLS predicates later.

---

### S3 — Event log + lot graph + units + first command RPC + activity-as-projection *(THE TRUNK; depends: S2)*

**Migration** `20260621092000_event_log_units_lot_graph.sql`: `units` table + `convert_qty()` (UCUM, NULL-on-incommensurable); `lot_event` ledger (`event_uid`, `idempotency_key`, `occurred_at` vs `recorded_at`, `device_id`/`device_seq` NOT NULL from event #1 — D5, unrecoverable if added later; `prev_hash`/`hash` chain computed in a `BEFORE INSERT` trigger via `pgcrypto.digest()`, never client-trusted; immutability via no-UPDATE/DELETE policy + block trigger); promote `lots` in place (`stage`, `variety`, `origin_kg`, `current_kg`, `is_single_origin`, `minted_at`); `lot_edges(parent,child,kind∈{split,merge,blend,process},kg,event_seq)` with mass-conservation CHECK; `lot_yield_curve`; `lot_code_seq`; the command RPCs (`record_cherry_intake` = canonical monotonic lot minter, `advance_processing_stage`, `record_lot_event`) — **each mutates the domain row AND appends the event in one transaction**, `SECURITY DEFINER`, `EXECUTE` granted to `authenticated` only. **Convert the existing `activity` table to a `security_invoker` view over `lot_event`** with the same `(id, at, kind, text)` columns — `getActivity()` and `activity.ts` mapper stay byte-identical.

**Ports:** `src/lib/db/events.ts` (read direct, write via `appendEvent()`/`recordCherryIntake()` RPC), `src/lib/db/lots.ts` (`getLotGenealogy → {nodes, edges}`), `src/lib/db/commands/recordCherryIntake.ts`. New `src/lib/types/` barrel split (D9) so parallel agents don't serialize on one 140-line file.

**UI:** the **audit drawer** (`audit-drawer.tsx`) — glass slide-over, per-stream event chain with a green/amber **chain-verified** badge, reusing the activity feed's `KIND_ICON`/`KIND_CHIP` maps (extend, don't fork). This is the lowest-risk proof of the substrate: the activity feed *becomes* a projection and **cannot disagree** with the timeline.

**Tests:** SQL-fixture mass-conservation (fails on a schema that lets an edge exceed its parent); `convert_qty` incommensurable→NULL; hash-chain `verify_chain` tamper test (the one shared hashing util — single owner, do not fork); `record_cherry_intake` mints gap-free monotonic `JC-NNN` exactly-once under concurrency; pure-domain command test against a fake store (no DB) for red→green; activity-view parity (`getActivity()` returns the same shape).

**Dogfood moment:** first real **cherry intake** — a picker's lata is recorded, a `JC-NNN` lot auto-mints, and the event appears instantly in the activity feed *and* the audit drawer with a verified-chain badge. The first write the family makes that the system, not a human, numbered and audited.

---

### S4 — Derived-metrics semantic layer *(depends: S3 — events are the source)*

**Migration** `20260621093000_derived_metrics.sql`: **rename-aside (not hard-drop)** the four hand-authored aggregate tables; create `farm_season_config` (the one genuine *input* — `target_kg`); recreate `season_summary`/`daily_cherries`/`weekly_harvest`/`variety_shares` as `security_invoker` `v_metric_*` views whose **columns exactly match `trends.ts`'s `mapSeason`/`mapTrend`/`mapVarietyShare`** (verified against the file: `target_kg/harvested_kg/today_kg/ytd_revenue_usd`, `sort_order/label/value`, `variety/kg`). `v_metric_plot_status` fusion (stored `plots.status` demoted to one input signal). **`grant select … to authenticated`** on every view (default-privilege lock). **Flag for apply-OK** (rename-aside). `ytd_revenue_usd` stays honestly sourced/modeled until GreenLot sales exist (flag to S5).

**Ports: zero TypeScript change** — `trends.ts` getters keep their `.from("season_summary")` etc. names; the views adopt those names. The swap is entirely behind the seam.

**UI:** **provenance-on-hover** — because every figure is now a known `v_metric_*` view, stat cards show "derived from N harvests · as of HH:MM" via a `glass-sheen` tooltip + a "Live · derived" chip (D30). The trust guarantee becomes a *visible feature*.

**Tests (PGlite — runs the REAL view SQL, pinning the definition not a re-implementation):** `getSeason()` == hand-summed seed; the *same fixture seeded to disagree* **fails on the pre-fix tables** (the trust regression made executable); the `metric_*` lint guard (build-failing locally) — any getter `.from()`-ing an aggregate-shaped name outside `v_metric_*`/`fn_metric_*`, or a dropped aggregate table reappearing, fails.

**Dogfood moment:** the dashboard headline `todayKg` and its sparkline — which today read two independently hand-typed tables — now resolve to one `SUM` definition and **provably cannot disagree**. The #1 trust defect is structurally dead. The family sees the "derived" chip and learns the number can be trusted.

---

### S5 — GreenLot inventory + ATP *(depends: S3 graph, S4 for revenue handoff)*

**Migration** `20260621093500_green_inventory.sql`: GreenLot is the **same `lots` node at `stage='green'`** + grade/location/ATP columns (generated `sca_grade`, D-INV-3); `lot_reservations`/`lot_shipments` as **append-only claim rows**; `green_lots_atp` view (`atp = current_kg − Σreserved − Σshipped` — derived, never a stored counter); `materialize_green_lot()` RPC (the only GreenLot writer, links via a `process` edge); **`prevent_oversell` BEFORE INSERT/UPDATE trigger** (fail-closed — double-selling a scarce micro-lot is physically impossible at the data layer). Pins the `green_lots` PK contract the EUDR slice references un-FK'd.

**Ports:** `src/lib/db/greenlots.ts`, `src/lib/db/commands/gradeGreenLot.ts`, reservation Server Action.

**UI:** `/inventory` — dense glass `ResponsiveTable` (collapses to record-cards below `md`, never h-scroll, D24); **dual-bar ATP meter** (committed vs available, stacked `transform: scaleX()`); reservation drawer is the one client island; oversell surfaces as a clean glass toast — the UI *cannot* create a double-sell.

**Tests:** `prevent_oversell` rejects over-commit (written red first); ATP arithmetic == reserved/shipped sums; `materialize_green_lot` creates exactly one `process` edge with conserved mass; ATP-meter render/smoke.

**Dogfood moment:** the pipeline stops dead-ending at `green` — the family grades a finished lot, sees it as a located, available-to-promise sellable asset, and reserves kg against a buyer with the oversell guard live. The first slice that touches money-shaped inventory.

---

### S6 — Lot-genealogy graph visualization *(depends: S3 graph rows, S5 green nodes)*

**No migration** (reads S3/S5). **Ports:** `getLotGenealogy()` already exists from S3; add `src/lib/ui/graph-layout.ts` — pure, tested Sugiyama-lite layered-DAG layout returning node coords + edge paths.

**UI:** `<GenealogyGraph>` — **server-rendered SVG** (the layout is a pure server function; prints, works JS-off, cheap render test) — mass-flow alluvial: nodes are stage-colored mini glass-cards in time-ordered columns, edges are **mass-proportional Bézier ribbons** (stroke-width ∝ kg — mass-carried literally visible), yield-loss drawn honestly as a dashed wisp, terminal node gets the one `glass-sheen`. Thin `LotGraphInteractive.client` island (~1.5KB, transform/opacity pan/zoom + lineage-trace highlight). **No graph library** (react-flow/cytoscape rejected — 50KB+, physics jank, non-deterministic). Reduced-motion/no-JS falls back to a `role="tree"` outline from the *same* node/edge data (D18, operable not just summarized).

**Tests:** layout function is deterministic and conserves columns; edge stroke-width reflects kg; `role="tree"` fallback renders the full lineage with edge mass as text.

**Dogfood moment:** the family clicks a green lot (from `/inventory` or a map plot) and *sees* the farm-to-bag lineage — this cherry intake split into Washed/Natural, processed with visible yield-loss, merged into the bag they're selling. The "provenance IS the product" thesis made visible — the buyer/auditor artifact.

---

### S7 — Activity-based COGS *(depends: S3 graph terminal mass, workers/tasks/processing)*

**Migration** `20260621094000_costing.sql`: append-only `cost_entry` ledger (driver: worker-day | task | processing-batch → target: plot|lot|farm; four documented allocation rules; corrections are **reversing entries**, never UPDATE/DELETE — future QBO journal source + audit trail in one); `mv_lot_cost` **materialized view** (the one earned matview — recursive walk down the graph apportioning cost over green-kg, refreshed `CONCURRENTLY` on the same write path that busts the cache tag); `cogs_per_lot()`/`cogs_per_plot()` `security_invoker` functions via `.rpc()`. Green-kg denominator from the graph terminal node (degrades to `processing_batches.current_kg WHERE stage='green'` until graph fully populated).

**Ports:** `src/lib/db/cogs.ts`.

**UI:** `/costing` — `CostWaterfall` + cost-decomposition bars (labor|processing|agronomy|overhead) as pure CSS flex widths; per-lot waterfall under `stagger`; every figure links to its `cost_entry` provenance.

**Tests:** COGS == hand-computed seed across all four allocation rules; NULL-on-zero-yield (no divide-by-zero); reversing-entry nets correctly; matview refresh on write path; waterfall render/smoke.

**Dogfood moment:** the family sees **true cost-per-kg-green per lot** — the number the business actually turns on. The first time labor + processing data becomes a margin decision instead of a feeling.

---

### S8 — EUDR geolocation export + DDS *(depends: S1 geom, S3 hashing util, S5 green-lot PK)*

**Migration** `20260621094500_eudr_outbound.sql`: `plots.eudr_*` columns; `deforestation_checks` (hash-chained, same substrate as S3); `compliance_threshold` (2020 cutoff, validity window — the law's params in one home); `dds_submissions`; `outbound_deliveries` queue behind a ports-and-adapters seam. `issue_dds()` `SECURITY DEFINER` RPC **gates in the DB** on passing checks for every covered plot, freezes a snapshot, writes a `DDS_ISSUED` event — the UI's disabled button is courtesy, the gate is in the database (D-CMP-3).

**Off-DB:** `scripts/eudr-verify.ts` — overlays each `plots.geom` against the JRC Global Forest Cover 2020 GeoTIFF (Panama tile W090N10) via `@turf/turf` + `geotiff.js` (pure-JS, no GDAL), folds in GFW loss as a secondary corroboration column. Precomputed verdict, never a live raster on a render path (D14). `establishedYear ≤ cutoff` is a deterministic server-run test (D-CMP-2). **v1 is "generate + park + manual submit"** — submitting a legal declaration never auto-fires (the irreversible/identity-bearing action waits for explicit human action, D15).

**Ports:** `src/lib/db/eudr.ts` (`getEudrDossier`), `src/lib/integration/{port,queue,flush}.ts` + `adapters/traces-dds.ts`. EUDR file download via a **Route Handler** (`api/eudr/[lot]/geojson`, `Content-Disposition`) — the one thing a Server Action can't return.

**UI:** `/compliance` readiness board driven by the view's single `ui_state` enum (clear/unverified/expired/blocked/indeterminate — never color alone, icon+label); per-plot verdict pill; per-green-lot DDS panel with embedded polygon map + print-grade PDF (`@react-pdf/renderer`, client island).

**Tests:** deforestation-math; `issue_dds` raises + rolls back (no row, no event) when any plot unverified/expired/failed; DDS round-trip; queue idempotency/dead-letter; compliance-badge render/smoke; static guard banning settable `deforestation_free`/`is_compliant` booleans + direct `dds`/`compliance_check` inserts.

**Dogfood moment:** one click produces a TRACES-NT-shaped Due Diligence Statement (JSON + GeoJSON + PDF) for a green lot — EU market access made real. Janson's binding date is mid-2027 SME tier, so this ships *ahead* of the legal need, with runway.

---

### S9 — Navigation, command palette, mobile nav, public microsite *(depends: S1–S8 entity URLs)*

The UI-track infrastructure the briefs flag as **missing in the repo today**: there is **no mobile nav** (sidebar is `hidden md:flex` with no replacement below 768px — D22, flagged loudly), the topbar search is a **no-op** (promote to a ⌘K command palette, D26), and the focus ring **fails WCAG 2.4.11** (`button.tsx` `focus-visible:ring-forest-100` ~1.1:1 — replace with `.focus-ring`, D17, fix immediately).

**Build:** registry-driven IA (`src/lib/nav/registry.ts` — single source for sidebar/palette/mobile-nav/breadcrumbs); bottom tab bar + "More" sheet; headless command palette (native `<dialog>`, lazy-imported on first keypress, `pg_trgm`/`ILIKE` entity search); canonical entity URLs (`/plots/[id]`, `/lots/[code]`, …); the **`(public)` SSG microsite** `/lot/[code]` (`force-static` + `generateStaticParams`, on-demand `revalidateTag`) reading ONLY a curated `lot_provenance_view` granted to `anon` (buyer-safe: no phones/rates/costs; crew as a celebratory honor-roll) — a regression test asserts no PII/cost column is ever selected.

**Tests:** focus-ring contrast ≥3:1 on light glass + dark map (the load-bearing bug, fails on current `button.tsx`); 16px-min input font (iOS zoom bug); nav-registry guard; microsite PII/cost-column exclusion regression.

**Dogfood moment:** the farm manager uses the app on a phone in the field (real mobile nav), jumps to any lot/plot via ⌘K, and a buyer opens a shareable, instant, auth-free provenance page for a specific micro-lot.

---

## 3. Cross-slice rails (every slice, non-negotiable)

- **One schema author, serial lane.** S1→S8 migrations are a single serialized author (the one-migration-author rule). App-code ports, UI components, and integration adapters fan out **file-disjoint in parallel** within each slice, closed by a reviewer pass. The `src/lib/types/` barrel split (S3) is what unblocks parallel type authoring.
- **Single-owner contract files** (one author per wave): `globals.css`, `brand.ts`, `lib/charts/tokens.ts`, `nav/registry.ts`, the shared hashing util, the "every write is an event" backstop trigger.
- **Migration timestamps strictly `> 20260620150000`** (the live `grant_hygiene` head — *not* `140000` as the briefs state). Every new table needs an explicit `grant select … to authenticated` (default-privilege lock).
- **TDD test-first, every PR** (repo hard rule, no exemptions): lowest layer that catches the root cause; SQL/RLS/genealogy on PGlite, pure domain in node, render/smoke in jsdom. **S0 (test substrate) gates all SQL-layer TDD** and must land before S1's tests.
- **World-class glass UI is in-scope of each slice, not a follow-up** — the map (S1), audit drawer (S3), provenance chips (S4), ATP meter (S5), genealogy ribbon (S6), COGS waterfall (S7), compliance board (S8), mobile nav/palette (S9) each ship Apple-grade, 60fps, reduced-motion, AA-on-glass, with a render test, inside their slice.
- **Apply-OK human gates:** S1 (extension + terrain/polygon prerequisite run), S2 (RLS rewrite + force RLS), S4 (rename-aside aggregates), S8 (compliance posture). Plus Andres's standing calls: backup scheduler (launchd vs free cron) before `scripts/backup.sh`, and the `<7-day` keep-warm heartbeat (S1's terrain run or a free pinger doubles as it — the critical free-tier control).

## 4. Critical-path summary

```
S0 (test substrate) ─┐
                      ├─> S1 (geometry+map) ─> S2 (tenancy/RLS) ─> S3 (event log+lot graph+units) ─┬─> S4 (semantic layer)
                      │                                                                            ├─> S5 (GreenLot/ATP) ─> S6 (genealogy graph)
                      │                                                                            ├─> S7 (COGS)
                      │                                                          S1+S3+S5 ─────────┴─> S8 (EUDR/DDS)
                      └────────────────────────────────────────────────────────────────────────────> S9 (nav/palette/microsite, after entity URLs exist)
```

**Trunk that must land first, in order:** S0 → S1 → S2 → S3. After S3, S4/S5/S7 fan out in parallel; S6 follows S5; S8 follows S1+S3+S5; S9 last. The single highest-trust slice (S4, the #1 defect kill) and the single highest-WOW slice (S1, the map) are deliberately early — S1 because it has zero data-spine deps and earns the family's trust on day one, S4 because it structurally ends "numbers disagree" the moment the event spine exists.

**Files grounding this sequence (read-only, absolute):** `/Users/andres/coffee-farm-operations/supabase/migrations/{20260620120000_init,20260620140000_auth_required_rls,20260620150000_grant_hygiene}.sql`, `/Users/andres/coffee-farm-operations/src/lib/db/{trends,activity,plots}.ts`, `/Users/andres/coffee-farm-operations/package.json`, `/Users/andres/coffee-farm-operations/CLAUDE.md`. **Proposed new migrations (renumbered to clear the live `150000` head):** `20260621090000`–`20260621094500` (S1–S8).

## §1 — Chief Architect Brief (unified Phase-1 architecture)

The third migration `20260620150000_grant_hygiene.sql` is the real head — every track grounded on `20260620140000` as the max, and several proposed migrations starting at `20260620150000` (which now **collides** with an existing applied migration). This is a load-bearing correction. I have what I need.

---

# Phase-1 SPINE — Unified Architecture Brief
## Janson Coffee Farm Operations · Chief Architect Consolidation

This brief merges the five track inputs (System & Infrastructure, Domain Model/DDD, Application Architecture, World-Class UI/UX, Cross-Cutting Concerns) and the Reuse Analysis into one decisive Phase-1 architecture. Where tracks contradicted each other or the ground truth, I resolve it here, once, with rationale. Decisions are numbered **UA-n** (Unified Architecture) and are the SSOT contract DISTILL/DELIVER build against.

---

## 0. Ground-truth corrections that reshape the brief (read first)

Two facts the tracks missed or split on, verified against the live repo:

**0.1 — The migration head is `20260620150000_grant_hygiene.sql`, not `20260620140000`.** A third migration is already applied. It (a) revokes all INSERT/UPDATE/DELETE from `anon` *and* `authenticated`, and (b) **locks `alter default privileges`** so future tables are not silently writable. Consequences that override the track inputs:
- The Domain and App-Architecture tracks proposed new migrations at `20260620150000`/`20260620160000…` — these **collide with an applied migration**. **All Phase-1 migrations must sort strictly above `20260620150000`.** Locked sequence in §6.
- The default-privilege lock means a new table is born with **no write grant to either role** even before we add policies. Our `SECURITY DEFINER` RPC write model (UA-4) is therefore *already* the only write path by construction — but every command RPC must `GRANT EXECUTE … TO authenticated` explicitly, and the definer's owning role is the only thing that can write base tables. This is a gift: it makes "writes only through RPCs" structurally true, not just policy-true.

**0.2 — RLS is authenticated-only; anon reads nothing.** The System track caught this; I'm promoting it to a global invariant. Every new table, view, and policy grants SELECT/EXECUTE to **`authenticated` only** — never `anon`. The **one deliberate exception** is the public per-lot microsite (UA-19): a single curated `lot_provenance_view` is granted to `anon` with a regression test asserting no PII/cost column is selectable. No other anon grant exists anywhere in Phase-1.

---

## 1. Overview — the one sentence the architecture turns on

**For a single-estate Geisha house, provenance *is* the product premium — so the Phase-1 SPINE turns the read-only app into a single source of truth whose every number provably derives from one place, delivered through an Apple-grade liquid-glass surface, on a $0 stack.** Trust is the load-bearing quality attribute; world-class UI is the mandated surface trust is *believed* through; $0 and offline-readiness are a ceiling and a future-option to be **governed, not built**.

The mechanism, in one diagram:

```
        WRITE (≤8 command RPCs, SECURITY DEFINER, one txn each)
   Server Action ──► command()  ──►  RPC: mutate row + append event  ──► one transaction
                                          │
   ┌──────────────────────────────────────┴──────────────────────────────────┐
   │                          CANONICAL TRUTH (SSOT)                            │
   │  lots(code) = graph nodes · lot_edges(mass on every edge) · plots+PostGIS  │
   │  green_lots · event_log (append-only, hash-chained) · units                │
   └──────────────────────────────────────┬──────────────────────────────────┘
                                           │  projected by
        DERIVED TRUTH = security_invoker SQL VIEWS (never hand-authored, never stored)
   v_metric_* (season/daily/weekly/variety) · lot_cogs · activity(=events) · plots_geojson · eudr
                                           │  read by (unchanged)
        PORTS  src/lib/db/*.ts  (cache() + getSupabase() + pure mapX)  ──► EXTENDED in place
                                           │  rendered by
        UI  Server Components + exactly 2 client islands (MapLibre, lot-graph pan/zoom)
            liquid glass · 60fps GPU-only · tiny bundle · instant glass skeletons
```

Every one of the 8 capabilities is a facet of this single spine — not 8 features, one substrate with 8 projections.

---

## 2. The contradiction-resolution table (what I overrode and why)

The tracks were authored in parallel and genuinely disagreed on six load-bearing points. Resolved here, once:

| # | Conflict | Track positions | **Locked resolution & rationale** |
|---|---|---|---|
| R1 | **Module structure** | App-Arch + Reuse: extend `src/lib/db/*` in place. Sys/Domain fragment 1: `src/modules/` or `src/lib/contexts/`. | **Extend `src/lib/db/*` (UA-1).** The existing functional read-repository already *is* ports-and-adapters; `src/modules/` churns every import to buy a boundary a solo $0 app doesn't need. Bounded-context isolation is a **grep-guard test**, not a folder tree. |
| R2 | **Write-path location** | App-Arch: `src/lib/db/commands/*`. Domain/Sys: command RPCs. | **Both, layered (UA-4):** thin TS `command()` in `src/lib/db/commands/*` → one `SECURITY DEFINER` RPC that mutates+appends-event in one txn. The TS layer is Zod-validated ergonomics; the SQL is the enforcement. |
| R3 | **Geometry storage** | App-Arch + UI: side table `plot_geometry`. Reuse + Sys: columns on `plots`. | **Columns on `plots` for the canonical polygon + DEM scalars (UA-9).** One-canonical-geometry / one-schema-author keystone — a side table invites a second geometry author and an ACL view. `plots` daily-read cost is unaffected (geometry columns aren't in the hot getters' `select`). `area_ha`/`altitude_masl` **retained as derived-backfilled** so every existing plot component/test survives. Reserve is its own first-class table. |
| R4 | **Aggregates: views vs matviews** | All tracks: `security_invoker` views for season/daily/weekly/variety. App-Arch: COGS as a **matview**. | **All four aggregates = live `security_invoker` views (UA-5).** COGS is **also a live view** in Phase-1, not a matview — at 10-plot scale a recursive CTE is sub-ms, and a matview needs a refresh the free tier can't reliably cron (no pg_cron guarantee, 7-day pause). Matview is a documented escape hatch (ADR-SL-002), built only if a view ever measures >50ms. |
| R5 | **Caching policy** | App-Arch: drop global `force-dynamic`, tag-cache derived reads. UI/Sys: keep dynamic. | **Drop blanket `force-dynamic`; cache *derived* reads with `unstable_cache`+`revalidateTag`, keep *raw operational* reads dynamic (UA-6).** The scarce resources are DB round-trips and the 7-day pause; the data cache survives the pause and recomputes-on-write via tags. |
| R6 | **MapLibre version & wrapper** | Cross-Cutting: `maplibre-gl@^5.6.0` + `react-map-gl@^8`. UI + Reuse: vanilla `maplibre-gl@^5`, no react-map-gl. App-Arch/Reuse mentioned v4. | **`maplibre-gl@^5.6.0`, vanilla — NO react-map-gl (UA-7).** v5 is the current React-19-ready line (overrides the stale v4 mentions). Vanilla wrapper keeps the dependency to one package and full control of `feature-state` GPU repaint; react-map-gl adds a React-reconciler layer we don't want on the 60fps path. |

Two naming alignments locked: edge ops are **`split | merge | blend | mill | roast`** (the Domain track's `process`/`transform` collapse to `mill` for the cherry→green stage advance + `roast` reserved); the audit substrate table is **`event_log`** (Sys naming wins over Domain's `lot_event` — it's farm-wide, not lot-only).

---

## 3. Component map — modular monolith, ports-and-adapters

One Next.js app, one `public` Postgres schema. Bounded contexts are **module + naming boundaries enforced by a grep-guard test (UA-2)**, not separate DB schemas (rejected: separate schemas multiply RLS/grant/PostgREST surface for zero benefit at single-tenant scale).

```
LAYER 4  Screens          app/(app)/**/page.tsx · app/(public)/lot/[code]   ← thin async server: fetch → compose
LAYER 3  Composites       components/sections/<domain>/*                    ← domain-aware glass chrome; mount islands
LAYER 2b Islands          components/islands/*.client.tsx                   ← MapLibre + lot-graph ONLY; dynamic ssr:false
LAYER 2a Primitives       components/ui/* · components/charts/* (pure SVG)  ← server-safe, no domain types
─────────────────────────────────────────────────────────────────────────────────────────────
PORTS    src/lib/db/*.ts  (read getters + commands/*)                        ← the seam; cache()+getSupabase()+mapX
ADAPTER  Supabase PostgREST (.from / .rpc)                                   ← only callable from inside src/lib/db/*
TRUTH    SQL: canonical tables + security_invoker views + command RPCs       ← derived TRUTH lives here, not in TS
CONTRACT src/lib/types/* (barrel)                                            ← domain types
```

**The boundary rule (UA-3, enforced by `check-port-discipline.test.ts`):** no file under `src/app/**` or `src/components/**` may import `getSupabase` or call `.from(`/`.rpc(`. App code imports only `src/lib/db/*` functions. This realizes the ports-and-adapters *intent* (dependency inversion → a future offline adapter is a drop-in) with one test instead of a folder hierarchy.

**Bounded contexts (TS modules + naming, grep-guarded):** Land&Geometry, Harvest, Processing, Inventory/GreenLot, Compliance/EUDR, Costing. The **lot graph + event_log + units** are shared substrate. The **semantic layer is not a context** — it's a read-only view projection.

**Layer discipline (UA-8): derived TRUTH in SQL, derived PRESENTATION in TS.** Metrics/COGS/EUDR-verdict/mass-balance → SQL views/functions (one definition = every screen reads the same row = trust is structural). Formatting/graph-layout/GeoJSON-shaping/map-styling → TS in or above the port (testable in jsdom, no DB).

---

## 4. Data / domain model summary

**Identity (UA-10 — dual authority):** keep human `text` PKs on slow-moving anchors (`plots.id` `p-tizingal-alto`, `workers.id` `w-06`, `lots.code` `JC-564`) — the canonical-id intent is *already satisfied*, and every existing FK survives. New field-capturable/graph rows (`event_log`, `lot_edges`, future weigh-events) use **client-mintable UUIDv7, no DB DEFAULT**, minted at one port `src/lib/ids.ts` (server now, future PWA later).

**Lot genealogy (UA-11):** promote `lots(code)` in place into the canonical node (add `kind, variety, minted_from, created_at, stage, current_kg, is_single_origin`). The graph is the one unavoidable new relation: `lot_edges(parent_code, child_code, op, mass_kg)` — **mass on every edge**, `CHECK (mass_kg >= 0)`, server-side conservation guard (`sum(child) ≤ parent`) in the split/merge/blend RPCs. Auto-mint `JC-NNN` server-side, gap-free via sequence, inside the intake txn. **A GreenLot is a lot node** (`green_lots.code → lots.code`) promoted via a `mill` edge — not a parallel identity, not an 8th stage.

**Event substrate (UA-12):** one append-only, hash-chained `event_log` (`prev_hash → hash = sha256(...)` computed in a `BEFORE INSERT` trigger via `pgcrypto`, never trusted from client; immutable — no UPDATE/DELETE policy + block triggers). It is simultaneously Cap-6 audit, the activity-feed source, the semantic-layer event source, and the offline replay log — **one table, not four**. The existing `activity` table becomes a **view projecting `event_log`** into the existing `ActivityItem` shape → `getActivity()` and `activity-feed-card.tsx` unchanged. Causal-ordering columns NOT NULL from event #1: `device_id`, `device_seq`, dual clocks `occurred_at` (field) vs `recorded_at` (server) — the entire offline schema investment, unrecoverable if added later.

**Units (UA-13):** a tiny UCUM `units` table + `convert_qty()` (returns NULL on incommensurable dimensions — fails loud), normalized to kg before anything touches the ledger. One hardened converter module. Not a generic EAV ledger.

**Geometry (UA-9):** `plots.geom geometry(MultiPolygon,4326)` + `centroid` + DEM scalars (`elevation_*`, `slope_deg_mean`, `aspect_deg_mean` via **circular mean**) + generated `geom_area_ha` reconciling against the frozen `area_ha` (>5% drift = a data-quality *signal*, not an error). DEM derived **once at build time** from Copernicus GLO-30 by a local `scripts/derive-terrain.mjs`; **no raster ever in Postgres** (`postgis_raster` is a storage trap *and* GDAL drivers are disabled on Supabase managed infra — decisively confirmed). The 200-ha quetzal reserve is a first-class `reserve_zones` table (no variety/yield → not a plot). GiST index on every geometry column; PostGIS installed into the `extensions` schema (Supabase convention; keeps PostREST from exposing 1,000+ functions as RPC).

**Inventory ATP (UA-14):** `green_lots` with **computed** `sca_grade` (generated column from defect count + moisture) and **derived** ATP (`available_kg = weight − Σreserved − Σshipped`) via a view over append-only reservation/shipment claim rows. A `prevent_oversell` BEFORE-INSERT trigger makes double-selling a scarce micro-lot **physically impossible at the data layer** — fail-closed, not UI-discouraged.

**Compliance (UA-15):** deforestation-free is a snapshotted `deforestation_checks` verdict (hash-chained, same substrate), **never a `plots` boolean**. `established_year ≤ 2020` is a deterministic establishment test run inside every check. The DDS is minted only via `issue_dds()` RPC that gates on passing checks for every covered plot, freezes a snapshot, and writes a `DDS_ISSUED` event — **the gate is in the database**, the disabled UI button is courtesy. The deforestation determination sits behind a `DeforestationOracle` port; Phase-1 ships an establishment-only adapter ($0, no external call) + the JRC-2020-baseline precompute script; GFW/JRC live API drops in later without reshaping. **v1 is "generate + park + manual submit"** — a legal declaration is exactly the irreversible action that never auto-fires.

**COGS (UA-16):** one append-only `cost_entry` ledger; cost-per-kg-green is a **derived view**, never a stored column. Corrections are reversing entries (never UPDATE/DELETE) → the ledger doubles as the future QBO/Xero journal source.

**Tenancy (UA-17):** `farm_id NOT NULL` defaulted to one seeded `janson` row on every business row now — **build the column + predicate, not tenant switching**. ~20 lines now vs an 18-table RLS retrofit later. `farm_id` is an RLS-predicate column + index, **never** part of a composite PK (the TradelyHQ composite-FK delete-trap lesson). One RLS policy factory (`app.apply_farm_rls`) stamps authenticated-READ-filtered + owner-only-WRITE; `app.current_farm_id()` coalesces to the sole farm so today's plain authenticated session works with zero JWT plumbing.

**Contract split (UA-18):** split `src/lib/types.ts` into a `src/lib/types/` barrel (`index.ts` re-exports `plot/harvest/lot/green-lot/event/metrics`). The only structural CREATE — lets parallel agents author new types file-disjoint. Existing `@/lib/types` imports unchanged.

---

## 5. Technology stack (pinned, with rationale)

| Concern | Choice (pinned) | Rationale |
|---|---|---|
| Framework | **Next.js `^15.1.6`** + **React `^19`** + TypeScript `^5.7` strict | already in repo; App Router + Server Components = tiny bundle |
| Styling | **Tailwind `^4`** + the `globals.css` glass system | extend, never fork (CLAUDE.md contract) |
| Backend | **Supabase free-tier Postgres** + `@supabase/ssr ^0.12` / `supabase-js ^2.108` | already wired; one `cache()`'d client |
| Geometry | **PostGIS** (in `extensions` schema), `postgis` only — **never `postgis_raster`** | raster GDAL disabled on managed Supabase; vector is KB |
| DEM | **Copernicus GLO-30** (CC-BY, void-filled), derived once via local `gdaldem` script | free, cleaner license than SRTM; scalars stored, raster discarded |
| Map | **`maplibre-gl@^5.6.0`, vanilla (no react-map-gl)**; **OpenFreeMap** tiles (no key), MapTiler-free fallback | only $0 WebGL-vector renderer; one heavy chunk, `dynamic(ssr:false)`, `/map ≤230KB`; never proxy tiles through Supabase |
| Charts / graph | **none** — hand-rolled server SVG (the `donut.tsx` idiom); `d3-shape ^3.2` / `d3-scale ^4` *functions only*, server-side; `elkjs ^0.9.3` lazy server-side escape hatch | repo already proves zero-JS SVG charts; rejects recharts/visx/react-flow/cytoscape (90–350KB) |
| EUDR baseline | **JRC Global Forest Cover 2020** GeoTIFF + `@turf/turf` + `geotiff.js` (pure-JS, no GDAL); GFW as secondary corroboration | the EU's own legal baseline; deterministic, testable, $0 |
| PDF | `@react-pdf/renderer ^4` (client island, DDS export only) | no server Chrome needed |
| Hashing | node `crypto` / `pgcrypto.digest()` | no dep |
| Tests | **Vitest `^4`** + jsdom + `@testing-library/react ^16`; **PGlite `@electric-sql/pglite ^0.3`** (Postgres-17 WASM + postgis) for real SQL/RLS/recursive-CTE tests | Docker absent on the build machine — PGlite is the only $0/no-Docker path that runs *real* Postgres |
| Quality gate | **local `npm run build && npm run test && tsc --noEmit`** + a `perf:budget` script | **no CI / no GitHub Actions** (hard constraint) |

No client data/state library (UA: keep `react.cache()` + Server Components + URL search params + Server Actions). The net client-JS delta for Phase-1 is **MapLibre (one lazy route) + ~2KB graph pan/zoom + the capture-form/PDF island** — everything else is 0KB server work.

---

## 6. Migration sequence (one author, collision-free, head = `20260620150000`)

One serialized schema-author lane. Strictly `> 20260620150000`. Expand-and-contract: additive-first so `main` stays buildable at every commit; the DROP/contract step is a separate gated PR. Each migration appends its tables to the RLS factory and grants EXECUTE on its RPCs to `authenticated` only.

| # | Migration | Owns | Depends on |
|---|---|---|---|
| M1 | `20260621090000_postgis_geometry.sql` | PostGIS ext (in `extensions`); `plots.geom`+centroid+DEM scalars+generated `geom_area_ha`; `reserve_zones`; GiST; `plots_geojson`/`reserve_geo` views | — (first; EUDR/map join `geom`) |
| M2 | `20260621091000_tenancy_security.sql` | `farms`; `app` schema helpers; `farm_id`+index on every table; `app.apply_farm_rls` factory; re-stamp policies onto the authenticated-only baseline | M1 |
| M3 | `20260621092000_event_units_lotgraph.sql` | `units`+`convert_qty`; `event_log` (chain trigger, immutability, `verify_chain`); promote `lots`; `lot_edges`; `lot_yield_balance`; the ≤8 command RPCs; `activity`→view | M2 |
| M4 | `20260621093000_green_inventory.sql` | `green_lots` (generated `sca_grade`); reservations/shipments; `green_lots_atp` view; `prevent_oversell` trigger | M3 |
| M5 | `20260621094000_derived_metrics_cogs.sql` | **rename-aside** the 4 aggregate tables; `farm_season_config`; `v_metric_*` + `v_metric_plot_status`; `cost_entry`; `lot_cogs` view; `fn_metric_*` RPCs | M3 |
| M6 | `20260621095000_eudr_outbound.sql` | `plots.eudr_*`; `deforestation_checks` (hash-chained); `dds_submissions`; `outbound_deliveries`; `compliance_threshold` | M1, M3 |
| M7 | `20260621096000_drop_flat_scalars.sql` | **gated, separate PR** — contract step, only after read-path cutover verified | M5 |

`create extension`, new-table RLS, and the rename-aside (M1, M2, M5) **flag for explicit apply-OK** before running, even with no CI. Rename-aside (not hard DROP) gives one-line rollback. App-code work (new `src/lib/db/*` ports, integration adapters, the audit drawer, all UI) **fans out file-disjoint in parallel**, closed by a reviewer pass.

---

## 7. How world-class UI is *structurally* guaranteed (the #1 quality attribute)

The mandate is enforced by architecture and tests, not by hope:

1. **Server-first is the default; islands are a budgeted exception (UA: exactly 2 — `FarmMap`, `LotGraph`).** `check-client-budget.mjs` fails if `"use client"` appears in `app/**` or `sections/**`; every `"use client"` carries a "why interactive" comment. The ~9.5% client-file ratio is the asset protected.
2. **One token source, extended in place** — `globals.css @theme` + the `brand.ts`/`charts/tokens.ts` mirrors, a guard test keeping them in sync. The glass material (`glass-card`, `glass-sheen`, `stagger`, `animate-rise`, `cv-auto`, `perf-contain`, `--ease-glass`) is reused verbatim; new utilities are additive only.
3. **Glass-over-a-moving-map is solved (UA-7 / the one cross-fragment contradiction):** the map canvas on its own GPU compositor layer + a **static cached gradient veil** the floating glass samples (never the per-frame WebGL pixels) + an `is-panning` flag that **drops `backdrop-filter` to none during the gesture**. The only mechanism that holds both frosted-glass aesthetics *and* 60fps pan, especially on the iPad-class hardware a farm office uses.
4. **Maps and the lot-graph are operable, not just pretty (UA-18 a11y):** dual representation — the canvas/SVG is `aria-hidden` delight over a real keyboard-navigable accessible primary (an SR-only plot list; a `role="tree"` lineage walk with edge-mass as text), which doubles as the no-JS / load-failed fallback. The lot-graph is a **server-laid-out Sankey-style SVG** (edge stroke-width ∝ kg — mass made literally visible), pure-deterministic, ~0KB beyond a thin pan/zoom island. No graph library.
5. **Contrast is certified against a pinned worst-case composited background**, not pure white (`contrast-tokens.test.ts` hard-gates text ≥4.5:1, non-text/focus ≥3:1). The two known bugs are fixed Phase-1: `button.tsx` `focus-visible:ring-forest-100` (~1.1:1, fails WCAG 2.4.11) → a two-tone `.focus-ring`; topbar search `text-sm` (iOS auto-zoom) → 16px-min inputs.
6. **The missing mobile nav is built** (flagged loudly: the brief claimed it exists; it does not — sidebar is `hidden md:flex` with no replacement). A fixed bottom tab bar + "More" sheet, registry-driven; dense tables collapse to record-cards below `md` (never horizontal scroll); 44×44px targets, `min-h-dvh`, safe-area insets.
7. **Trust is made *visible*:** every derived card shows a "Live · derived" chip and freshness ("derived from N harvests · as of HH:MM"); `ytd_revenue_usd` (no Phase-1 source) renders honestly as "Est. · modeled" until GreenLot sales exist. The semantic-layer view-swap means dashboard numbers reconcile **by construction** — no screen can show two different "harvested kg" again.
8. **Every async surface ships a layout-faithful glass skeleton** (CLS≈0) + per-section `<Suspense>` so a waking free-tier DB never blanks a route; a `<WarmingHint>` ("Waking the farm records…") appears only after 1.2s, distinct from a genuine error card.

Where glass and the legibility of a trust-number conflict, **the number wins the surface** — grade/COGS values render on a forest-tinted solid AA token, not translucency.

---

## 8. The $0 envelope — honest verdict

| Resource | Phase-1 need | Free wall | Verdict |
|---|---|---|---|
| Postgres data | <50 MB for years | 500 MB | ✅ huge headroom; only `event_log` grows (~60–120 MB/season at the high end) — partition/cold-archive is years out |
| Geometry | <1 MB (10 polygons + reserve) | within 500 MB | ✅ vector is KB; **raster kept out entirely** (broken anyway) |
| Storage (media) | tens of MB/yr | 1 GB | ⚠️ the only real risk — compress-on-upload (≤300KB WebP), DEM/satellite tiles fetched-and-discarded, never stored; future media by pointer to free R2 |
| **7-day idle pause** | — | pauses, deletable if left | ⚠️ **the critical control** — a `<7-day` keep-warm ping (pg_cron internal touch + a daily Vercel-Cron `GET /api/heartbeat`, **never a GitHub Action**); the data cache (UA-6) serves a cold farm without waking the DB |
| Connections | 1 cached client/request | ~60 | ✅ route through the Supavisor pooler |
| Backup/PITR | nightly pg_dump | no self-serve PITR | ⚠️ DR = your dumps (local launchd) + migrations-in-git + the replayable hash-chained `event_log` |
| Scheduler / CI | batch/flush/keep-warm | no pg_cron guarantee / no GitHub Actions | ✅ `tsx` scripts local or externally-triggered free Edge Function; quality gate is local |

**Verdict: the vector geometry, event log, lot graph, semantic layer, COGS, inventory, and EUDR ledger are comfortably free-tier-viable for 5–10+ years at single-estate scale (Phase-1 data reaches ~30% of the 500MB cap after five seasons).** The only ceilings that bite are media storage and the 7-day idle pause — both have $0 mitigations. Rasters and time-series telemetry are what would threaten 500MB, and Phase-1 deliberately keeps both out of Postgres. Documented escape hatch: Supabase Pro ($25/mo, 8GB) only on sustained genuine >80% growth — which Phase-1 never reaches.

---

## 9. Top open questions for DISTILL / DELIVER

1. **GreenLot PK contract (blocking M4/M6):** pin `green_lots` PK name/type — `dds_submissions.green_lot_id` and the `mill` edge reference it. Decided here as `green_lots.code → lots.code` (UA-14); DISTILL must ratify before M4 acceptance tests.
2. **Washed green-from-cherry yield-loss tolerance (~16–20%)** for the mass-conservation invariant's `≈` — needs the family's house number; placeholder `lot_yield_curve` seeded, flagged for agronomy review.
3. **SCA grade thresholds + the EUDR allocation/overhead cost rule** — defensible placeholders; flag for Janson's house-standard review before seed.
4. **Backup scheduler + the backup-role-vs-`force RLS` interaction** (Andres's call) — `force row level security` means the dump runs as a role that can read all farms; spec `scripts/backup.sh` after that decision.
5. **`ytd_revenue_usd` source** — honestly stored+labeled "modeled" in Phase-1; becomes derivable only when GreenLot *sales* land (Phase-2). Owner: GreenLot/sales track.
6. **Pre-render prerequisites (Andres):** the seed-polygon basemap-tracing pass + a one-time `scripts/derive-terrain.mjs` run must complete before the map renders real geometry.
7. **Single-author contract files** (`globals.css`, `brand.ts`, `charts/tokens.ts`, `nav/registry.ts`, `types/index.ts`) — one author per wave, serialized lane, per the no-drift rules.
8. **Test-env bootstrap (gates all render tests):** the first UI PR sets up jsdom + `@testing-library/react`; the first SQL PR sets up PGlite+postgis — both are prerequisites, not feature work.

---

## 10. Decisive summary (one line each)

1. The existing `src/lib/db/*` IS the ports-and-adapters seam — extend it; one new port per entity, identical shape; boundary enforced by one grep-guard test, not a `src/modules/` tree.
2. Writes flow Server Action → `command()` → one `SECURITY DEFINER` RPC that mutates the row and appends the event in **one transaction** — the only write path, made structurally true by the already-applied default-privilege lock.
3. The four hand-authored aggregate tables become `security_invoker` views of identical column shape — the #1 trust fix at zero port/UI cost; COGS is a live view too (matview is a built-only-if-measured-slow escape hatch).
4. `lots(code)` text PK stays the canonical lot node; `lot_edges` (mass on every edge, conservation-guarded) is the one unavoidable new table; a GreenLot is a lot node promoted via a `mill` edge.
5. PostGIS extends `plots` (canonical polygon + DEM scalars); `area_ha`/`altitude_masl` retained as derived-backfilled; raster never enters Postgres; the reserve is a first-class table.
6. One append-only hash-chained `event_log` is audit + activity feed + metrics source + offline replay log; `activity` becomes a view over it; offline-readiness costs only a handful of NOT-NULL columns now.
7. Exactly two client islands (MapLibre v5 vanilla, lot-graph pan/zoom); everything else is server SVG / Server Components; glass-over-moving-map solved by static-veil + pan-kill; trust-numbers win the surface over translucency.
8. $0 holds for 5–10+ years; the only real ceilings are media storage and the 7-day pause, both mitigated; migrations sort strictly above the true head `20260620150000`, one author, expand-then-contract.

**Grounding (all read-only, verified this session):** `/Users/andres/coffee-farm-operations/supabase/migrations/{20260620120000_init,20260620140000_auth_required_rls,20260620150000_grant_hygiene}.sql` (the third is the true head every track missed), `/Users/andres/coffee-farm-operations/package.json` (6 runtime deps; no maplibre/postgis yet), `/Users/andres/coffee-farm-operations/CLAUDE.md` (the $0/no-CI/TDD-every-PR overrides), `/Users/andres/coffee-farm-operations/src/lib/types.ts`, `src/lib/db/*.ts`, `src/lib/supabase/server.ts`, `src/app/globals.css`, `/Users/andres/janson-coffee-INTEGRATION-INVESTIGATION.md`. **New artifacts proposed:** migrations M1–M7 (`20260621090000`–`096000`), ports `src/lib/db/{lots,green-lots,events,cogs,geometry,eudr}.ts` + `commands/*`, `src/lib/{ids.ts, types/* barrel, units/ucum.ts, integration/*, eudr/*}`, `src/components/islands/{FarmMap,LotGraphInteractive}.client.tsx` + the audit drawer + chart/nav primitives, `scripts/{derive-terrain.mjs, eudr-verify.ts, backup.sh, perf:budget}`.

## §2 — C4 Diagrams

I'll produce the mandatory C4 diagrams from the consolidated track sections. Let me ground the System Context boundaries against the actual external dependencies named across the tracks, then author clean Mermaid.

The sections are richly detailed and internally consistent on the load-bearing facts (authenticated-only RLS head `20260620140000`, MapLibre `^5.6.0`, Supabase free tier, the event-log/lot-graph spine, EUDR external data sources). I have everything needed.

C4 LEVEL 1 — SYSTEM CONTEXT

```mermaid
graph TB
  classDef person fill:#08427b,stroke:#052e56,color:#fff
  classDef system fill:#00291D,stroke:#001610,color:#fff
  classDef ext fill:#6b6b6b,stroke:#4a4a4a,color:#fff

  owner["Farm Owner / Agronomist<br/>(Janson family)<br/>[Person]<br/>Records harvests, advances<br/>processing, mints lots,<br/>issues EUDR DDS"]:::person
  picker["Field Worker / Picker<br/>[Person]<br/>Cherry intake + task<br/>capture on phone"]:::person
  buyer["Buyer / Auditor<br/>[Person]<br/>Reads public lot<br/>provenance microsite"]:::person

  spine["Janson Coffee Farm Operations<br/>[Software System · Next.js 15 / React 19 / Supabase free tier]<br/>Single source of truth: lot-genealogy graph, PostGIS geometry,<br/>derived metrics, append-only event log, GreenLot inventory,<br/>EUDR export, activity-based COGS — liquid-glass UI"]:::system

  supabase["Supabase (free tier)<br/>[External · Postgres 15 + PostGIS + Auth + Storage]<br/>RLS-enforced data, SECURITY DEFINER<br/>command RPCs, pg_cron heartbeat"]:::ext
  tiles["OpenFreeMap / MapTiler<br/>[External · vector basemap tiles]<br/>No-key OSM tiles for the map"]:::ext
  dem["Copernicus GLO-30 DEM<br/>[External · CC-BY elevation raster]<br/>Elevation/slope/aspect, sampled once at ingest"]:::ext
  forest["JRC Global Forest Cover 2020 + GFW<br/>[External · deforestation baseline rasters]<br/>2020-cutoff verdict, precomputed offline"]:::ext
  traces["EU TRACES-NT<br/>[External · EUDR Due Diligence registry]<br/>Manual DDS submission (Phase-1: generate + park)"]:::ext
  drive["Family Google Drive<br/>[External · backup target]<br/>Nightly pg_dump custom-format DR copy"]:::ext

  owner -->|"Captures + manages records,<br/>issues DDS · HTTPS"| spine
  picker -->|"Field capture<br/>(Server Actions) · HTTPS"| spine
  buyer -->|"Reads /lot/[code]<br/>(SSG, anon) · HTTPS"| spine

  spine -->|"Reads/writes via PostgREST +<br/>command RPCs · auth JWT"| supabase
  spine -->|"Fetches basemap tiles<br/>(client, /map only)"| tiles
  spine -.->|"Build-time terrain derivation<br/>(scripts/derive-terrain)"| dem
  spine -.->|"Offline deforestation overlay<br/>(scripts/eudr-verify)"| forest
  spine -.->|"Generates DDS; manual upload"| traces
  spine -.->|"Nightly pg_dump (launchd)"| drive
```
*System Context — the farm-ops SSOT serves three human roles over HTTPS, persists to Supabase free-tier Postgres, and depends on free external geo/forest data sources that are consumed offline at build/script time (dashed) rather than on any render path.*

C4 LEVEL 2 — CONTAINER

```mermaid
graph TB
  classDef person fill:#08427b,stroke:#052e56,color:#fff
  classDef container fill:#00291D,stroke:#001610,color:#fff
  classDef island fill:#0a4733,stroke:#001610,color:#fff
  classDef store fill:#1168bd,stroke:#0b4884,color:#fff
  classDef ext fill:#6b6b6b,stroke:#4a4a4a,color:#fff
  classDef script fill:#3d5a45,stroke:#243528,color:#fff

  owner["Farm Owner /<br/>Agronomist"]:::person
  picker["Field Worker"]:::person
  buyer["Buyer / Auditor"]:::person

  subgraph app["Janson Coffee Farm Operations [Software System]"]
    rsc["App-Router Server Components<br/>[Container: Next.js 15 RSC / React 19]<br/>Pages + sections; fetch via db ports,<br/>compose glass UI; mostly server-rendered"]:::container
    actions["Server Actions + Route Handlers<br/>[Container: Next.js 'use server' / api routes]<br/>Mutation wrappers (Zod) + EUDR<br/>file-download / GeoJSON handlers"]:::container
    ports["Data-Access Ports + Domain<br/>[Container: TypeScript src/lib/db/* + commands/* + domain/*]<br/>Pure mapX getters, command()→RPC,<br/>units/i18n/event/COGS/EUDR logic — the only .from()/.rpc() site"]:::container
    map["FarmMap island<br/>[Container: client · maplibre-gl ^5.6.0, ssr:false]<br/>WebGL spatial home; feature-state paint;<br/>route-split to /map only"]:::island
    graph["LotGraph island<br/>[Container: client · SSR-SVG + thin pan/zoom]<br/>Mass-proportional genealogy ribbons;<br/>loads only on /lots/[code]"]:::island
    public["Public Microsite<br/>[Container: Next.js (public) route group · SSG]<br/>/lot/[code] static buyer provenance,<br/>anon-safe view only"]:::container
  end

  subgraph sb["Supabase (free tier) [External Software System]"]
    pg["Postgres 15 + PostGIS<br/>[Container: DB]<br/>lots+lot_edges, event_log (hash-chain),<br/>plots.geom, v_metric_* views, green_lots,<br/>deforestation_checks; force RLS"]:::store
    rpc["SECURITY DEFINER RPCs<br/>[Container: plpgsql]<br/>~8 command fns: mutate row + append<br/>event in one txn; lot-code mint; issue_dds"]:::store
    auth["Supabase Auth<br/>[Container]<br/>Authenticated-only sessions;<br/>app_role / farm_id JWT claims"]:::store
    cron["pg_cron<br/>[Container]<br/>Daily keep-warm touch<br/>(< 7-day idle pause)"]:::store
  end

  tiles["OpenFreeMap /<br/>MapTiler"]:::ext
  forest["JRC 2020 + GFW"]:::ext
  dem["Copernicus GLO-30"]:::ext
  traces["EU TRACES-NT"]:::ext
  drive["Family Drive"]:::ext

  scripts["Offline tsx/mjs scripts<br/>[Container: Node CLI, no CI / no GH Actions]<br/>derive-terrain · eudr-verify · backup.sh ·<br/>integration flush — manual / Vercel-Cron"]:::script

  owner --> rsc
  picker --> actions
  buyer --> public

  rsc -->|"calls (server)"| ports
  rsc -->|"renders + passes<br/>GeoJSON/node-edge props"| map
  rsc -->|"renders + passes<br/>layout props"| graph
  actions -->|"calls"| ports
  ports -->|"SELECT via PostgREST<br/>(RLS authenticated)"| pg
  ports -->|"writes via .rpc()<br/>(EXECUTE: authenticated)"| rpc
  rpc -->|"mutate + append event<br/>(one transaction)"| pg
  ports -->|"session JWT"| auth
  map -->|"tile fetch (client)"| tiles
  public -->|"reads anon<br/>lot_provenance_view"| pg
  cron -->|"keep-warm"| pg

  scripts -->|"writes geom/DEM scalars,<br/>deforestation_checks (admin role)"| pg
  scripts -.->|"clip terrain"| dem
  scripts -.->|"overlay 2020 baseline"| forest
  scripts -.->|"pg_dump custom"| drive
  rsc -.->|"generate DDS;<br/>manual submit"| traces
```
*Container — Server Components and Server Actions are the only callers of the `src/lib/db/*` port layer (the sole `.from()`/`.rpc()` site); two route-split client islands (MapLibre map, SVG lot-graph) and an SSG anon microsite are the only client/public surfaces; all writes go through SECURITY DEFINER RPCs that mutate-and-append-event in one transaction; external geo/forest data is folded in by offline Node scripts, never on a render path.*

C4 LEVEL 3 — COMPONENT (lot-genealogy + event-log subsystem)

This subsystem is the architectural keystone — eight capabilities are facets of it, and the "mutation + event = one transaction" rule plus the hash chain live here. A component view materially clarifies it.

```mermaid
graph TB
  classDef comp fill:#00291D,stroke:#001610,color:#fff
  classDef tbl fill:#1168bd,stroke:#0b4884,color:#fff
  classDef trig fill:#7a4f9e,stroke:#4a2e63,color:#fff
  classDef ext fill:#6b6b6b,stroke:#4a4a4a,color:#fff

  action["Server Action<br/>[Next.js 'use server']<br/>recordHarvest / splitLot /<br/>blendLots / issueDDS"]:::ext

  subgraph ts["Data-Access + Domain [Container: TypeScript]"]
    cmd["command() helper<br/>[src/lib/db/commands/*]<br/>Zod validate → .rpc() →<br/>revalidateTag('metrics:*')"]:::comp
    domain["Domain core<br/>[src/lib/domain/*]<br/>mass-balance + yield-curve<br/>invariants, lot-code mint rule"]:::comp
    ids["newId() port<br/>[src/lib/ids.ts]<br/>client-mintable UUIDv7"]:::comp
    readers["Lineage readers<br/>[db/lots.ts, db/events.ts]<br/>getLotGenealogy → {nodes,edges};<br/>verify-chain reader"]:::comp
  end

  subgraph dbpkg["Postgres lot-graph + event spine [Container: Supabase Postgres]"]
    intake["record_cherry_intake() / mint_lot()<br/>[SECURITY DEFINER RPC]<br/>monotonic JC-NNN mint,<br/>ON CONFLICT(id) DO NOTHING"]:::comp
    split["split / merge / blend / advance RPCs<br/>[SECURITY DEFINER]<br/>write edge + append event,<br/>one transaction"]:::comp
    dds["issue_dds()<br/>[SECURITY DEFINER]<br/>gate on passing checks →<br/>freeze snapshot → DDS_ISSUED event"]:::comp

    lots["lots (nodes)<br/>[table · text PK code]<br/>stage, variety, current_kg"]:::tbl
    edges["lot_edges<br/>[table]<br/>parent, child, kind,<br/>mass_kg, event_seq"]:::tbl
    elog["event_log<br/>[append-only table]<br/>payload, occurred_at,<br/>device_id/seq, prev_hash, hash"]:::tbl
    balance["lot_yield_balance<br/>[view]<br/>mass_in vs mass_out;<br/>conservation guard"]:::tbl
    activity["activity / v_metric_*<br/>[security_invoker views]<br/>projections of event_log"]:::tbl

    chaintrig["chain trigger<br/>[BEFORE INSERT]<br/>hash = sha256(prev_hash‖…)<br/>via pgcrypto"]:::trig
    immutrig["immutability guard<br/>[no UPDATE/DELETE policy<br/>+ raise-on-mutate]"]:::trig
  end

  action -->|"invokes"| cmd
  cmd -->|"validate against"| domain
  cmd -->|"mints id"| ids
  cmd -->|".rpc() write"| intake
  cmd -->|".rpc() write"| split
  cmd -->|".rpc() write"| dds
  cmd -->|"reads back"| readers

  intake -->|"insert node"| lots
  intake -->|"append"| elog
  split -->|"insert"| edges
  split -->|"update mass"| lots
  split -->|"append"| elog
  dds -->|"append DDS_ISSUED"| elog

  elog --> chaintrig
  elog --> immutrig
  edges --> balance
  lots --> balance
  elog -->|"projected by"| activity

  readers -->|"recursive CTE traverse"| edges
  readers -->|"read"| elog
```
*Component (lot-genealogy + event-log subsystem) — every write enters through `command()`, is validated against the pure domain invariants, and executes as one SECURITY DEFINER RPC that mutates the lot node/edge and appends to the hash-chained `event_log` in a single transaction; a BEFORE-INSERT trigger computes the chain hash server-side and an immutability guard forbids UPDATE/DELETE, while `lot_yield_balance` enforces mass conservation and `activity`/`v_metric_*` views are pure read projections of the same log — one substrate behind audit, the activity feed, and the derived-metrics layer.*

## §3 — Architecture Decision Records

The third migration `20260620150000_grant_hygiene.sql` is confirmed: it hardens default privileges (no writes for anon/authenticated, future tables locked). This changes two things for the ADRs: the migration max is now `20260620150000` (proposed migrations must sort above it), AND the `SECURITY DEFINER` write-RPC pattern is now non-negotiable — the tracks' assumption "grant writes to authenticated" is dead, since default privileges revoke writes from authenticated too. Definer functions are the only write path that survives.

I have everything needed. Writing the ADRs now.

Below are the Architecture Decision Records for the Phase-1 SPINE. They cover the significant, contested, or hard-to-reverse decisions distilled from the five consolidated tracks, with the two grounding corrections folded in (RLS head is authenticated-only; migration max is now `20260620150000_grant_hygiene.sql`, and authenticated has no write grant — so definer-RPC writes are forced, not chosen).

---

# Architecture Decision Records — Janson Coffee Phase-1 SPINE

**Status of all:** Accepted (DESIGN wave). **Date:** 2026-06-20. **Decision-makers:** five track leads + ADR author, reconciled.
**Grounding baseline (corrected):** live migration head is `20260620150000_grant_hygiene.sql` (NOT `120000` or `140000` as the tracks assumed). RLS is **authenticated-only SELECT, anon fully revoked, and writes revoked from BOTH anon AND authenticated** including via `alter default privileges`. New migrations sort strictly above `20260620150000`. New objects grant SELECT to `authenticated` only.

---

## ADR-001 — Event-Log-as-SSOT with CQRS-lite projections, NOT classic event-sourcing

**Context.** The #1 trust defect is "numbers disagree across screens." We need an audit substrate (Cap 6), an activity feed, a derived-metrics source (Cap 4), and a future offline-replay log. The temptation is full event-sourcing (rehydrate state by folding the log on every read).

**Decision.** One append-only, hash-chained `event_log` (`prev_hash → hash = sha256(...)`, computed in a `BEFORE INSERT` trigger via `pgcrypto.digest()`, never trusted from the client) is the canonical write substrate for **new** spine capabilities. Current-state tables remain authoritative and are **never** rehydrated by fold-on-read — they are projections kept in sync inside the same write transaction. Immutability is structural: no UPDATE/DELETE policy exists for any client role, plus belt-and-suspenders block triggers. `force row level security` on the table so even the owner cannot mutate it. Causal-ordering columns are NOT NULL from event #1: `device_id`, `device_seq`, dual clocks `occurred_at` (field wall-clock, the key every metric computes on) vs `recorded_at` (server accept clock, the sync cursor). Phase-1 scope: only NEW spine writes go event-first; legacy mutable tables (`plots.harvested_kg`) are not rebuilt onto a replay engine. The activity feed becomes the first projection (lowest-risk proof).

**Alternatives considered.**
- *Classic event-sourcing (fold-on-read).* Rejected: reintroduces projection-lag — the same "screens disagree" defect relabeled — at a per-read cost the $0/no-worker stack can't pay. Time-travel is retained by filtering the log; we just don't pay for it on every read.
- *No event log, mutate tables directly + a separate audit table.* Rejected: two mechanisms drift; the audit table is bypassable and not chain-verifiable.

**Consequences.** (+) One mechanism serves audit, feed, metrics, and the offline seam. (+) Tamper-evident by construction; `verify_chain` is testable. (+) `occurred_at`/`device_id`/`device_seq` make the future PWA a drop-in with zero new schema. (−) Every new write costs ~2× (row + event + hash) and the log grows unbounded (~60–120 MB/season at ~0.5–1 KB/event); mitigated by a `payload` size cap (`CHECK octet_length < 4096`), keeping blobs out by reference, and a years-out cold-archive of closed-season streams retaining the chain head. (−) Requires a single shared hashing util (see ADR-009).

---

## ADR-002 — All writes flow through `SECURITY DEFINER` command RPCs, one per business intent

**Context.** Mutation + event-append must be atomic, or a state change can land with no audit row and a broken hash chain. Free-tier Postgres has no client-side multi-statement transaction across HTTP (two PostgREST calls aren't atomic). **Grounding correction:** migration `20260620150000` revokes INSERT/UPDATE/DELETE from `authenticated` AND locks default privileges, so "grant writes to authenticated" — which several tracks assumed as a fallback — is no longer available. Definer RPCs are the *only* surviving write path.

**Decision.** ~8 Phase-1 `plpgsql SECURITY DEFINER` functions, one per intent (`record_cherry_intake`, `advance_processing_stage`, `create_task`, `set_task_status`, `mark_attendance`, `mint_lot`, `create_green_lot`, `update_plot`), each `GRANT EXECUTE` to `authenticated` only, with a pinned `search_path`. Each writes the domain row AND appends the event in one transaction (transactional-outbox collapsed to a single DB). `record_cherry_intake`/`mint_lot` is the canonical, gap-free, collision-proof lot-code minter (`JC-NNN` via a sequence inside the transaction). Driving port: Server Actions only (React 19/Next 15 idiom, progressive-enhancement, cookie session already wired); Route Handlers reserved for non-HTML outputs (EUDR file download, future webhooks). A Server Action is only ever invoked by an authenticated human submitting a form. Validation is doubled: Zod in the command for friendly errors; SQL `raise`/`CHECK` as the actual enforcement.

**Alternatives considered.**
- *Client-side two-call insert (row, then event).* Rejected: non-atomic over HTTP — the exact defect this phase kills.
- *App-server transaction via a service-role client.* Rejected: a service-role key bypasses RLS and is a standing credential-leak risk; never introduced.
- *Generic single "write" RPC taking a table name.* Rejected: loses intent, can't be individually TDD'd, becomes an injection surface.

**Consequences.** (+) Free atomicity; explicit, independently testable intent; the clean write surface Caps 1/8 need anyway. (+) No agent or inbound text can reach a write path (mirrors the dispatcher "owner not puppet" invariant). (−) ~8 functions to author and test. (−) `SECURITY DEFINER` + pinned `search_path` discipline must be enforced by a static guard test (no CI).

---

## ADR-003 — Derived metrics are live `security_invoker` SQL views; the four hand-authored aggregate tables are dropped

**Context.** `season_summary`/`daily_cherries`/`weekly_harvest`/`variety_shares` are hand-authored aggregate tables — the structural source of the "numbers disagree" defect (e.g. `KpiRow`'s headline and its sparkline read two independently hand-typed tables). The read layer (`src/lib/db/trends.ts` mappers `mapSeason`/`mapTrend`/`mapVarietyShare`) is frozen and must not change.

**Decision (Option C — live views).** Recreate the four aggregates as `security_invoker` views whose **columns match the existing mappers exactly**, computed from `harvests`/`processing_batches`/`green_lots` rows. The TypeScript read layer is untouched (views keep the names the getters already `.from()`). A view *cannot* drift from its inputs — this is the structural kill of the defect. The drop is a **rename-aside**, not a hard `DROP` (one-line rollback). The genuine *input* `target_kg`/price relocates to a 1-row config table (a goal is an input, not a derived number). `ytd_revenue_usd` is the one figure not yet derivable (needs Phase-2 GreenLot sales) — kept honestly sourced and flagged, rendered as "Est. · modeled" in the UI.

**The one exception: COGS earns a materialized view.** Per-lot activity-based cost is a recursive walk down the lot-genealogy graph apportioning labor/processing over green-kg. `mv_lot_cost` refreshes (`REFRESH MATERIALIZED VIEW CONCURRENTLY`) on the same write path that busts its cache tag — served via `security_invoker` functions `cogs_per_lot()`/`cogs_per_plot()`.

**Alternatives considered.**
- *Materialized views for all four.* Rejected: need a refresh job the free tier can't guarantee (no reliable pg_cron; 7-day idle pause), double-store against the 500 MB cap, and a stale refresh **reintroduces the exact defect** the layer exists to kill. At hundreds of rows, live views are sub-millisecond.
- *App-side aggregation in TypeScript.* Rejected: moves truth out of the SSOT, can't be enforced/tested at the data layer, and lets two screens re-implement the same sum differently.

**Consequences.** (+) Numbers reconcile by construction; zero port/UI/test change. (+) RLS respected automatically (`security_invoker`). (−) Recompute on every read (irrelevant at this scale; promote to matview only if a view measures >50 ms — escape hatch reserved, not built). (−) A `metric_*`-namespace lint guard must fail the local gate if any getter `.from()`s an aggregate-shaped name outside the view namespace or a dropped table reappears.

---

## ADR-004 — Modular monolith with ports-and-adapters realized by EXTENDING `src/lib/db/*`, not a new `src/modules/` tree

**Context.** The SSOT intent is ports-and-adapters (dependency inversion, swappable adapter for a future offline phase). The existing read path (`Server Component → src/lib/db/*.ts getter → getSupabase() → PostgREST`, pure `mapX` mappers, frozen domain contract) is already an accidental ports-and-adapters layout, pinned by `getters.test.ts`/`mappers.test.ts`.

**Decision.** The port IS the TypeScript module surface of `src/lib/db/*.ts` (functions returning domain types); the adapter is the Supabase call inside; the contract is `src/lib/types/*`. Each new entity gets one new sibling port file in the existing shape (`Row` interface + pure `mapX` + `cache()`'d getter): `db/{geo,events,lots,greenlots,cogs,eudr}.ts`. The write side is a symmetric twin: `db/commands/*.ts` + `app/(app)/**/actions.ts`. The dependency-inversion *intent* is satisfied by **one enforced rule**, not a folder tree: nothing under `src/app/**` or `src/components/**` may import `getSupabase` or call `.from()`/`.rpc()` directly — enforced by a grep-style guard test (no CI). Bounded contexts (Harvest, Processing, Inventory core; Land, Compliance, Costing supporting) are TS-module + naming boundaries in **one `public` Postgres schema**, with a `_guard.test.ts` that fails if a context reaches into another's tables.

**Alternatives considered.**
- *`src/modules/<m>/{service,adapters}` with ESLint-enforced boundaries.* Rejected: textbook, but churns every import and breaks the frozen tests to buy a boundary a solo $0 app doesn't need.
- *Eight separate Postgres schemas (`land`, `harvest`, …).* Rejected: adds RLS-policy surface, grant complexity, and PostgREST exposure config for zero benefit on a single-tenant read-mostly app, and fights the existing all-`public` `init.sql`.

**Consequences.** (+) Zero churn to the proven read layer; PRs review in slices; new files are disjoint so parallel agents don't serialize. (+) The boundary is testable. (−) The boundary is a convention enforced by a guard test rather than the compiler — acceptable given the test runs in the local gate.

---

## ADR-005 — PostGIS on the free tier: vector geometry in the `extensions` schema, DEM-derived terrain stored as scalars, NO in-DB raster

**Context.** Cap 2 needs canonical plot polygons + the 200-ha reserve + elevation/slope/aspect. The free tier caps Postgres at 500 MB. Supabase managed infra has GDAL drivers disabled (`ST_FromGDALRaster` → "GDAL Drivers Disabled") — `postgis_raster` is both a storage trap and outright broken.

**Decision.** `create extension postgis with schema extensions` (`postgis` only — never `postgis_raster`/`postgis_topology`); installing into `extensions` keeps PostgREST from exposing 1,000+ functions as RPC and matches the repo's `extra_search_path`. Geometry at SRID 4326 as `geometry(MultiPolygon, 4326)` (road/creek splits, multi-part reserve), GiST-indexed, shipped to the client as compact server-computed GeoJSON (`ST_AsGeoJSON`, ~6 dp, ≤60 KB whole-farm) — never WKB, never a client-side PostGIS/Supabase call. Elevation/slope/aspect are derived ONCE at build time from Copernicus GLO-30 (30 m, CC-BY, void-filled) by a local `scripts/derive-terrain.mjs` (`gdaldem`, area-weighted means, aspect via circular mean of sin/cos) and stored as scalar columns; DEM tiles are fetched-and-discarded, never stored. `geom_area_ha` is a generated stored column that reconciles against the frozen `area_ha` scalar; a >5% drift is a data-quality signal (Cap 4), not an error.

**Geometry storage — extend `plots`, not a side table.** *(This ADR resolves the one open contradiction between tracks: System/Domain say columns-on-`plots`; App-Arch said side table.)* **Add the geometry columns to `plots`** + a first-class `reserve_zones` table. Rationale, decisive at this scale: the keystone "one canonical geometry, one schema author, no track forks a `plot_boundaries`/`plot_geometry` table" is the single most-repeated cross-track invariant; a side table is the very fork it warns against. The frozen `PlotRow`/`mapPlot` contract is preserved by **narrowing every existing getter's `select=`** to its current columns (the column-grant discipline the repo already practices) so the heavy `geometry`/DEM columns never enter the daily-read row — capturing the side-table's only real benefit (read-row weight) without a second identity for a plot. 10 plots × a polygon + 6 numbers is single-digit KB; the existence-before-survey concern is met by nullable geometry.

**Alternatives considered.**
- *`postgis_raster` with the DEM in-DB.* Rejected: blows the 500 MB cap alone AND is broken on managed Supabase.
- *Side table `plot_geometry` keyed by `plots.id`.* Rejected as above — forks the canonical geometry and orphans the "one schema author" invariant; its read-weight benefit is recovered by narrowed `select=`.
- *Live DEM/deforestation lookups per request.* Rejected — see ADR-007.

**Consequences.** (+) Vector geometry is free-tier-trivial for 5–10+ years. (+) One canonical geometry; no fork. (−) Every existing `plots` getter must add an explicit narrow `select=` (mechanical, and the repo's known-safe pattern). (−) Terrain is a build-time precompute that must run before the map renders (flagged to Andres).

---

## ADR-006 — MapLibre GL JS is the single sanctioned heavy client dependency, vanilla-wrapped, isolated to two routes

**Context.** The map is the spatial home screen (Cap 3) and must be world-class at 60fps, yet the app's identity is "mostly Server Components, tiny JS bundle." A WebGL vector renderer cannot be hand-rolled.

**Decision.** Pin **`maplibre-gl@^5`** (current line, React-19-ready; resolves the dossier's `^4.7.x` vs `^5.6.0` contradiction in favor of v5), **wrapped manually — no `react-map-gl`** *(this ADR resolves the second cross-track contradiction: Cross-Cutting proposed `react-map-gl ^8`, App-Arch + UI proposed vanilla; vanilla wins — it removes a wrapper dependency, gives direct `feature-state` control, and the bundle isolation holds identically).* Loaded via `next/dynamic(..., { ssr: false })` from exactly one module, with a layout-faithful glass `SkeletonMap` (CLS≈0). Tiles from a keyless/quota-free source (OpenFreeMap, MapTiler free as fallback) — never proxied through Supabase. Map interaction (hover/select/camera) uses MapLibre `feature-state` + paint expressions — GPU repaint inside the canvas, never a React re-render — which is what guarantees 60fps. Glass-over-canvas (ADR-008) and `cooperativeGestures: true`. Everything else stays hand-rolled SVG/CSS: all charts, the lot-genealogy graph (server-computed layout → SVG + a thin pan/zoom island), all tables. **Zero charting/graph/animation libraries** (no recharts/visx/react-flow/cytoscape/chart.js); `elkjs` is a pinned, lazy, server-side escape hatch only if simple DAG layout proves insufficient.

**Alternatives considered.**
- *Leaflet / raster tiles.* Rejected: raster pan is not buttery; no GPU feature-state styling; off-brand.
- *Google Maps / Mapbox GL.* Rejected: billing/quota — violates $0-forever.
- *`react-map-gl` wrapper.* Rejected: an extra dependency and indirection over `feature-state` for no benefit at one map surface.

**Consequences.** (+) One ~210–230 KB lazy chunk on `/map` (+`/lots/[code]` graph route); the rest of the app pays nothing. (+) Full glass + 60fps control. (−) No SSR of the map (correct — MapLibre touches `window`); the skeleton makes the cold path feel instant. (−) A `perf:budget` guard must assert `maplibre-gl` is imported exactly once and the forbidden viz libs are never imported.

---

## ADR-007 — EUDR deforestation check is a precomputed, hash-chained verdict; the DDS is a derived projection that is generated-and-parked, never auto-submitted

**Context.** Cap 7 needs a TRACES-NT Due Diligence Statement: plot polygon + `establishedYear` + a deforestation-free check vs the 31 Dec 2020 baseline. A live raster overlay or per-request satellite API call on a render path is impossible ($0, GDAL disabled, latency, 7-day-pause fragility) and submitting a legal declaration is irreversible and identity-bearing.

**Decision.** A local `tsx` script overlays each `plots.geom` against the JRC Global Forest Cover 2020 GeoTIFF (Panama tile W090N10 — the EU's own legal baseline) using pure-JS `@turf/turf` + `geotiff.js` (no GDAL), folds in a GFW tree-cover-loss read as a **secondary corroboration column** (never the primary verdict), and writes a signed, hash-chained `deforestation_checks` ledger row (same substrate as ADR-001), denormalizing the latest verdict to `plots.eudr_status`. The check pins its inputs (geometry version, baseline dataset+version, observation date) for reproducibility, keyed so a re-drawn polygon yields a new verdict. `established_year ≤ 2020` is a deterministic server-run establishment test inside every check (a post-2020 plot is presumptively non-compliant regardless of satellite data) behind a `DeforestationOracle` port — Phase-1 ships an establishment-only adapter; GFW/JRC drops in without reshaping. The DDS is assembled from `plots` + green-lot genealogy + `deforestation_checks` and minted **only** via `issue_dds()` `SECURITY DEFINER` RPC that gates on passing checks for every covered plot, freezes a snapshot, computes a `payload_hash`, and emits a `DDS_ISSUED` event — all in one transaction (the UI's disabled button is courtesy; the gate is in the DB). **v1 is generate + park + manual submit.** Auto-POST to the TRACES API is a flagged future upgrade (needs an EU operator account + EORI; Janson's binding date is mid-2027 SME tier — runway confirmed). JRC tiles live off-DB, never in the 500 MB Postgres.

**Alternatives considered.**
- *Live raster overlay / per-request API.* Rejected: $0/GDAL/latency/pause-fragility, and re-runs a yearly-changing computation on every render.
- *A `plots.deforestation_free` boolean.* Rejected: an honor-system flag with no provenance; the verdict must be a snapshotted, reproducible, hash-chained check.
- *Auto-submit the DDS.* Rejected: a legal attestation is exactly the irreversible, identity-bearing action that must wait for explicit human action — never auto-fire.

**Consequences.** (+) Deterministic, testable, $0, GDAL-independent; the runtime app is a pure projection (buttery UI). (+) Dual-source (JRC primary + GFW corroboration) is the right risk posture. (−) Verdicts are as fresh as the last script run (correct — polygons change yearly, not per-request). (−) Shares the hashing util (ADR-009); a `compliance-no-honor-flag` guard must ban settable compliance booleans and direct `deforestation_checks`/`dds` inserts.

---

## ADR-008 — Liquid glass over a live WebGL canvas: blur a static veil, never the live pixels, and drop blur entirely during gestures

**Context.** World-class UI is the #1 quality attribute. "Apple-grade frosted glass on the map" and "buttery 60fps pan" appear to conflict: `backdrop-filter` sampling a per-frame WebGL output is the classic jank/iOS-Safari-weakness trap. Two tracks proposed different mechanisms; they must be unified.

**Decision.** Three coordinated mechanisms, all required: (1) the map canvas sits on its own GPU compositor layer (`transform: translateZ(0)`, `isolation: isolate`, `contain: layout paint size`, reserved intrinsic size → zero CLS); (2) a static, cached, non-interactive gradient veil (`.glass-scrim`) is painted over the map edges where chrome lives, and floating overlays (`blur(14–20px) saturate(1.4)`) sit above this veil so the expensive `backdrop-filter` samples the *static scrim*, not the per-frame canvas; (3) on `movestart`/drag-start, JS sets `.is-panning`/`data-mapmoving` on the map root and CSS drops every overlay's `backdrop-filter` to `none` (swapping to a more-opaque background) for the gesture's duration, restored on debounced `moveend`. Camera moves are configured, never hand-tweened (MapLibre owns its rAF; `flyTo`/`easeTo` at 650ms `ease-inout`; no opening fly-in — `fitBounds` `duration: 0` — so free-tier OSM tiles arrive before the camera lands). Where a trust-number's legibility conflicts with glass translucency, **the number wins**: grade/COGS/verdict values render on a forest-tinted solid AA token, not over blur. Foreground tokens are certified against a pinned worst-case composited background (contrast-floor tokens + a hard-gating `contrast.ts` test at ≥4.5:1 text / ≥3:1 non-text-and-focus), not pure white.

**Alternatives considered.**
- *Naive live `backdrop-filter` over the moving canvas.* Rejected: jank, especially iOS Safari.
- *No blur on the map (flat overlays).* Rejected: flat and off-brand.
- *Raise card opacity globally to guarantee contrast.* Rejected: kills the liquid-glass translucency; the pinned-floor certification keeps translucency AND passes AA.

**Consequences.** (+) The only path that holds both 60fps and the frosted aesthetic, on the iPad-class hardware a farm office uses. (−) JS choreography (the `is-panning` flag) and a small contrast util + token-floor tests (wanted anyway as the enforcement the current honor-system lacks). (−) The load-bearing `button.tsx` `focus-visible:ring-forest-100` bug (~1.1:1, fails WCAG 2.4.11) must be replaced with the two-tone `.focus-ring`.

---

## ADR-009 — `farm_id` + one RLS policy factory now (multi-tenant-ready), switching deferred; single shared hashing util; one serialized schema-author lane

**Context.** The app is single-owner authenticated-only today (ADR grounding). A future multi-estate is plausible. Retrofitting tenancy later means a backfill + rewriting every RLS predicate + cross-leak re-testing. Three tracks independently proposed the same migration filename (`20260621090000`) — a real collision under the one-schema-author rule — and two consumers (event-log, EUDR-verdict) each need the same hash chain.

**Decision (multi-tenant readiness).** Add `farm_id uuid NOT NULL` to every business row now, defaulted to one seeded `farms` row (`janson`); build the column + predicate, **not** tenant switching. `farm_id` is an RLS-predicate column + index, **never** part of a composite PK (the TradelyHQ composite-FK delete-trap lesson). Replace per-table hand-written policies with one factory `app.apply_farm_rls(tbl)` (the `do $$`/`foreach` idiom the existing migrations use) stamping: authenticated READ filtered by `app.current_farm_id()` + owner/operator-only WRITE via definer RPCs. `app.current_farm_id()` **coalesces to the sole farm** when no JWT claim is present, so today's plain authenticated owner session works with zero JWT plumbing; the claim path is dormant until multi-tenant is switched on. `force row level security` everywhere (required for the event-log immutability guarantee). New objects grant SELECT to `authenticated` only (per the corrected baseline; anon stays fully revoked).

**Decision (shared util + lane).** One canonical hashing util shared by the event-log and EUDR-verdict consumers — owned by one cross-cutting author, never forked. The five Phase-1 migrations are one serialized single-author lane, timestamps strictly above `20260620150000` (the corrected prod max), sequenced by dependency: M1 `…090000` PostGIS+geometry → M2 `…091000` tenancy+security factory → M3 `…092000` event_log+units+lot_graph+command RPCs → M4 `…093000` derived-metrics (rename-aside the 4 aggregates) → M5 `…094000` EUDR+outbound. App-code work fans out file-disjoint in parallel, closed by a reviewer pass. Migrations touching `create extension`, RLS re-stamp, and the rename-asides flag for explicit apply-OK before running (even with no CI). DR is honest: no free-tier PITR → schema SSOT is the migration files, structured-data DR is a nightly local `pg_dump --format=custom` (launchd, not GitHub Actions) + the hash-chained log as a replayable journal + a `<7-day` keep-warm ping (the critical idle-pause control).

**Alternatives considered.**
- *Single-tenant now, retrofit `farm_id` when needed.* Rejected: ~20 cheap lines now vs an expensive, leak-prone 18-table RLS retrofit + re-test later.
- *`farm_id` in composite PKs for hard isolation.* Rejected: the composite-FK delete-trap; simple PKs stay simple, isolation is the RLS predicate.
- *Per-consumer hashing implementations.* Rejected: two implementations drift and break chain-verification across the event-log/EUDR boundary.

**Consequences.** (+) Multi-tenant is a switch (populate the claim), not a migration. (+) Today's session works with zero JWT plumbing (the coalesce). (+) Collision resolved; one author owns schema serially. (−) Every table carries an indexed `farm_id` and goes through the factory. (−) The `force RLS` ⇄ backup-role interaction (the dump must run as a role that can read all farms) and the backup scheduler choice (launchd vs free hosted cron) need Andres's call before `scripts/backup.sh` is specced (flagged).

---

## Cross-ADR flags (for Andres / other tracks)

1. **Two grounding corrections the tracks missed:** migration head is now **`20260620150000_grant_hygiene.sql`** (proposed migrations sort above it), and it **revokes writes from `authenticated` AND locks default privileges** — which is why ADR-002's definer-RPC write path is *forced*, not merely preferred.
2. **Two contradictions resolved by these ADRs:** geometry storage → **columns on `plots`** (ADR-005, not a side table); MapLibre wrapper → **vanilla, no `react-map-gl`** (ADR-006).
3. **Explicit apply-OK needed** for M1/M2/M4/M5 (extension, RLS re-stamp, rename-asides) and the backup-role/scheduler decision (ADR-009).
4. **`green_lots` PK type/name** is owned by the GreenLot track; `dds_submissions.green_lot_id` and graph green nodes reference it un-FK'd until pinned. `ytd_revenue_usd` derivability also waits on that track (ADR-003).
5. **Yield-loss tolerance** (~16–20% washed green-from-cherry) and SCA grade thresholds are agronomy-track placeholders feeding ADR-001's mass-conservation invariant.

**ADR set written by the ADR Author track from the five consolidated DESIGN sections; grounded against `/Users/andres/coffee-farm-operations/supabase/migrations/{20260620120000_init,20260620140000_auth_required_rls,20260620150000_grant_hygiene}.sql` and `/Users/andres/coffee-farm-operations/CLAUDE.md`.**

## §4 — UI/UX Design Critique (adversarial — the world-class-UI gate)

I have full grounding. The KPI row confirms the trust-defect example (`SEASON.todayKg` from one source, sparkline from `dailyCherries` — two independent reads). I'm ready to deliver the adversarial UI critique.

---

# UI CRITIC — Adversarial Review of the World-Class UI/UX Track + Overall Design

I verified every load-bearing claim against the live repo. The track is unusually strong — but "strong on paper" is exactly where world-class UI dies. Below are the places this design would still ship GENERIC, FLAT, JANKY, INACCESSIBLE, or merely good-not-great, ordered by severity. Each is grounded in what I actually read.

## CRITICAL — these will visibly break the "Apple-grade" claim

### C1. The lot-genealogy graph is the single highest-risk surface and the design under-commits it to "SVG ribbons"
**Screen:** `/lots/[code]` `<LotLineage>` / `GenealogyGraph`.
**Why it falls short:** Every fragment hand-waves "Sugiyama-lite / layered-DAG → SVG, mass-proportional Bézier ribbons." That is the hard part, stated as if it were the easy part. A naive layered layout on a real blend (N parents → 1 child, then a split → 2 children) produces **edge crossings, overlapping ribbons, and label collisions** — the exact "spaghetti" that makes graphs look amateur. Stripe/Linear-grade means *zero crossings where avoidable, deterministic column packing, and ribbons that never overlap a node*. None of the fragments specify crossing-minimization (the median heuristic), ribbon-to-ribbon vertical ordering at a node (so a 300kg and 180kg ribbon don't braid), or label-collision avoidance. "Mass ∝ stroke-width" with no minimum/maximum clamp means a 5kg sample edge becomes a 0.3px invisible hair and a 1000kg edge becomes a 40px blob that swallows its node.
**Concrete fix:** Specify the layout algorithm precisely: (1) longest-path layering for column assignment; (2) one-sided median crossing-reduction sweep (it's ~30 lines, deterministic, testable); (3) ribbon width = `clamp(2px, k·√kg, 28px)` (sqrt so the dynamic range compresses; clamps so nothing vanishes or dominates); (4) order ribbons at each node by mass so they nest cleanly; (5) a real layout-correctness test (no two node boxes overlap; no ribbon passes through a non-endpoint node's bbox). Until the layout function has a fixture test asserting **zero node-overlaps and bounded crossings on a split-then-blend graph**, this surface is not designed — it's hoped-for.

### C2. The map's "glass over a moving canvas" plan (D7) is correct in theory but will still jank on the first paint and on tile load
**Screen:** `/map` / `FarmMap`.
**Why it falls short:** D7's three mechanisms (static scrim veil, drop blur on `is-panning`, isolated compositor layer) are genuinely the right architecture — but they only cover *drag*. Three jank vectors remain unaddressed: (a) **zoom via trackpad/pinch** fires `move` continuously without always firing `movestart`/`dragstart` cleanly — the blur-kill must hook `zoom`/`pitch`/`rotate` too, or every scroll-zoom over a frosted overlay stutters; (b) **tile arrival repaint** — when OSM/OpenFreeMap tiles stream in behind a `backdrop-filter` overlay, each tile paint re-samples the blur; the scrim veil helps only if overlays sample the *scrim* and never the canvas, which requires the scrim to be a real opaque-enough layer, not a gradient that lets canvas pixels bleed through; (c) **the initial `fitBounds duration:0`** still triggers a synchronous layout + first WebGL paint that can drop frames on an iPad. 
**Concrete fix:** Bind the blur-kill to the union `movestart zoomstart pitchstart rotatestart dragstart` → add `.is-interacting`; restore on the debounced `idle` event (not `moveend` — `idle` is the only event that means "tiles settled, safe to re-blur"). Make `.glass-scrim` opaque enough (≥0.6 alpha floor) that overlays above it never sample live canvas. Gate the overlay chrome behind the map's `load` event with a glass skeleton so chrome fades in *after* first paint, never competing with it.

### C3. WCAG-AA-on-glass is asserted but the enforcement is against a *guessed* worst-case background, and the map breaks it entirely
**Screen:** map labels, plot-status pills over the map canvas, KPI cards over the aurora.
**Why it falls short:** D15 certifies foreground tokens against "the darkest the aurora can composite." But the aurora is **three animated radial-gradient blobs that drift and overlap** (verified: `aurora-1/2/3` with forest, coffee, and honey gradients animating 26–38s). The composited background under a card is *not static* — it's a moving field where two blobs can briefly stack to a darker value than either alone. A single pinned "worst-case" constant is a guess that the animation can violate mid-drift. Worse: **on the map, there is no card** — labels and pills sit over live satellite/vector tiles whose color is unknowable (a dark forest polygon vs. a bright clearing). Text-on-translucency over arbitrary map pixels is the single most common way "frosted glass" maps fail AA.
**Concrete fix:** (1) For map labels/pills, **mandate an opaque inner chip** (the design says this for verdict pills — make it universal and testable: no text token may render directly on `.glass-overlay`/`.glass-map` without an opaque backing element). (2) For the aurora, compute the worst-case by actually sampling the max overlap of the three gradients at their animation extremes, not a hand-picked constant — or, simpler and more honest, **cap aurora opacity under content regions** with a `radial-gradient` mask so cards always sit over a known floor. (3) Add a test that renders a card at 3–4 aurora keyframe positions and asserts the floor holds — a single static check is theater.

### C4. The dashboard's #1 trust defect is "fixed" in SQL but the UI still presents it as authoritative with no honesty about freshness/derivation latency
**Screen:** `/` dashboard, `kpi-row.tsx`, `season-hero.tsx`.
**Why it falls short:** I verified the actual defect: `kpi-row.tsx` does `const [workers, batches, dailyCherries, SEASON] = await Promise.all(...)` — `SEASON.todayKg` and the sparkline from `dailyCherries` are **two independent reads** that can disagree. The semantic-layer fix (views) makes them reconcile *server-side*. Good. But the UI track's "Live · derived" chip (D30) and "provenance-on-hover" (System track) are **decorative trust theater** unless they show something falsifiable. A chip that always says "Live · derived" is noise within a week. And the System track promises `ytd_revenue_usd` renders as "Est. revenue · modeled" — but a *modeled* number sitting in the hero KPI row at the same visual weight as a *measured* harvest-kg number is itself a trust defect: the eye reads them as equally hard.
**Concrete fix:** Make derivation *visible and differentiated by weight*, not by a uniform chip. Measured figures (harvested_kg) get full visual weight; modeled/estimated figures (revenue) get a visually-distinct treatment — lighter ink, a dotted underline, an explicit "est." prefix in the readout itself, never just a hover tooltip (hover doesn't exist on touch — the farm office iPad never sees it). The provenance hover must carry a real timestamp + row count ("derived from 47 harvests · 14:03") or it's worse than nothing.

## HIGH — would read as "good-not-great" / flat

### H1. The chart system is hand-rolled SVG (correct call) but the new chart types are listed as names, not specs — and SVG charts default to flat
**Screen:** `/costing` (`CostWaterfall`, `MarginBar`), `/inventory` (`ScoreSpider`), compliance gauges.
**Why it falls short:** The existing `Donut` is genuinely world-class — I read it: per-instance collision-safe `<defs>` UIDs, recessed track gradient, inner-shadow groove, specular gloss, outer glow, full `aria-label`. That is the *bar*. The track lists 8 new chart primitives (`CostWaterfall`, `ScoreSpider`, `GaugeArc`, etc.) as a table of names with no commitment that each gets the same depth treatment. A `CostWaterfall` rendered as flat rectangles next to that `Donut` will look like a different, cheaper app. `ScoreSpider` (SCA radar) is the trap — radar charts are the single ugliest default chart type; a flat polygon on gridlines screams "matplotlib."
**Concrete fix:** Mandate that every new chart inherits the `Donut` material contract explicitly: recessed track/grid + inner shadow, specular gloss `<defs>`, content-hashed UID, `currentColor`/token theming, the visually-hidden data table. For `ScoreSpider`: glass-filled polygon with a gradient fill (not a flat stroke), gloss highlight on the upper edge, dot vertices that catch light. Write one "chart material" snapshot/render test that asserts each new chart emits the gloss+groove `<defs>` (the same way `Donut` does) — so "world-class" is enforced, not aspirational.

### H2. The mobile experience is being *invented from scratch* under the world-class bar, with the least design detail
**Screen:** everything below 768px — bottom tab bar, `NavSheet`, `CaptureSheet`.
**Why it falls short:** I confirmed the sidebar is `hidden md:flex` with **zero** mobile navigation — below 768px the app currently has no nav at all (D22's "flag loudly" is correct). So the entire mobile chrome is net-new, and net-new under a world-class bar is where corners get cut. The bottom tab bar is specified as "4 primary + More sheet" but: (a) no spec for the **active-tab indicator** (a flat color swap is generic; Apple-grade is a sliding pill or a morphing glass highlight); (b) no spec for **safe-area + keyboard interaction** — when the `CaptureSheet` `NumberPad` is open, the bottom nav must not collide with it; (c) the `CaptureSheet` is described as "bottom-sheet mobile" but bottom sheets that don't support **drag-to-dismiss with rubber-banding** feel like web, not native. The farm's actual device is an iPad/phone in the field — this is the *most-used* surface and it's the *least-designed*.
**Concrete fix:** Treat mobile as a first-class design deliverable with its own gated review, not a `md:hidden` afterthought. Specify: a GPU-transform sliding active indicator on the tab bar; the bottom sheet uses a transform-driven drag handle with a velocity-based dismiss threshold; the nav hides (translateY out) when a capture sheet opens; `env(safe-area-inset-bottom)` padding is non-negotiable. Build one reference mobile screen to the Apple bar *first* and make it the template.

### H3. Loading/skeleton story is "instant glass skeleton" but the free-tier cold-start (DB waking, up to several seconds) will sit on a skeleton long enough to feel broken
**Screen:** every route after a 7-day idle pause, first load.
**Why it falls short:** The design correctly identifies the 7-day pause and adds `<WarmingHint>` after 1.2s (D20). But a skeleton shimmer that runs for 3–5 seconds while the DB wakes reads as *hung*, not *loading* — shimmer animation implies "milliseconds away." This is the gap between "instant glass skeleton" (the promise) and "free-tier reality" (the constraint). The two tracks haven't reconciled: the UI track says instant; the platform track says cold-start can be seconds.
**Concrete fix:** Stage the skeleton: 0–1.2s pure shimmer skeleton (implies fast); >1.2s the shimmer slows and the `<WarmingHint>` glass pill rises in ("Waking the farm records…") with a calm indeterminate progress, *changing the motion character* so the user reads "working, not stuck." This is a real UX state, not a 1-line hint bolted on. The heartbeat (D13) makes cold-start rare, but "rare and ugly" still fails the bar — design the wake state as a first-class screen.

### H4. Focus, touch, and viewport bugs are correctly flagged but two are still under-fixed
**Screen:** all buttons, all inputs.
**Why it falls short:** I verified all three bugs are real: `button.tsx` ships `focus-visible:ring-forest-100` (~1.1:1 on the forest fill — invisible focus ring, a WCAG 2.4.11 failure), topbar input is `text-sm` (14px → iOS auto-zoom), layout is `min-h-screen` (not `dvh`). The fixes (D17 two-tone ring, D23 16px inputs / dvh) are correct. **But** D17's `.focus-ring` is specified as one ring for "both light glass and dark map" — a single ring style that works on `#faf7f1` paper *and* on a dark satellite map is very hard; the two-tone (dark core + light halo) is the right idea but needs a *third* consideration: the forest sidebar (`glass-forest`, near-black). One ring across three radically different backgrounds usually means it's mediocre on all three.
**Concrete fix:** Verify the two-tone ring's 3:1 contrast against all three pinned backgrounds (paper, forest-near-black, arbitrary map) — the light halo carries it on dark, the dark core carries it on light; test all three, not "both." Also: the dead topbar search isn't just an iOS-zoom bug — **it's a no-op input that does nothing when clicked** (verified: no form, no handler). A search box that looks interactive and does nothing is a worse trust signal than no search box. D26 (command palette) fixes this — make that dependency explicit and ship them together or remove the input until the palette lands.

## MEDIUM — polish gaps that separate great from world-class

### M1. Motion vocabulary is tokenized (D13) but the reduced-motion story for information-bearing motion is incomplete.
The global `prefers-reduced-motion` kill-switch zeroes *all* durations (verified). D14 says info-bearing motion must "land in final state." But the graph's edge-draw animation (`stroke-dashoffset`) under reduced-motion at `0.001ms` *will* land drawn — fine. The risk is the **map camera**: `flyTo` is MapLibre's own rAF, *not* CSS, so the CSS reduced-motion rule doesn't touch it. D8 says no fly-in on load (good) but interaction-triggered `flyTo` (clicking a plot pin) will still animate the camera for a reduced-motion user. **Fix:** read `prefers-reduced-motion` in JS and pass `duration: 0` to all `flyTo`/`easeTo` calls when set — CSS can't reach MapLibre.

### M2. The "Live · derived" honesty applies to dashboards but the lot passport / EUDR DDS are *legal* artifacts where visual trust matters more, and they're under-specified visually.
The Lot Passport (hash-chain "verified sheen") and the EUDR DDS PDF are buyer/auditor-facing — arguably the surfaces where "world-class" pays the actual business premium (provenance IS the product, per Cross-Cutting D1). The hash-chain rendered as "a subtle verified sheen" is too subtle for a legal trust artifact — an auditor needs to *see* the chain is intact, not feel a glow. **Fix:** the verified state needs an explicit, legible badge (icon + "Chain verified · N events" + the short hash), not just a sheen. The print PDF especially — sheens don't print; a PDF DDS needs hard, legible verification marks.

### M3. Empty states are listed (`ChartEmpty`, `EmptyState` exists) but the *first-run* empty farm — before any harvest is captured — has no designed narrative.
A brand-new screen with no data, showing 8 empty glass cards, looks broken, not elegant. The field-capture surface (`CaptureSheet`) is the entry point; the empty dashboard should *route to it* ("No harvests yet — record today's intake"), not just render `ChartEmpty` × 8.

### M4. `data-table` → `ResponsiveTable` collapse-to-cards (D24) is the right call, but dense tables (COGS, GreenLot inventory) with many numeric columns become tall stacked cards on mobile — scrolling 40 lot-cards to compare cost-per-kg is worse than a horizontal scroll.
**Fix:** for genuinely comparative numeric tables, the mobile pattern should be a *frozen-first-column horizontal scroll within a contained glass viewport* OR a sort-and-summarize card, not a naive 1-card-per-row stack. Specify per-table which pattern (the `priority` column metadata helps, but the comparison use-case needs an explicit decision).

---

## The 5 highest-leverage moves to make this system unmistakably world-class

1. **Build the lot-genealogy graph layout to a real spec with crossing-minimization, mass-clamped ribbons, and a layout-correctness test (C1).** It is the signature, never-seen-before surface that proves "provenance is the product." Done flat, it sinks the whole app's credibility; done right, it's the screenshot that sells the farm's coffee. This is the one surface where the design currently under-commits the most relative to its visibility.

2. **Make the map's glass-over-canvas bulletproof by binding blur-kill to the full interaction event set and restoring only on `idle`, with an opaque-floor scrim (C2/C3).** The map is the home screen (D27 / spatial-home). If the map janks on zoom or its labels fail AA over bright tiles, the *first thing every user sees* fails the bar. Get this one surface buttery and legible and the "Apple-grade" claim becomes believable everywhere.

3. **Promote every new chart to the existing `Donut` material contract and enforce it with a test (H1).** The repo already contains a world-class chart; the risk is regression-to-flat on the 8 new ones. One enforced "chart material" test (asserts gloss+groove `<defs>`) guarantees the costing/inventory/compliance screens look like the same premium app, not a bolted-on analytics dashboard.

4. **Treat mobile/field-capture as a first-class, separately-gated design deliverable — build one reference screen to the Apple bar before fanning out (H2).** It's net-new, it's the most-used surface (field workers on phones/iPads), and it's currently the least-specified. A draggable rubber-banding bottom sheet, a sliding glass tab indicator, and safe-area discipline are the difference between "native-feeling" and "a website on a phone."

5. **Make trust *visible and differentiated*, not decorative — measured vs. modeled figures must look different, and the cold-start wake must be a designed state (C4/H3/M2).** The entire reason this rebuild exists is trust. A uniform "Live · derived" chip and a never-changing shimmer are trust theater. Differentiate measured from estimated by visual weight (not hover, which touch never sees), stage the cold-start skeleton → warming state so the free-tier pause never reads as "broken," and give the legal artifacts (passport, DDS) hard legible verification marks. World-class here means the UI *earns* belief, which is the product's actual premium.

**Net verdict:** The architecture is sound and the reuse discipline is excellent — this is not a generic design. The danger is concentrated in five surfaces where the spec says "SVG ribbons / glass overlay / new chart / mobile sheet / trust chip" as if naming them designs them. Those five are precisely the never-before-built, highest-visibility surfaces. Close those and the system is genuinely Apple/Linear/Stripe-grade; leave them as-named and it ships as "very good Tailwind app," which is the failure mode the owner explicitly rejects.

## §5 — Architecture Critique (adversarial — quality attributes, $0 envelope, risks)

Grounding complete. I have what I need. Here is the adversarial critique.

---

# ARCHITECTURE CRITIC — Phase-1 SPINE, adversarial review

The design is strong, internally coherent across five tracks, and mostly grounded. But it rests on a stale ground-truth that all five fragments inherited from each other, and it has three correctness gaps that would let the "two screens disagree" defect back in through a side door. Findings by severity, each with a fix.

## CRITICAL

**C1 — The "§0 correction" is itself stale. There is a THIRD migration the entire brief missed: `20260620150000_grant_hygiene.sql`.**
The System/Infra track makes a whole load-bearing show of "correcting" every fragment from `120000` to `140000` as the schema head, calling it "load-bearing" and re-sequencing all five new migrations to sort above `20260620140000`. But the real head is **`20260620150000_grant_hygiene.sql`** (verified on disk). Consequences that break the design as written:
- **M1 (`20260621090000`) is fine** (sorts above `150000`), so the timestamp collision claim survives by luck — but the *stated reason* ("current head is 140000") is wrong, and any agent that trusts the brief and picks a `20260620145000`-style timestamp (between the two it knows about) silently lands **before** the real head.
- **The grant-hygiene migration actively fights D2/D3/D18.** It runs `alter default privileges in schema public revoke insert, update, delete on tables from anon, authenticated` AND `revoke insert,update,delete ... from anon, authenticated`. So when the command RPCs (D3) and `event_log` land, the `SECURITY DEFINER` functions work (definer runs as table owner, bypassing the revoke) — *but only if the migration explicitly `grant execute ... to authenticated` on each function*. None of the five migration specs mention `grant execute`. With stock Supabase defaults plus this hygiene migration, a freshly-created function may not be callable by `authenticated` at all, or worse, `alter default privileges` for *functions* hasn't been locked so it's inconsistent. **Every write path in the design is gated by a revoke the brief never accounts for.**
**Fix:** Re-baseline the entire migration sequence on `20260620150000`. Every new migration that creates an RPC must end with `grant execute on function <fn> to authenticated` and `alter default privileges ... grant execute on functions to authenticated` is NOT desired (keep it explicit per-function, fail-closed). Add a static guard test: "every `SECURITY DEFINER` function has an explicit `grant execute to authenticated` and base tables have no write grant." This is also the regression test C1 demands.

**C2 — `security_invoker` views + the grant-hygiene posture = the semantic layer returns ZERO rows, silently.**
This is the highest-impact correctness bug and it hides until runtime. The new `v_metric_*` views are specified `security_invoker=on` (correct for RLS). But `20260620150000` revoked grants and locked `alter default privileges` so that **new tables/views get NO grant to `authenticated`**. The existing init migration's final `grant select on all tables ... to authenticated` ran *before* these views existed. So a newly-created `v_metric_season` view, under `security_invoker`, with no SELECT grant to `authenticated`, returns a permission error — or if the getter swallows it, an empty result. The dashboard would render **zeros**, not wrong-but-plausible numbers — arguably worse, because a green-looking deploy ships a dead dashboard. The fragments assume "views inherit the public grant"; the hygiene migration **specifically broke that inheritance** as a security feature. None of D4/D9/D12/D-MET-1 accounts for it.
**Fix:** Every migration that creates a view or table MUST explicitly `grant select on <obj> to authenticated`. Add this to the M2 RLS factory (`app.apply_farm_rls` should also stamp the SELECT grant) and to the demote-aggregates migration. Add a smoke test that runs `getSeason()/getVarietyShares()` against a seeded DB and asserts non-empty — the brief's "assert getSeason() equals hand-summed fixture" test will catch this **only if it runs against a real grant-applied DB**, which leads to C3.

**C3 — The test substrate cannot execute the one thing the whole design hinges on: PostgREST + RLS + grants.**
The cross-cutting track pins **PGlite** as the SQL/RLS test substrate and claims it tests "RLS matrix… real Postgres where the spine's trust lives." Two problems:
1. **Docker is absent (verified: `NO DOCKER`), so the real Supabase stack is unavailable** — agreed, PGlite is the only option. But PGlite is raw Postgres. **It has no PostgREST, no `anon`/`authenticated` roles, no GoTrue JWT, and no Supabase grant model.** The RLS tests the brief promises ("anon cannot read, non-owner cannot write, second-farm row invisible") require those roles and a JWT-claim `current_setting('request.jwt.claims')`. You *can* simulate this in PGlite by manually `create role authenticated; set role authenticated; select set_config('request.jwt.claims', ...)` — but the brief never says so, and **C1/C2 (the grant/default-privileges interaction) are precisely the layer PGlite does NOT model** because the Supabase grant defaults aren't present in a bare PGlite instance. So the exact bugs C1 and C2 would pass green in PGlite and fail on prod.
2. **PGlite's PostGIS support is partial.** The fragment claims "Postgres 17 WASM + `postgis` contrib." PGlite's PostGIS extension is real but limited; `ST_Area(geom::geography)` (used for the D11 generated `geom_area_ha` column and D10 area reconciliation) and `ST_AsGeoJSON` precision behavior are the kind of geography-cast operations that have historically been incomplete in WASM builds. If the generated column's expression doesn't run in PGlite, the geometry migration can't even be loaded in the test, so M1 ships untested.
**Fix:** (a) Explicitly script the role/JWT simulation in the PGlite harness and seed the Supabase grant defaults into the test DB before loading migrations, so C1/C2 are reproducible in-test. (b) Verify `@electric-sql/pglite` + `postgis` actually executes `geom::geography` area casts **before** committing to it as the M1 test substrate — flag a fallback (run M1's geometry tests against the on-demand `supabase start` smoke only, accepting that one migration's geo-math isn't covered by the fast loop). This is a spike, not an assumption.

## HIGH

**H1 — `force-dynamic` is on the `(app)/layout.tsx`, and dropping it (D5) collides head-on with the 7-day pause mitigation.**
Verified: `src/app/(app)/layout.tsx` has `export const dynamic = "force-dynamic"`, and `error.tsx` documents reliance on it. D5 proposes dropping it and caching derived reads with `unstable_cache` + `revalidateTag`, arguing the data cache "survives the idle-pause so a cold farm loads metrics from cache." **This is wrong on Vercel's free (Hobby) tier and on a paused Supabase combined.** `unstable_cache` persistence depends on the deployment's Data Cache; on a cold serverless invocation after the project has been idle, there is no guarantee the cache entry is warm, and more importantly **the cache doesn't help the *first* read that must wake the DB** — D13's heartbeat is what keeps the DB warm, and if the heartbeat works the cache-survives-pause argument is moot; if it fails, the cache is stale and the first real user still hits a paused DB. The two mitigations are presented as independent but are actually the same single point of failure (the heartbeat). Also: `unstable_cache` is being renamed/superseded by `use cache` in Next 15/16 — pinning a deprecated API as the caching SSOT is a maintainability risk on a "$0 forever / pin versions" project.
**Fix:** Keep `force-dynamic` for Phase-1. The derived views over hundreds of rows are sub-millisecond (the brief's own D12 argument) — caching them buys nothing and adds a `revalidateTag` invalidation burden on every write path that, if forgotten, **reintroduces the exact stale-number defect the semantic layer exists to kill.** The honest design is: dynamic reads + the heartbeat (D13) as the *sole* pause mitigation, and drop the "cache survives pause" claim entirely. Revisit caching only if a measured route exceeds budget.

**H2 — Domain-Model and System/Infra tracks ship CONTRADICTORY migration sequences and table names; "one schema author" is asserted but two authors already diverged.**
The brief is two parallel designs wearing one cover:
- System/Infra: migrations `20260621090000–094000`; event table `event_log`; graph tables `lot_nodes`/`lot_edges`; UUIDv7 PKs on graph nodes; geometry on `plots` AND a `reserve_zones` table; `farm_id` everywhere.
- Domain-Model: migrations `20260620150000–190000` (which now **collide with the real grant-hygiene migration** — `20260620150000` is taken!); event table `lot_event`; graph reuses `lots(code)` as node PK with NO separate node table; edge kinds `split|merge|blend|process`; `protected_areas` not `reserve_zones`; NO `farm_id` mentioned.
- App-Arch: a THIRD sequence `20260621100000–120000`; event table `events`; `lot_edges(parent_code, child_code)`; `protected_areas`.

These are not reconcilable by a reviewer pass — they're three incompatible schemas. The Domain-Model sequence **literally reuses the grant-hygiene timestamp** (`20260620150000`), which is a hard collision, not a near-miss. The "one schema author at a time" rule was stated by every track and honored by none.
**Fix:** Before any migration is written, one schema author must produce a single canonical sequence. Recommend: System/Infra's `farm_id`-everywhere + `reserve_zones` + UUIDv7-event-PK posture (it's the most future-proof and the only one that addresses multi-tenant), BUT adopt Domain-Model's decision to reuse `lots(code)` as the lot-graph node PK (App-Arch and Domain-Model both chose this; it preserves the existing `harvests.lot_code`/`processing_batches.lot_code` FKs — System/Infra's separate `lot_nodes` table orphans those FKs, a real regression). Resolve the event-table name to ONE (`event_log`). All on timestamps strictly above `20260620150000`.

**H3 — `farm_id NOT NULL` + the RLS factory writes through a posture the app's auth can't satisfy yet.**
D17/D18 add `farm_id uuid NOT NULL` to every table and an `app.can_write()` reading an `app_role` JWT claim. But the verified `server.ts` uses the **anon key with a cookie session** — there is no custom JWT claim plumbing, no `app_role`, no Auth Hook. D18 says `app.current_farm_id()` "coalesces to the sole farm when no claim is present" — fine for reads. But the WRITE policies (`app.can_write()` reads `app_role`) will **fail closed for the only user who exists today** (the owner has no `app_role` claim), so the new capture forms (D29) and command RPCs can't write until the Auth-hook track ships. The brief flags this to the "Auth/edge-gateway track" as future, but **Phase-1 includes field capture (Capability-adjacent, D29 CaptureSheet, D3 command RPCs)** — so Phase-1 has a write surface gated on a claim Phase-1 doesn't issue.
**Fix:** For Phase-1, `app.can_write()` must also coalesce: if no `app_role` claim is present, treat an authenticated session as the owner (single-user app). Gate the strict claim check behind the same dormant multi-tenant switch as `current_farm_id()`. Otherwise the capture forms are dead on arrival. Add an RLS fixture test: "authenticated session with no app_role claim CAN execute the command RPC" — this would fail on the design as written.

## MEDIUM

**M-1 — MapLibre version contradiction is "resolved" to a combination that may not exist as claimed.** Cross-cutting locks `maplibre-gl ^5.6.0` + `react-map-gl ^8`, while App-Arch/UI tracks say "vanilla MapLibre, NO react-map-gl" (D6 in two tracks). That's a direct contradiction the consolidation didn't catch (one track adds the `react-map-gl` dep, two forbid it). Given the "tiny bundle / no needless deps" constraint and React 19, **vanilla MapLibre wins** — `react-map-gl@8` is an extra dependency for a single map surface. Fix: drop `react-map-gl`, wrap MapLibre by hand as the UI track specifies; reconcile the cross-cutting dep list.

**M-2 — `event_log` growth estimate is internally inconsistent across tracks and the cap math is optimistic.** System/Infra says "~120k events/season → 60–120 MB/season"; Domain-Model and Cross-cutting say "hundreds of events/season → tens of KB/yr." That's a 1000× disagreement. The 120k figure (if every weigh/attendance/task event is logged with a jsonb payload + hash) at 60–120 MB/season means the 500 MB DB cap is hit in **~4 seasons**, not "5–10 years." The honest number is closer to System/Infra's. Fix: adopt the conservative estimate, cap `payload` size (Cross-cutting's `octet_length < 4096` is good), and **spec the event-archive-to-Drive path as a Phase-1 design output (not a years-out afterthought)** since it's the only thing standing between the design and the cap.

**M-3 — Hash chain in a `BEFORE INSERT` trigger serializes all writes and is racy under concurrency.** `hash = sha256(prev_hash || ...)` requires reading the current chain head, which under concurrent inserts needs `SERIALIZABLE` or an advisory lock, or two events get the same `prev_hash` and the chain forks. For a single online owner today it's fine, but the design explicitly future-proofs for offline multi-device replay (D5/D20), where concurrent appends are the norm. Fix: either accept a per-`(farm_id, aggregate_id)` chain (parallel chains, lock per aggregate) instead of one global chain, or document that the global chain requires a serialized writer and the offline replay reconciles via `device_seq` not the hash chain. The brief conflates "hash chain for tamper-evidence" with "total order for replay" — they're different mechanisms.

**M-4 — Reuse gate is satisfied, with one over-build to flag.** The EXTEND-over-CREATE analysis is genuinely good: reusing `lots(code)`, `db/*` ports, `security_invoker` view pattern, the RLS loop, and `mappers.test.ts` is all correct and verified against the repo. The one over-build: the `outbound_deliveries` queue + ports-and-adapters integration seam (D16) with `traces-dds`/`cropster-csv`/`qr-publish` adapters is **Phase-2+ infrastructure built in Phase-1**. EUDR v1 is "generate + park + manual submit" (D15) — which needs no queue at all. Building a dead-lettering retry queue for a manual-download feature is exactly the "while I'm here" over-build the constraints warn against. Fix: ship EUDR as a direct download (Route Handler, D3); defer the entire `outbound_deliveries` queue to when the second consumer (Cropster) actually exists.

## LOW

**L-1 — Mobile nav: the UI track's "flag loudly" is correct and verified.** `grep` confirms **no `BottomNav`, no mobile nav fallback exists** (the sidebar test exists but no bottom-nav). D22's finding stands; just confirming it's real, not a phantom. The map being the "home route `/`" (UI D25) also contradicts App-Arch's "don't hijack `/`, keep it the dashboard" (App-Arch §B.1). Reconcile: keep `/` as dashboard, map at `/map` — App-Arch's call is better for muscle-memory/deep-link stability.

**L-2 — `ytd_revenue_usd` honesty is good but the three tracks store it differently** (`farm_season_config` vs `season_inputs` vs `season_targets`). Trivial, but it's another "one author" divergence. Pick one config table name.

**L-3 — No `.rpc()` exists in the repo or the test mock yet** (verified). The getters.test chainable stub has no `.rpc()` method. Every write-path test needs the stub extended first — minor, but it's a prerequisite the test-plan sections assume is already there.

## Verdict on the critic's mandate

- **Quality attributes met?** Trust-via-derived-views and event-log-as-substrate are the right spine and structurally sound — *except* C2, which would silently zero the dashboard, defeating the #1 trust goal at runtime. World-class UI direction is excellent and grounded. Fix C1/C2/C3 and the trust property holds.
- **$0 free-tier honestly survivable?** Mostly yes for geometry (KB), but **the event-log cap math is dishonestly optimistic** (M-2: ~4 seasons, not 10) and the **pause mitigation is a single point of failure dressed as two** (H1). Survivable only if the event-archive path is a Phase-1 design deliverable and the heartbeat is treated as critical.
- **Offline-readiness preserved?** Yes — the column-level seam (device_id/device_seq/occurred_at/idempotency_key) is the right cheap investment. But the hash-chain-as-total-order conflation (M-3) will bite the future replay.
- **Event-log/derived-metrics consistent (no two-screens-disagree)?** By construction, yes — *if* H1's caching is dropped (caching reintroduces staleness) and C2's grants are fixed (else screens show zero, which is its own disagreement with reality).
- **Reuse gate satisfied?** Yes, strongly — one over-build (M-4, the integration queue).

**Must-fix before any migration is authored: C1, C2, C3, H2 (the three incompatible schemas), H3. These are not polish — C2 ships a dead dashboard, H2 means there is no single design to build yet.**

Grounding files read: `/Users/andres/coffee-farm-operations/supabase/migrations/{20260620120000_init,20260620140000_auth_required_rls,20260620150000_grant_hygiene}.sql`, `src/lib/db/{trends,plots}.ts`, `src/lib/db/__tests__/getters.test.ts`, `src/lib/supabase/server.ts`, `src/app/(app)/layout.tsx`, `vitest.config.ts`, `package.json`. Tooling verified: Node v25.9.0, **no Docker**, supabase CLI 2.90.0. No repo files were modified.

## §6 — Reuse Analysis (EXTEND vs CREATE-NEW gate)

I now have complete grounding: the SSOT design intent, the real schema, the DB/mapper pattern, the glass UI primitives, the hand-rolled SVG chart approach, and the jsdom+RTL test harness. I have everything needed for a decisive, repo-grounded Application Architecture design. No further reads required.

Here is the design.

---

# Phase-1 SPINE — Application Architecture Design (Janson Coffee)

Track: Application Architecture. Scope: how the 8 capabilities sit on the existing Next.js 15 + Supabase-free-tier code, with EXTEND-vs-CREATE decisions, the ports/adapters layering, and the concrete schema/component/UI shapes. Geometry-engine internals (PostGIS DEM math), the EUDR baseline-fetch pipeline, and MapLibre rendering internals are owned by sibling tracks — I define the **seams** they plug into.

## 0. The one decision that orders everything: the read path is already a ports-and-adapters seam — extend it, do not rebuild it

The repo already has the exact layering the DISCUSS doc calls for, just not named:

```
Server Component (src/app, src/components/sections)   ← consumer
        │ calls
getPlots()/getHarvests()/...  (src/lib/db/*.ts)        ← PORT (cache()'d async fns returning domain types)
        │ wraps
PostgREST .from(...).select(...)                       ← ADAPTER (Supabase)
        │ maps via
mapPlot()/mapHarvest()/...                             ← pure row→domain mapper (already unit-tested)
        │ returns
domain types (src/lib/types.ts)                        ← CONTRACT
```

`src/lib/db/*.ts` **is** the port layer. `mapX` functions are pure and already have `mappers.test.ts`. The domain contract is `src/lib/types.ts`, and `CLAUDE.md` already declares `src/lib/**` and `globals.css` as "don't fork" SSOT. **The architecture is therefore: every Phase-1 capability is a new column/table/view behind the existing port functions plus, where genuinely new (lot graph, GreenLot, events), a new sibling port module in the same shape.** This is the EXTEND default, codified.

One structural change is warranted, and only one: the contract file is becoming large and multi-domain. Split `src/lib/types.ts` into a barrel — `src/lib/types/index.ts` re-exporting `plot.ts`, `harvest.ts`, `lot.ts`, `green-lot.ts`, `event.ts`, `metrics.ts` — so the lot-graph and GreenLot types land as new files (file-disjoint, parallel-agent-safe) without serializing every author on one 140-line file. Existing imports (`@/lib/types`) keep working unchanged. This is the single CREATE-NEW-as-split; everything else extends in place.

## 1. REUSE ANALYSIS — EXTEND vs CREATE-NEW (the hard gate)

| Phase-1 capability | Existing code it overlaps | Decision | Concrete action + justification |
|---|---|---|---|
| **1. Lot-genealogy graph** | `lots(code text primary key)` table (degenerate — code only); `Harvest.lotCode`, `ProcessingBatch.lotCode` FK to it | **EXTEND `lots` + CREATE-NEW `lot_edges`** | Keep `lots.code` as the canonical PK (preserves every existing FK and the `JC-564` ids — zero renumber). ADD columns to `lots` (`kind`, `variety`, `created_at`, `minted_from_harvest_id`). The genealogy is a *new relation* with no existing equivalent → new `lot_edges(parent_code, child_code, op, mass_kg, ...)` table. New port `src/lib/db/lots.ts` (none exists today). Graph is the one place CREATE-NEW is unavoidable; the *node* table is reused. |
| **2. PostGIS plot geometry** | `plots` flat scalars `area_ha`, `altitude_masl` | **EXTEND `plots`** | ADD `geom geometry(Polygon,4326)`, `elevation_m`, `slope_deg`, `aspect_deg`, `centroid geography`. `area_ha`/`altitude_masl` become **derived-but-retained** (kept as columns, backfilled from `ST_Area(geom)` / DEM, so `mapPlot`/`PlotCard`/`PlotRow` and their tests keep working untouched). Reserve is new → `CREATE-NEW protected_areas` table (no plot fields fit a 200-ha non-producing polygon). `mapPlot` extends with optional `geom`. |
| **3. MapLibre spatial home** | `src/app/(app)/page.tsx` (dashboard), `living-background.tsx`, charts as SVG server components, `glass-card`/`stagger` utilities | **CREATE-NEW route `/map`, EXTEND shell** | The map is a genuinely new surface (a client island — MapLibre needs the DOM) and must not replace the working dashboard. Add `/map` as a sibling route, link it from the existing `sidebar.tsx` (extend the nav array — don't rebuild the shell). Map is the *only* large client component added in Phase 1; everything around it (header, glass chrome, plot detail panel) stays Server Components reusing `Card`, `Badge`, `ProgressBar`. |
| **4. Derived-metrics semantic layer** | `season_summary`, `daily_cherries`, `weekly_harvest`, `variety_shares` **tables**; `getSeason`/`getDailyCherries`/`getWeeklyHarvest`/`getVarietyShares` in `db/trends.ts` | **EXTEND ports, REPLACE table bodies with VIEWS** | The port *functions and their return types stay byte-identical* — only what they read from changes from a hand-authored table to a `security_invoker` SQL view computed from `harvests`/`processing_batches`. `getSeason()` still returns `Season`; `mapSeason`/`mapTrend` unchanged. This is the #1 trust fix and it costs **zero UI/port-signature change** — pure swap behind the seam. The existing `views` block in `20260620120000_init.sql` (`harvests_view`, `tasks_view`) is the proven pattern to extend. |
| **5. GreenLot inventory** | Pipeline dead-ends at `processing_batches.stage='green'`; no inventory entity anywhere | **CREATE-NEW `green_lots` + port** | No existing table models a graded, located, available-to-promise asset. New `green_lots` table, new `src/lib/db/green-lots.ts` port (mirrors `processing.ts` shape exactly), new `GreenLot` type. A `green`-stage batch *promotes* into a GreenLot via a `lot_edges` edge (`op='mill'`), so it reuses the graph rather than inventing a second linkage. |
| **6. Append-only event log** | `activity` table + `getActivity()` + `activity-feed-card.tsx`; `ActivityItem` type | **CREATE-NEW `events` (substrate), EXTEND activity as a VIEW over it** | `activity` is presentation-shaped (free `text`, no hash chain). Create the hash-chained `events` table as the substrate; then redefine the activity feed's source as a **view that projects `events` into the existing `ActivityItem` shape**. `getActivity()` signature and `activity-feed-card.tsx` stay unchanged — the feed becomes event-driven for free, exactly as the DISCUSS "Make the dashboard event-driven … with no UI change required" line specifies. |
| **7. EUDR export** | `plots.established_year`, plot geometry (cap. 2) | **CREATE-NEW route `/compliance/eudr` + RPC** | New compliance surface; no overlap. Reuses plot polygon + `establishedYear`; emits GeoJSON + a DDS draft. UI reuses `Card`/`page-header.tsx`/`button.tsx`. Deforestation-check-vs-2020-baseline logic is the **EUDR sibling track's** seam; I expose it as a port `getEudrDossier(lotCode)`. |
| **8. Activity-based COGS** | `workers.daily_rate_usd`, `tasks` (labor), `processing_batches` (mass loss), the graph (cap. 1) | **CREATE-NEW derived view `lot_cogs` + port** | Pure computation over existing labor/task/processing rows + the new mass-carried graph edges. No new captured data needed for a first cut. New `cost_per_kg_green` view + `src/lib/db/cogs.ts` port. Shares the cost-ledger seam with Phase-3 accounting (designed in, not built). |

**Net: 4 EXTEND-in-place (lots node, plots, semantic layer, activity), 4 CREATE-NEW (lot_edges, green_lots, events, plus the EUDR/COGS views), 1 type-file split.** Default-to-EXTEND honored; CREATE-NEW only where no existing relation models the concept.

### feat/supabase-backend additions to build on (flagged)
- **`src/lib/supabase/server.ts`** — `getSupabase()` is `cache()`'d, cookie-aware, runs as `authenticated`. Every new port reuses it verbatim. Do not add a second client.
- **`security_invoker` views** (`harvests_view`, `tasks_view`) — the proven pattern for the semantic layer and the activity-over-events view. Extend this block.
- **The RLS loop** in `20260620140000_auth_required_rls.sql` — append new table names to its array; do not write per-table policies by hand.
- **`mappers.test.ts` / `getters.test.ts`** — the test pattern every new port copies (pure mapper test + a getter test with a mocked client).
- **Text PKs** (`p-tizingal-alto`, `JC-564`) — canonical IDs already exist; the SSOT "canonical ID per real-world thing" intent is **already satisfied**. Do not introduce surrogate UUIDs that would orphan the existing FKs.

## 2. Layering decision (2 options → pick)

**Option A — keep ports thin, push all logic into SQL views/RPCs (DB-centric).**
**Option B — fat TypeScript service layer above the ports (app-centric).**
**Option C (recommended) — derived TRUTH in SQL, derived PRESENTATION in TS.**

- Metrics, COGS, EUDR mass-balance, the deforestation flag → **SQL views / `SECURITY INVOKER` functions**. Rationale: these are the numbers that "must never disagree across screens." If the rollup lives in one view, every screen reads the same row — the trust property is *structural*, not a discipline. It also keeps the JS bundle tiny (Server Components await one query) and respects RLS automatically.
- Formatting, graph layout (positions for the genealogy diagram), and map styling → **TS, in/above the port**. Rationale: presentation must stay refactorable and testable in jsdom without a DB.

Why not A: putting graph *layout* and GeoJSON shaping in SQL is unreadable and untestable under the TDD rule. Why not B: a fat TS service recomputing season totals reintroduces the exact "two screens, two numbers" defect the semantic layer exists to kill. C draws the line at *truth vs. presentation*, which is the line the SSOT vision actually cares about.

## 3. Concrete schema (migrations — additive, RLS-extended)

Three new migrations, timestamped strictly after `20260620140000`. Each appends its tables to the RLS loop array.

```sql
-- 20260621100000_lot_graph_events.sql  (capabilities 1 + 6)
alter table lots
  add column kind          text not null default 'harvest',  -- harvest|blend|green|roast (future)
  add column variety       coffee_variety,
  add column minted_from   text references harvests(id),
  add column created_at    timestamptz not null default now();

create table lot_edges (
  id          bigint generated always as identity primary key,
  parent_code text not null references lots(code),
  child_code  text not null references lots(code),
  op          text not null check (op in ('split','merge','blend','mill','roast')),
  mass_kg     numeric not null check (mass_kg >= 0),   -- mass carried on EVERY edge (SSOT invariant)
  created_at  timestamptz not null default now(),
  check (parent_code <> child_code)
);
create index lot_edges_parent_idx on lot_edges(parent_code);
create index lot_edges_child_idx  on lot_edges(child_code);

-- Append-only event substrate. Hash chain: each row binds the prior row's hash.
create table events (
  seq        bigint generated always as identity primary key,  -- total order
  at         timestamptz not null default now(),
  kind       activity_kind not null,                            -- reuse existing enum (extend later)
  subject    text not null,            -- e.g. lot code / plot id / worker id
  payload    jsonb not null default '{}'::jsonb,
  prev_hash  text not null,
  hash       text not null            -- sha256(seq||at||kind||subject||payload||prev_hash)
);
-- append-only guard: forbid UPDATE/DELETE at the policy layer (no policy granted for them).
```

Auto-mint lot code on cherry intake → a `BEFORE INSERT` trigger on `harvests` that, when `lot_code` is null, mints `JC-<next>` into `lots` (kind='harvest', minted_from=NEW.id) and writes a `harvest` event. The genealogy root edge is the harvest→lot mint.

```sql
-- 20260621110000_geometry_greenlots.sql  (capabilities 2 + 5)
create extension if not exists postgis;     -- available on Supabase free tier
alter table plots
  add column geom        geometry(Polygon,4326),
  add column elevation_m integer,
  add column slope_deg   numeric,
  add column aspect_deg  numeric;
-- area_ha / altitude_masl RETAINED, backfilled from geom/DEM (sibling track owns the math).

create table protected_areas (
  id   text primary key,                 -- 'reserve-quetzal'
  name text not null,
  kind text not null default 'reserve',
  geom geometry(MultiPolygon,4326) not null
);

create table green_lots (
  code             text primary key references lots(code),  -- a GreenLot IS a lot node
  grade            text,
  screen_size      text,
  moisture_pct     numeric,
  location         text,                    -- warehouse/bin
  weight_kg        numeric not null,        -- on-hand green
  reserved_kg      numeric not null default 0,
  -- available-to-promise is DERIVED, never stored:
  available_kg     numeric generated always as (weight_kg - reserved_kg) stored,
  graded_at        date
);
```

```sql
-- 20260621120000_semantic_layer.sql  (capabilities 4 + 8, + activity-over-events)
-- Replace hand-authored aggregate tables with computed views (same columns the ports read).
drop table season_summary, daily_cherries, weekly_harvest, variety_shares cascade;

create view variety_shares with (security_invoker=on) as
  select p.variety, sum(h.cherries_kg) as kg
  from harvests h join plots p on p.id = h.plot_id
  group by p.variety;

create view season_summary with (security_invoker=on) as
  select 1 as id,
         (select sum(expected_yield_kg) from plots)                              as target_kg,
         (select sum(cherries_kg) from harvests)                                 as harvested_kg,
         (select coalesce(sum(cherries_kg),0) from harvests
            where date = (select max(date) from harvests))                       as today_kg,
         /* ytd_revenue_usd: stays a stored input until Phase-3 sales exist */
         (select ytd_revenue_usd from season_inputs where id=1)                  as ytd_revenue_usd;
-- daily_cherries / weekly_harvest: GROUP BY date / date_trunc('week') with the same (label,value) shape.

create view lot_cogs with (security_invoker=on) as           -- activity-based COGS
  select l.code,
         /* labor from tasks×worker daily rate + processing; ÷ green mass carried on lot_edges */
         ... as cost_per_kg_green;

-- Activity feed becomes a projection of the event log — getActivity() unchanged.
create view activity with (security_invoker=on) as
  select 'e'||seq as id, at::date as at, kind, payload->>'text' as text
  from events order by seq desc;
```

Note the one honest caveat the DISCUSS doc flags: `ytd_revenue_usd` has no source rows in Phase 1 (sales are Phase 3), so it stays a tiny `season_inputs` stored value rather than a fake computation — derived where data exists, explicitly stored-and-labeled where it doesn't. That is the honest semantic-layer boundary, not a leak.

## 4. New ports (mirror the existing shape exactly)

Each new file copies `db/plots.ts`: a `Row` interface, a pure `mapX`, a `cache()`'d getter using `getSupabase()`, error-throw on `error`. TDD: `mapX` gets a pure mapper test; the getter gets a mocked-client test — same as `mappers.test.ts`/`getters.test.ts`.

- `src/lib/db/lots.ts` — `getLot(code)`, `getLotGenealogy(code)` → returns `{ nodes: LotNode[], edges: LotEdge[] }` (graph DTO; layout computed in TS).
- `src/lib/db/green-lots.ts` — `getGreenLots()`, `getGreenLotByCode()`.
- `src/lib/db/events.ts` — `getEvents(limit)`; **writes go through a single `appendEvent()` RPC**, never a raw insert (preserves the hash chain server-side).
- `src/lib/db/cogs.ts` — `getLotCogs(code)`, `getPlotCogs(plotId)`.
- `src/lib/db/geometry.ts` — `getPlotGeometry()` → GeoJSON FeatureCollection for the map; `getProtectedAreas()`.
- `src/lib/db/eudr.ts` — `getEudrDossier(lotCode)` (calls the sibling-track deforestation RPC).
- `src/lib/db/trends.ts` — **unchanged signatures**; only the underlying tables-turned-views change.

## 5. UI — world-class glass on every new surface (the #1 quality attribute)

The hard rule: **everything stays a Server Component except the irreducibly-interactive map and graph canvas.** Reuse `Card`, `Badge`, `ProgressBar`, `page-header.tsx`, the hand-rolled SVG charts, and the `glass-card`/`glass-hover`/`stagger`/`animate-rise`/`cv-auto`/`perf-contain` utilities. No chart/graph library is added — the repo already proves dense SVG viz as zero-JS server components (`donut.tsx`, `trend-line.tsx`); the genealogy graph follows that exact template.

- **Lot-genealogy graph** — render as an **SSR SVG sankey/tree** (server component, like `donut.tsx`): nodes = `glass-card`-styled `<g>` rects with the lot code + mass, edges = `<path>` with stroke-width ∝ `mass_kg`, brand `#00291D` palette, faint specular gloss reused from the donut `<defs>`. A thin client island only adds pan/zoom (transform/opacity only → 60fps; `prefers-reduced-motion` disables the entrance stagger). This keeps the JS bundle near-zero while the lineage is fully visible.
- **MapLibre home (`/map`)** — MapLibre GL JS v4 (BSD, free; OSM raster tiles; MapTiler-free or self-hosted style) in a `"use client"` island. Plots/reserve drawn from `getPlotGeometry()` GeoJSON. The surrounding chrome (filter chips reusing `Chip`, a plot detail drawer reusing `Card`/`Badge`/`ProgressBar`) is Server Components. Glass skeleton: a frosted `glass-card` map-shaped placeholder via `loading.tsx` (the repo already ships per-route `loading.tsx`). WCAG AA: legend/labels on solid chips, not on the translucent map.
- **GreenLot inventory** — a `data-table.tsx` (reused) of graded lots with `available_kg` as a `ProgressBar` (reserved vs on-hand), `Badge` for grade. Pure server table.
- **EUDR export** — a `page-header.tsx` + a single `button.tsx` that streams the GeoJSON/DDS; a status `Badge` (deforestation-free ✓ / needs-review). Server-rendered, one client action.
- **COGS** — a `stat-card.tsx` per lot/plot showing `$ /kg green`, with a `bar-mini.tsx` (reused) cost-component breakdown.

Glass discipline carried from `CLAUDE.md`: real `backdrop-blur` only on floating chrome (map drawer, graph zoom controls); content cards use no-blur glass-lite. GPU transform/opacity only. Every new component ships a render/smoke test (jsdom+RTL is already wired).

## 6. Free-tier ceiling — honest analysis (the $0-forever constraint)

- **PostGIS on Supabase free tier**: supported (`create extension postgis`). Plot polygons for one estate (~dozens of polygons + one 200-ha reserve) are kilobytes — trivially inside 500 MB. The `events` log is the only unbounded grower: at farm scale (hundreds of events/season) it's ~tens of KB/yr — safe for many seasons. **Flag:** add a `mass_kg`/jsonb size sanity and, in a later phase, partition or archive `events` if it ever approaches the cap.
- **7-day idle pause**: the project pauses after 7 days with no requests. For a practice/portfolio app that's acceptable; mitigate with a free uptime pinger only if a live demo must stay warm — **do not** add a GitHub Action (forbidden); a manual visit or a free external cron is the $0 path. Flag for Andres, don't pre-build.
- **MapLibre + OSM + free DEM + GFW/Copernicus baseline**: all free, no key required for OSM raster; matches the constraint. The deforestation baseline is a one-time fetch (sibling track), cached as a column — no recurring cost.
- **No CI** (`CLAUDE.md`): the migrations are applied manually; the quality gate is local `npm run build` + `npm run test`. The semantic-layer views must be validated against the seeded rows by a test that asserts `getSeason()` equals a hand-summed fixture — the regression guard that the computed numbers match expectations.

## 7. Diagram — the spine as projections of one ledger

```mermaid
flowchart TB
  subgraph capture["Write path (auto-mint + append-only)"]
    H[harvests INSERT] -->|BEFORE INSERT trigger| MINT[mint lot in lots + edge]
    MINT --> APP[appendEvent RPC]
    APP --> EV[(events — hash-chained)]
  end

  subgraph truth["Canonical relations (SSOT)"]
    LOTS[(lots = graph nodes)]
    EDGES[(lot_edges — mass on every edge)]
    PLOTS[(plots + PostGIS geom)]
    GREEN[(green_lots)]
    EV
  end

  subgraph derived["Semantic layer = security_invoker VIEWS (truth, never typed)"]
    SS[season_summary] & VS[variety_shares] & DC[daily/weekly] & COGS[lot_cogs] & ACT[activity = events projection] & EUDR[eudr_dossier]
  end

  subgraph ports["src/lib/db/* ports (cache, getSupabase, mapX) — EXTENDED"]
    P1[trends.ts*] & P2[lots.ts] & P3[green-lots.ts] & P4[cogs.ts] & P5[geometry.ts] & P6[events.ts] & P7[eudr.ts]
  end

  subgraph ui["Server Components + 2 client islands (glass)"]
    DASH[dashboard] & MAP[/map MapLibre/] & GRAPH[lineage SVG] & INV[GreenLot table] & EX[EUDR export]
  end

  LOTS --> derived
  EDGES --> COGS
  PLOTS --> EUDR
  PLOTS --> P5
  GREEN --> P3
  EV --> ACT
  truth --> derived --> ports --> ui
  classDef star fill:#00291D,color:#fff
  class P1 star
```

`*trends.ts` keeps its signatures; only its tables become views. Every UI surface is a projection — the SSOT invariant the whole phase exists to establish.

## Key decisions, in one line each
1. **The existing `db/*` layer IS the ports/adapters seam** — extend it; one new port file per new entity, identical shape.
2. **Reuse `lots.code` text PK** as the canonical lot-node id; genealogy is the only unavoidable new table (`lot_edges`), mass on every edge as a `CHECK`-guarded invariant.
3. **Semantic layer = swap hand-authored aggregate tables for `security_invoker` views** with zero port-signature/UI change — the #1 trust fix, structural not disciplinary.
4. **Activity feed becomes a view over the hash-chained `events` table** — `getActivity()` and `activity-feed-card.tsx` unchanged.
5. **PostGIS extends `plots`; `area_ha`/`altitude_masl` retained as derived-backfilled columns** so every existing plot component/test survives.
6. **GreenLot is a lot node** (`green_lots.code → lots.code`) promoted via a `lot_edges` `mill` edge — reuses the graph, no second linkage.
7. **Truth in SQL, presentation in TS**; no chart/graph/map library beyond MapLibre — SVG server components for the lineage graph, matching `donut.tsx`.
8. **Split `types.ts` into a `types/` barrel** — the only structural CREATE, enabling parallel file-disjoint authoring without touching the 140-line contract serially.

Relevant existing files this design extends (all read-only to me): `/Users/andres/coffee-farm-operations/src/lib/types.ts`, `/Users/andres/coffee-farm-operations/src/lib/db/{plots,harvests,processing,activity,trends}.ts`, `/Users/andres/coffee-farm-operations/src/lib/supabase/server.ts`, `/Users/andres/coffee-farm-operations/supabase/migrations/20260620120000_init.sql`, `/Users/andres/coffee-farm-operations/supabase/migrations/20260620140000_auth_required_rls.sql`, `/Users/andres/coffee-farm-operations/src/components/sections/dashboard/activity-feed-card.tsx`, `/Users/andres/coffee-farm-operations/src/components/sections/plots/plots-explorer.tsx`, `/Users/andres/coffee-farm-operations/src/components/charts/donut.tsx`, `/Users/andres/coffee-farm-operations/src/app/globals.css`. New migrations would land at `/Users/andres/coffee-farm-operations/supabase/migrations/2026062110000{0,1,2}_*.sql` and new ports under `/Users/andres/coffee-farm-operations/src/lib/db/{lots,green-lots,events,cogs,geometry,eudr}.ts`.

---

## §7 — Track Sections (full consolidated designs)

### System & Infrastructure

Decisive reconciliation point confirmed. The current RLS head is **authenticated-only SELECT, anon fully revoked** — not the "anon + authenticated public read" every fragment assumed. This forces several corrections in the consolidated brief (the EUDR fragment's "narrow anon away" is already done; the security fragment's farm-filtered public-read predicate must rebase onto authenticated-only; the event-log/derived-metrics fragments' new views/policies must use `authenticated` not `anon`). I now have everything I need to write one coherent, decisive section.

---

# ARCHITECTURE BRIEF — System & Infrastructure Track (Phase-1 SPINE)

**Janson Coffee Farm Operations · consolidates the data-model, PostGIS, event-log, semantic-layer, security/multi-tenant, EUDR/integration, and offline-future-proofing fragments into one coherent infrastructure design.**

## 0. Ground-truth correction that reshapes the whole track

Every input fragment grounded only on `20260620120000_init.sql` and asserted the live RLS posture is *"anon + authenticated public-read, `using(true)`."* **That is stale.** A second migration is already on the branch:

- **`20260620140000_auth_required_rls.sql`** drops the `"public read"` policies, replaces them with `"authenticated read"`, and **`revoke select ... from anon`**. The app is **single-owner, authenticated-only** today; the public/anon key reads nothing.

This is load-bearing and corrects three fragments at once:
- The current schema head (max migration timestamp) is **`20260620140000`**, not `120000`. New migrations must sort strictly above `20260620140000`.
- The EUDR fragment's "narrow the blanket anon grant for the new sensitive tables" is **already the global posture** — there is no anon grant left to narrow.
- The security/event-log/semantic-layer fragments that grant new objects to `anon` must be rebased: **new tables and views grant SELECT to `authenticated` only**, never `anon`.

All decisions below are stated against this corrected baseline.

---

## 1. Locked decisions (D-numbered, the SSOT contract)

### Identity, write model, and the event spine
- **D1 — Dual identity authority.** Keep the existing human `text` PKs on slow-moving reference/anchor data (`plots` `p-tizingal-alto`, `workers` `w-06`, `lots` `JC-564`) — they are referenced everywhere and edited only by the online owner. All **new, field-capturable, or graph** rows (`event_log`, lot-graph nodes/edges, `green_lots`, future `weigh_event`) use **client-mintable UUIDv7** PKs with **no DB `DEFAULT`** — the writer always supplies the id. Mixing `text` anchors with `uuid` event ids is correct: identity authority matches write pattern. A `src/lib/ids.ts` `newId()` port is the single mint site (server calls it now, a future PWA calls the same port).
- **D2 — One append-only, hash-chained `event_log` is the canonical write substrate.** Every Phase-1 *state change for new spine capabilities* (cherry intake/lot-mint, lot split/merge/blend, green-lot grading, activity entries, deforestation verdicts) is an **append** to `event_log`; current-state tables/views are **projections**. This is simultaneously Capability 6 (audit), the activity feed source, the derived-metrics source (Cap 4), and the offline replay log — **one table, not four mechanisms**. Immutability is enforced structurally: **no UPDATE/DELETE policy exists** for any client role, plus `do-instead-nothing`/`raise`-on-mutate triggers as belt-and-suspenders. Hash chain (`prev_hash → hash = sha256(...)`) is computed **in a `BEFORE INSERT` trigger** via `pgcrypto.digest()` — never trusted from the client. **Scope discipline:** legacy mutable tables (`plots.harvested_kg` etc.) are *not* rebuilt onto a replay engine in Phase-1; only the **new** spine writes go event-first, and the **activity feed becomes the first projection** (lowest-risk proof of the substrate). One canonical hashing util, shared by the event-log and EUDR-verdict consumers — do not fork it.
- **D3 — Writes flow through `SECURITY DEFINER` command RPCs, one per business intent** (~8 for Phase-1: `record_cherry_intake`, `advance_processing_stage`, `create_task`, `set_task_status`, `mark_attendance`, `mint_lot`, `create_green_lot`, `update_plot`). The RPC writes the domain row **and** appends the event in **one transaction** (transactional-outbox collapsed to a single DB) — atomic, intent-explicit, idempotent. Table grants stay SELECT-only (authenticated); only the definer functions write. `record_cherry_intake` is the canonical lot-code minter (monotonic `JC-NNN`, exactly-once, concurrency-tested).
- **D4 — Idempotent ingestion keyed on the client UUIDv7 PK.** `INSERT ... ON CONFLICT (id) DO NOTHING`, plus `UNIQUE (device_id, device_seq)`. Replaying an event is a no-op by construction (offline-retry safety, free now, impossible to retrofit cleanly). The server RPC wraps appends in `ON CONFLICT DO NOTHING` from commit one, even with a single online writer.
- **D5 — Causal-ordering columns are NOT NULL on `event_log` from event #1:** `device_id` (uuid, offline node identity + LWW actor), `device_seq` (bigint, per-device monotonic Lamport counter), and **dual clocks** `occurred_at` (client field wall-clock — the key every metric computes on) vs `recorded_at` (server accept clock — the sync cursor). These are unrecoverable if added later; a synthetic server `device_id` fills them today.

### The lot-genealogy graph
- **D6 — Lot genealogy = adjacency DAG with mass on every edge.** `lot_nodes(node_id uuid, lot_code, kind, variety, plot_id, mass_kg)` + `lot_edges(parent_node, child_node, mass_kg, op)`. **Not** a closure table (duplicates truth — the defect we're killing), **not** `ltree` (can't represent a blend's multi-parent merge). Splits = one parent → many children; merges/blends = many parents → one child. Mass on the edge makes the graph self-auditing and recursive-CTE traversable (trivial at finca scale). `lot_nodes.lot_code` reuses the existing `lots(code)` PK; `lot_nodes.plot_id` is the EUDR/COGS join key.
- **D7 — Mass conservation is a DB-enforced promise, not app code.** A `lot_yield_balance` view (`node_mass`, `mass_in`, `mass_out`) plus a SQL-fixture regression test (1,000 kg cherry → 180 kg green; assert no node has `mass_out > mass_in`). The washed-yield loss tolerance (~16–20% green-from-cherry) is a **flag for the agronomy track** — placeholder until the family pins it.

### Units
- **D8 — A tiny UCUM `units` table + `convert_qty()` function, NOT a generic EAV ledger.** `(value numeric, unit text references units(code))` with UCUM codes (`kg`, `g`, `[brix]`, `%`, `m2`, `ha`, `Cel`, `L`, `count`). `convert_qty()` returns NULL on incommensurable dimensions (fails loud, never silently zero). The domain is ~99% mass in kg; a full conversion engine is over-engineering for $0.

### Geometry
- **D9 — PostGIS into the `extensions` schema (`create extension postgis with schema extensions`), `postgis` only — never `postgis_raster`/`postgis_topology`.** Installing into `extensions` (Supabase convention) keeps PostgREST from exposing 1,000+ PostGIS functions as RPC. The raster extension is a storage trap **and** its GDAL drivers are disabled on Supabase managed infra (`ST_FromGDALRaster` → "GDAL Drivers Disabled") — decisively confirmed, and it forces the EUDR precompute design (D14).
- **D10 — Geometry on `plots` (extend, don't fork) + a first-class `reserve_zones` table.** `plots` gains `geom geometry(MultiPolygon, 4326)`, `centroid`, and DEM-derived scalar columns (`elevation_mean/min/max_m`, `slope_deg_mean`, `aspect_deg_mean`). The 200-ha quetzal reserve is **not** a plot (no variety/yield) → its own `reserve_zones(kind, geom, …)`. `MultiPolygon` not `Polygon` (road/creek splits; multi-part reserve). GiST index on every geometry column. This is the one-canonical-geometry, one-schema-author keystone — no track may fork a `plot_boundaries` table.
- **D11 — DEM elevation/slope/aspect are derived once at build time and stored as scalars, never as in-DB rasters.** A local `scripts/derive-terrain.mjs` clips Copernicus **GLO-30** (30 m, CC-BY, void-filled — over SRTM for the cleaner license), runs `gdaldem slope`/`aspect`, takes area-weighted means (aspect via **circular mean** of sin/cos — flat averaging of 0/360 is a classic bug). 10 plots × 6 numbers; DEM tiles are fetched-and-discarded, never stored. `geom_area_ha` is a **generated stored column** (`ST_Area(geom::geography)/10000`) that reconciles against the frozen `area_ha` scalar — a `>5%` drift is surfaced as a data-quality signal by Cap 4, **not** an error (seed polygons are approximate; real GPS walks converge them later, no schema change).

### Derived-metrics semantic layer
- **D12 — Replace all four hand-authored aggregate tables with live `security_invoker` views (Option C), not materialized views, not app-side compute.** `season_summary`/`daily_cherries`/`weekly_harvest`/`variety_shares` become `v_metric_*` views whose **columns match the existing `src/lib/db/trends.ts` mappers (`mapSeason`/`mapTrend`/`mapVarietyShare`) exactly** — verified: the getters select `target_kg/harvested_kg/today_kg/ytd_revenue_usd`, `sort_order/label/value`, `variety/kg`. **The TypeScript read layer is therefore untouched** (the views keep the same names the getters already `.from()`). Matviews are rejected: they need a refresh job the free tier can't guarantee (no reliable pg_cron, 7-day idle pause), they double-store against the 500 MB cap, and a stale refresh **reintroduces the exact "numbers disagree" defect** the layer exists to kill. Live views over hundreds of rows are sub-millisecond. **Materialized-view escape hatch is reserved (ADR-SL-002), not built** — same SQL body re-physicalized via a free Edge-Function cron only if a view ever measures >50 ms (future multi-estate/NDVI scale).
- **D13 — `plot.status` fusion is owned here as `v_metric_plot_status`** (resolves the cross-pillar gap): the stored `plots.status` is demoted to one *input signal* (the agronomist's explicit call), fused with yield-ratio and inspection-staleness in one `CASE`. Grow writes signals; the semantic layer resolves the displayed status. Parameterized/heavy metrics (per-lot COGS, per-plot progress) are `fn_metric_*` `SQL`/`stable` functions with pinned `search_path`, exposed via `.rpc()`. The `metric_*` namespace **is** the registry — a build-failing lint (in local `npm run test`, no CI) fails if any getter `.from()`s an aggregate-shaped name outside `v_metric_*`/`fn_metric_*`, or if a dropped aggregate table reappears. The genuine *input* `target_kg`/price relocates to a 1-row `farm_season_config` (a goal is an input, not a derived number). **`ytd_revenue_usd` is the one figure not yet derivable** (needs Phase-2 GreenLot sales) — kept honestly sourced, flagged to the GreenLot track.

### EUDR & outbound integration
- **D14 — Deforestation check = precomputed verdict, not a live raster overlay or per-request API call.** A local `tsx` script overlays each `plots.geom` against the **JRC Global Forest Cover 2020** GeoTIFF (Panama tile **W090N10** — the EU's own legal baseline against the **31 Dec 2020** cutoff) using `@turf/turf` + `geotiff.js` (pure-JS, no GDAL), and folds in a **GFW tree-cover-loss read as a secondary corroboration column** (risk-screening grade, never the primary verdict). It writes a signed, hash-chained `deforestation_checks` ledger row (same substrate as D2) and denormalizes the latest verdict to `plots.eudr_status`. The runtime app is a pure projection — no client raster, no live API on a render path. JRC tiles live off-DB (repo `/data` or fetch-on-run), never in the 500 MB Postgres.
- **D15 — DDS is a derived projection; the EU-owned reference number is the only persisted external state.** Assemble the TRACES-NT-shaped DDS (operator + HS commodity + producer-country `PA` + base64 FeatureCollection geolocation + 2020 cutoff) from `plots` + green-lot genealogy + `deforestation_checks`, render as downloadable JSON + GeoJSON + a print-grade PDF. **v1 is "generate + park + manual submit"** — submitting a legal declaration is exactly the irreversible, identity-bearing action that must wait for explicit human action, never auto-fire. Auto-POST to the TRACES API is a flagged future upgrade (needs an EU operator account + EORI; Janson's binding date is **mid-2027 SME tier**, not 2025/26 — runway confirmed).
- **D16 — One append-only `outbound_deliveries` queue behind a single ports-and-adapters seam** (`src/lib/integration/{port,queue,flush}.ts` + `adapters/{traces-dds,cropster-csv,qr-publish}.ts`). Idempotency-keyed (exactly-once), retried, dead-lettered. Its shape is a deliberate subset of the DISCUSS `integration_events` model so the later full inbound hub *extends* rather than *replaces* it. No paid scheduler / no GitHub Actions — batch + flush run from `tsx` scripts (manual or externally-triggered free Edge Function).

### Security, multi-tenant, RLS, backup
- **D17 — `farm_id uuid NOT NULL` on every business row now, defaulted to one seeded `farms` row (`janson`).** Build the column + the policy predicate, **not** tenant switching. The cost today is ~20 lines; the cost later is a backfill + rewriting 18+ RLS predicates + cross-tenant-leak re-testing. **Simple PKs stay simple** — `farm_id` is an RLS-predicate column + index, **never** part of a composite PK (the TradelyHQ composite-FK delete-trap lesson). Index `farm_id` on every table so the predicate is cheap.
- **D18 — Replace the per-table hand-written policies with one RLS policy factory** (`app.apply_farm_rls(tbl)`), the same `do $$`/`foreach` idiom the two existing migrations already use. It stamps a standard set: **authenticated READ filtered by `app.current_farm_id()`**, and **owner/operator-only WRITE** (`app.can_write()` reads an `app_role` JWT claim) — so Phase-1 capture lands behind real write policies instead of a later retrofit. `force row level security` everywhere (the table owner is not exempt — required for the event-log immutability guarantee). `app.current_farm_id()` **coalesces to the sole farm** when no claim is present, so today's plain authenticated owner session works with zero JWT plumbing; the claim path is dormant until multi-tenant is switched on. **This rebases the security fragment's `anon`-read assumption onto the corrected authenticated-only baseline (§0).**
- **D19 — DR on $0 = "you own the dumps."** Honest ceiling: Supabase free tier has **no self-serve PITR and no reliable restore from platform backups**. So: schema SSOT = the migration files (git); structured-data DR = a nightly local `pg_dump --format=custom` (driven by launchd, **not** GitHub Actions) copied to the family's existing Drive; the hash-chained `event_log` doubles as a replayable, tamper-evident change journal; and a `<7-day` keep-warm ping (the only critical free-tier control — a paused project can eventually be deleted) defuses the idle-pause. A quarterly `pg_restore` drill is documented. **Flag:** the backup scheduler mechanism (launchd-local vs free hosted cron) and the fact that `force row level security` means the dump must run as a role that can read all farms — both need Andres's call before `scripts/backup.sh` is specced.
- **D20 — Conflict model decided now (offline future-proofing, design-only):** **facts are immutable events (conflict-free set-union); totals are projections (`SUM`), never stored mutable counters; opinions/status are LWW with a deterministic `occurred_at → device_id → device_seq` tiebreak, loser retained in the log.** This is the *same decision* as D12 (derive every total from rows) — a `SUM` over append-only weigh-events is automatically conflict-free, whereas `harvested_kg += x` under LWW silently loses data. **No CRDT library in Phase-1** (keeps the JS bundle tiny); the event envelope already carries everything an automerge doc would need if rare free-text co-edit ever warrants it. Soft-delete tombstones only (`*.deleted` events) — never a hard `DELETE` on a syncable entity. The entire offline *runtime* (service worker, Dexie, sync loop) is genuinely deferred and incurs zero Phase-1 code.

---

## 2. Recommended design — the migration sequence (resolving the collision)

Three fragments independently proposed the **same filename `20260621090000`** — a real collision under the one-schema-author lane. The current head is `20260620140000`. **Resolved ordering** (single schema author, each strictly greater, sequenced by dependency):

| # | Migration | Owns | Depends on |
|---|---|---|---|
| M1 | `20260621090000_postgis_plot_reserve_geometry.sql` | PostGIS extension, `plots.geom`+centroid+DEM scalars+`geom_area_ha`, `reserve_zones`, GiST indexes, `plots_geo`/`reserve_geo` views | — (first; EUDR joins to `geom`) |
| M2 | `20260621091000_tenancy_security.sql` | `farms`, `app` schema helpers, `farm_id` + index on every table, `app.apply_farm_rls` factory, re-stamp policies onto the authenticated-only baseline | M1 (stamps geo tables too) |
| M3 | `20260621092000_event_log_units_lot_graph.sql` | `units`+`convert_qty`, `event_log` (chain trigger, immutability, `verify_chain`), `lot_nodes`/`lot_edges`, `lot_yield_balance`, command RPCs, `activity` → projection view | M2 (`farm_id`, RLS factory, hashing util) |
| M4 | `20260621093000_derived_metrics.sql` | drop the 4 hand-authored aggregates (rename-aside, not hard-drop), `farm_season_config`, `v_metric_*` views, `fn_metric_*` RPCs, `v_metric_plot_status` fusion | M3 (events as source) |
| M5 | `20260621094000_eudr_outbound.sql` | `plots.eudr_*` columns, `deforestation_checks`, `dds_submissions`, `outbound_deliveries` | M1 (geom), M3 (green-lot id contract, hashing util) |

**`create extension` + new-table RLS + the four `rename-aside`s touch security/destructive posture → M1, M2, and M4 flag for explicit apply-OK before running, even though there's no CI.** Rename-aside (not `DROP`) on the aggregate tables gives one-line rollback. One migration author owns this whole lane serially; app-code work (new `src/lib/db/*` modules, the integration adapters, the audit drawer) fans out file-disjoint in parallel, closed by a reviewer pass.

---

## 3. Component / schema / UI specifics

**Schema spine (consolidated):**
- `event_log(id uuid pk, farm_id, aggregate_id, aggregate_type, type, payload jsonb, device_id, device_seq, occurred_at, recorded_at, actor_id→workers, prev_hash, hash, schema_version, UNIQUE(device_id,device_seq))` — indexes on `(aggregate_type, aggregate_id, occurred_at)` and `(recorded_at)` (the sync cursor).
- `lot_nodes(node_id uuid pk, lot_code→lots, kind, variety, plot_id→plots, mass_kg)`, `lot_edges(parent_node, child_node, mass_kg, op, occurred_at)`.
- `units(code pk, dimension, to_base, display)` + `convert_qty(v, from_u, to_u)`.
- `farms`, `farm_id` everywhere, `farm_season_config` (1 row), `app.current_farm_id()`/`app.can_write()`/`app.apply_farm_rls()`.
- `plots.{geom, centroid, geom_area_ha (generated), elevation_*, slope_deg_mean, aspect_deg_mean, eudr_status, eudr_checked_at, eudr_check_id}`; `reserve_zones`.
- `deforestation_checks` (hash-chained), `dds_submissions`, `outbound_deliveries`; `green_lots` (defined by the GreenLot track — referenced by un-FK'd `green_lot_id` until that PK contract is pinned).
- Views: `plots_geo`/`reserve_geo` (GeoJSON via `ST_AsGeoJSON`), `v_metric_*`, `v_metric_plot_status`, `lot_yield_balance`, `activity` (now a projection of `event_log`, **same `(id, at, kind, text)` columns** so `getActivity()` is untouched).

**Read-layer contract:** the existing `src/lib/db/{trends,activity,plots,...}.ts` getters and mappers **do not change** — D12/D2 preserve their column names. New entities get new `src/lib/db/{geo,events,lots,greenlots}.ts` modules mirroring the `Row`+`map`+`cache()` pattern. Server Components fetch `cache()`'d FeatureCollections/projections and pass ready data to client islands → **zero client-side GIS/aggregation, tiny JS bundle.**

**World-class UI (non-negotiable, the #1 quality attribute):** every new surface is Apple-grade liquid glass, GPU transform/opacity only, 60fps, `prefers-reduced-motion`, WCAG-AA on translucency, instant glass skeletons:
- **MapLibre spatial home** — plot polygons tint by `status`/`eudr_status` (low-opacity glass overlay), the reserve as a distinct first-class `glass-sheen` protected overlay, one click from boundary to rows (`feature.id === plots.id`, no client join glue), `fitBounds` from a single server-computed bbox.
- **Lot-genealogy graph** — split/merge/blend rendered with mass-on-edge labels, glass nodes, GPU-composited transitions.
- **Audit drawer** (`src/components/sections/audit/audit-drawer.tsx`) — glass slide-over (`translateX`+opacity), per-stream event chain with a green/amber **chain-verified** badge, reusing the activity feed's `KIND_ICON`/`KIND_CHIP` maps (extend, don't fork).
- **EUDR** — per-plot verdict pill, per-green-lot DDS panel with embedded polygon map + a print-grade PDF, a calm compliance status board ("X of Y verified deforestation-free, dual-source JRC+GFW").
- **Provenance-on-hover** — because every figure is a known `v_metric_*` view, stat cards can show "derived from N harvests · as of HH:MM" (a `glass-sheen` tooltip), turning the trust guarantee into a visible feature; freshness is honest where `revalidate > 0`.
- **Optimistic capture** — client-minted id + `occurred_at` (D1/D5) let field forms render the new card instantly (skeleton → card → "synced ✓" settle) with read order keyed on `occurred_at`, so no reflow on sync.

**TDD (test-first, every PR, no CI):** SQL-fixture mass-conservation test (fails on a schema that lets an edge exceed its parent); `convert_qty` incommensurable→NULL; hash-chain `verify_chain` tamper test (shared util); semantic-layer parity tests via **pglite** (in-process WASM Postgres, $0 — executes the *real* view SQL, so it pins the definition not a re-implementation); RLS fixture tests (anon cannot read/write, non-owner cannot write, owner cannot UPDATE/DELETE `event_log`, second-farm row invisible — these **fail on the pre-existing migration**, proving they catch the gap); the `metric_*` lint guard's own test; EUDR deforestation-math + DDS round-trip + queue idempotency/dead-letter tests; render/smoke tests for every glass surface.

---

## 4. Free-tier ceiling — the honest, consolidated verdict

| Resource | Phase-1 need | Wall | Verdict / mitigation |
|---|---|---|---|
| Postgres data | <50 MB for years | 500 MB | ✅ huge headroom. Only `event_log` grows unbounded — at ~0.5–1 KB/event and ~120k events/season it's ~60–120 MB/season; partition/cold-archive (closed-season streams → Drive, keep chain head + Merkle root) is a *years-out* concern. `schema_version` + projection-from-events make snapshotting possible later. |
| Geometry | <1 MB (10 polygons + reserve + 2 GiST) | within 500 MB | ✅ vector is cheap. **`postgis_raster` is the trap and is broken anyway (D9)** — DEM→scalars, no raster in DB. |
| Storage (media) | tens of MB/yr | 1 GB | ⚠️ the **only** real risk. Compress-on-upload (≤300 KB WebP/AVIF, ~1600px); EUDR satellite/DEM tiles fetched on-demand and **never stored**; surface a storage-usage indicator. |
| Idle pause | — | pauses @ 7 days, deletable if left | ⚠️ **the critical control**: a `<7-day` keep-warm ping (the EUDR batch run / a free uptime pinger doubles as it). Append-only log has no liveness need; first read just wakes the project. |
| Connections | 1 cached client/request | ~60 direct | ✅ route server reads through the **Supavisor pooler** URL, not direct 5432; the existing `cache()`'d per-render client is the correct pattern. |
| Backup/PITR | nightly pg_dump | no self-serve PITR | ⚠️ DR = your dumps + migrations + event-replay (D19). |
| Scheduler | batch/flush/keep-warm | no pg_cron / no GitHub Actions | ✅ `tsx` scripts run locally or via externally-triggered free Edge Function — never billed. |

**Bottom line: vector geometry, the event log, the lot graph, and the semantic layer are comfortably free-tier-viable for 5–10+ years at single-estate scale. The only ceilings that bite are media storage and the 7-day idle pause — both have $0 mitigations. Rasters and time-series telemetry are what threaten 500 MB, and Phase-1 deliberately keeps both out of Postgres.**

---

## 5. Key trade-offs accepted

- **Live views over matviews (D12):** trade a few microseconds (irrelevant at this scale) for *zero staleness, zero storage, no pause-breakable cron* — correctness is the whole point of the layer.
- **Adjacency DAG over closure table (D6):** trade O(1) ancestor reads (a CTE is trivial here) for canonical, mass-carrying, single-source-of-truth edges — closure tables duplicate truth, which is the defect class we're eliminating.
- **One command RPC per intent (D3):** trade ~8 small functions for explicit intent, free atomicity, and a clean authenticated-only write surface — each is independently TDD-able and is the surface Caps 1/8 need anyway.
- **`farm_id` now, switching later (D17):** trade ~20 lines of cheap-now schema for avoiding an expensive, leak-prone 18-table RLS retrofit.
- **EUDR precompute over live (D14):** trade real-time freshness (polygons change yearly, not per-request) for a deterministic, testable, $0, GDAL-independent verdict that keeps the UI buttery — forced by the broken managed-raster path, and the right risk posture regardless.
- **Decide the offline *contract* now, defer the *runtime* (D1/D2/D4/D5/D20):** trade a handful of NOT-NULL columns and a UUID mint port for making the future PWA a drop-in that writes zero new schema and invents zero new write path.

---

## 6. Flags for other tracks (do-not-fix, scope discipline)

1. **GreenLot track:** pin the `green_lots` PK type/name — `dds_submissions.green_lot_id` and `lot_nodes`(green) reference it un-FK'd until then. Also owns `ytd_revenue_usd` derivability (D12).
2. **Agronomy/processing track:** pin the washed green-from-cherry yield-loss tolerance (~16–20%) for the D7 conservation invariant's `≈`.
3. **Auth/edge-gateway track:** owns the future write-path INSERT RLS policy + device enrollment + the `app_role`/`farm_id` JWT-claim Auth Hook (the event schema is already auth-agnostic and ready; the `coalesce` fallback keeps today working).
4. **Andres (program owner):** (a) explicit apply-OK for M1/M2/M4 (extension + RLS + rename-aside); (b) backup scheduler choice (launchd vs free hosted cron) + the backup-role-vs-`force RLS` interaction before `scripts/backup.sh`; (c) seed-polygon basemap-tracing pass + `scripts/derive-terrain.mjs` must run before the map renders.
5. **Cross-cutting owner:** one owner for the shared hashing util (event-log ⇄ EUDR verdict) and one for the "every write is an event" backstop trigger — so parallel command-RPC agents don't each redefine them.
6. **Stale-baseline correction (§0):** the live RLS head is **`20260620140000_auth_required_rls.sql` (authenticated-only, anon revoked)** — every fragment that assumed anon public-read is rebased; new objects grant to `authenticated` only.

**Grounding files (all read-only, absolute):** `/Users/andres/coffee-farm-operations/supabase/migrations/20260620120000_init.sql`, `/Users/andres/coffee-farm-operations/supabase/migrations/20260620140000_auth_required_rls.sql` (the corrected RLS head the fragments missed), `/Users/andres/coffee-farm-operations/src/lib/types.ts`, `/Users/andres/coffee-farm-operations/src/lib/db/{trends,activity,plots,harvests,processing,tasks,workers}.ts`, `/Users/andres/coffee-farm-operations/src/lib/supabase/server.ts`, `/Users/andres/janson-coffee-INTEGRATION-INVESTIGATION.md`. **Proposed new artifacts:** migrations M1–M5 (`20260621090000`–`094000`), `src/lib/{ids.ts, db/{geo,events,lots,greenlots}.ts, events/schema.ts, commands/*.ts, integration/{port,queue,flush}.ts + adapters/*, eudr/{check,dds}.ts}`, `src/components/sections/audit/audit-drawer.tsx`, `scripts/{derive-terrain.mjs, eudr-verify.ts, backup.sh, verify-events-chain.sql}`.

### Domain Model (DDD)

Confirmed the grounding. Current migration max is `20260620140000`, `lots(code)` is the text-PK anchor with `lot_code` FKs already in place, and `batch_stage` enum already has the six stages the lot needs. Now I have what I need to resolve the contradictions decisively.

---

# Architecture Brief — Domain Model (DDD)
## Janson Coffee · Phase-1 SPINE

This section consolidates the five domain-model fragments (lot genealogy, bounded-context map, event model, GreenLot/ATP, costing, compliance) into one coherent, decisive design. It resolves three real contradictions across the fragments and locks the decisions the other tracks build against.

---

## 0. Contradictions resolved (read this first)

The fragments were authored in parallel and disagreed on three load-bearing points. Resolved here, once:

| Conflict | Positions in the fragments | **Locked resolution** |
|---|---|---|
| **Schema organization** | (a) one public schema, logical contexts as TS modules; (b) eight separate Postgres schemas (`land`, `harvest`, …, `graph`, `event`). | **One `public` schema; bounded contexts are TS module + Postgres-naming boundaries, NOT separate Postgres schemas.** Separate schemas add RLS-policy surface, grant complexity, and PostgREST exposure config for zero benefit on a single-tenant read-mostly app, and they fight the existing `init.sql` (everything in `public`). Context isolation is enforced by the `src/lib/contexts/<ctx>/` module boundary + a grep guard, not by DB schemas. (D-CTX-1) |
| **Migration timestamp** | All five fragments independently claimed `20260620150000`. | **One migration author, sequenced timestamps.** The graph is the foundation everything else FKs into, so it goes first. Locked sequence in §6. A single collision-free lane per the one-schema-author rule. |
| **Lot graph node identity** | (a) reuse `lots(code)` as the node PK, add columns; (b) new `lot_node(id, lot_code)` table + `lot_edge`; (c) `graph.lot_node`. | **Reuse `lots(code)` as the canonical node PK; add columns + one `lot_edges` table.** `harvests.lot_code` and `processing_batches.lot_code` already FK to `lots(code)`; a parallel `lot_node` table orphans those FKs and forces an ACL view. Promoting the existing anchor in place keeps every existing FK and mapper working. (D-LOT-1) |

Two naming alignments also locked: the edge kinds are **`split | merge | blend | process`** (the fragment that used `transform` is renamed to `process` — same meaning, the stage-advance edge); the event-log table is **`lot_event`** with a hash chain.

---

## 1. The governing decision

**Promote the bare `lotCode: string` into a mass-conserving provenance DAG anchored on the existing `lots(code)` table, derived from and validated by a single append-only hash-chained `lot_event` ledger. State tables hold current truth; derived SQL views hold all aggregates. This is "Event-Log-as-SSOT + CQRS-lite projections" — NOT classic event-sourcing.**

Every Phase-1 capability is a facet of this one spine:
- **#1 lot graph** = `lots` nodes + `lot_edges` (mass on every edge).
- **#4 derived metrics** = views over those rows (the existing hand-authored aggregate tables are demoted to views).
- **#5 GreenLot** = a `lots` node at `stage='green'` + grade/ATP columns — the **same node**, not a parallel identity.
- **#6 event log** = the `lot_event` ledger every write passes through.
- **#7 EUDR** and **#8 COGS** = read-only projections that walk the graph; they never write it.

---

## 2. Locked decisions (D-numbered)

### Identity & graph
- **D-LOT-1** — A **Lot is a continuant node**, PK = the existing `lots(code)` text id. `Harvest`, `ProcessingBatch`, `GreenLot` are **occurrents** that attach to it (Harvest mints it; ProcessingBatch references+advances it; GreenLot *is* it at `stage='green'`). No subtyping, no parallel node table.
- **D-LOT-2** — **Mass lives on edges.** `lot_edges(parent_lot, child_lot, kind ∈ {split,merge,blend,process}, kg, event_seq)`. Split = 1→N same coffee; merge = N→1 same variety; blend = N→1 differing (erases single-origin, `variety=NULL`, `is_single_origin=false`); process = stage advance carrying the yield-loss mass delta.
- **D-LOT-3** — **Lot codes are minted server-side, gap-free, collision-proof** via a sequence inside the intake transaction (`mint_lot_code() → 'JC-' || nextval(...)`). Split children suffix `-A/-B`; blends get `JC-BL-NNN`. Never client-generated.

### Consistency & enforcement
- **D-EVT-1** — **Event-Log-as-SSOT, not full event-sourcing.** `lot_event` is append-only + hash-chained (`prev_hash`, `hash`), immutable via a block-UPDATE/DELETE trigger. State tables are authoritative current-state, **never rehydrated by fold-on-read**. Rejecting classic ES is deliberate: fold-on-read reintroduces projection-lag — the same "screens disagree" defect, relabeled — at a cost the $0/no-worker stack can't pay. Time-travel remains available by filtering the log; we just don't pay for it on every read.
- **D-EVT-2** — **Events + state mutate in one transaction via one `SECURITY DEFINER` RPC** (`record_lot_event(...)`). On Supabase free-tier there are no queues/outbox workers — the DB transaction *is* the consistency boundary. This is the single write door; base tables get **no** INSERT/UPDATE grant to `authenticated`, preserving the existing SELECT-only RLS posture (`20260620140000`).
- **D-EVT-3** — **Idempotency + offline-readiness now, sync engine later.** Every event carries `event_uid` (client UUID), `idempotency_key`, and distinct `occurred_at` (field time) vs `recorded_at` (server time). One column each = the entire schema cost of being CRDT/outbox-ready; we build no sync engine in Phase-1.

### Derived truth
- **D-MET-1** — **All aggregates are SQL views, never writable tables.** `season_summary`, `daily_cherries`, `weekly_harvest`, `variety_shares` are demoted from hand-authored tables to `*_v` `security_invoker` views. The existing `src/lib/db/trends.ts` mappers keep their exact signatures — only the `.from()` target flips. A view *cannot* drift from its inputs; this is the structural kill of the #1 trust defect.
- **D-MET-2** — **Yield is a calibrated curve, never a constant.** Cherry→green ratio is per-method/per-variety in a `lot_yield_curve` table. Mass balance across a process edge is `|measured − in×yield_factor| ≤ tolerance` → **flags, does not block** (real loss must be recordable). A hardcoded 5.5:1 would false-positive every Natural and mask real loss on Washed.
- **D-UNIT-1** — **Mass is a UCUM value object normalized to kg before it touches the ledger.** One hardened `units/ucum.ts` converter (lata/quintal/bag/parchment-vs-green) — the single corrupt-everything trap, so one tested home. Hard co-requisite of D-MET-2's mass balance.

### Inventory
- **D-INV-1** — **GreenLot is the same node at `stage='green'` + grade/ATP columns**, materialized from a finished batch by `materialize_green_lot()` (the only GreenLot writer), linked via a `process` edge carrying `mass_kg`. Not an 8th `batch_stage`, not a parallel table.
- **D-INV-2** — **ATP is derived, never a stored counter.** `atp_kg = qty_green_kg − Σ(open reservations) − Σ(shipped)`, exposed as the `green_lots_atp` view. Reservations/shipments are **append-only claim rows** (`reserved → fulfilled|released|expired`), never decrements. A `prevent_oversell` `BEFORE INSERT/UPDATE` trigger makes double-selling a scarce micro-lot **physically impossible at the data layer** (fail-closed), not UI-discouraged.
- **D-INV-3** — **Grade is computed, not typed.** `sca_grade` is a generated column from `defect_count_full` + `moisture_pct` + `screen_size`. Geisha-as-commodity vs Best-of-Panama is a 100× price swing — grade is a money lever, so it's rule-derived and auditable, not free text.

### Costing & compliance
- **D-COST-1** — **One append-only `cost_entry` ledger; cost-per-kg-green is a derived view, never a stored column.** Each row tags a cost driver (worker-day | task | processing-batch) to an allocation target (`plot | lot | farm`). Four documented allocation rules: direct labor→lot; agronomy→plot then to lots by harvested-kg share; processing→lot; overhead→all green-kg pro-rata. Corrections are **reversing entries**, never UPDATE/DELETE — making the ledger the future QBO/Xero journal source and an audit trail in one. Green-kg denominator comes from the lot graph's terminal node (degrades to `processing_batches.current_kg WHERE stage='green'` until the graph lands).
- **D-CMP-1** — **Deforestation-free is a snapshotted `compliance_check` verdict, never a `plots` boolean.** A plot is EUDR-clear iff it has a current, non-expired check with `verdict='pass'`. The check pins its inputs (geometry version, baseline dataset + version, observation date) for reproducibility. The 2020 cutoff, geometry-precision floor, and validity window live in a `compliance_threshold` reference table — the law's parameters have one home.
- **D-CMP-2** — **`establishedYear` is a server-run establishment test, not advice.** `established_year ≤ cutoff_year` runs deterministically inside every check; a post-2020 plot is presumptively non-compliant regardless of satellite data.
- **D-CMP-3** — **The DDS is minted only via `issue_dds()` `SECURITY DEFINER` RPC** that gates on passing checks for every covered plot, freezes a `plot_check_snapshot`, computes a `payload_hash`, and writes a `DDS_ISSUED` event — all in one transaction. The UI's disabled button is courtesy; **the gate is in the database**. The deforestation determination sits behind a `DeforestationOracle` **port** — Phase-1 ships an establishment-only adapter ($0, no external call); GFW/JRC drops in later without reshaping.

### Boundaries
- **D-CTX-1** — **Six logical bounded contexts in one modular monolith, one Postgres DB.** Separation = `src/lib/contexts/<ctx>/` modules exposing typed ports + a grep guard (`_guard.test.ts`) that fails if a context reaches into another's tables. **Core:** Harvest, Processing, Inventory (provenance *is* the product). **Supporting:** Land & Geometry, Compliance, Costing (high-value projections that read the core). The **lot graph** is a Shared Kernel jointly owned by the three core contexts; the **event log** and **UCUM unit ledger** are shared substrate. The **semantic layer is explicitly not a context** — it's a read-only view projection.

---

## 3. Bounded-context map

```mermaid
flowchart TB
  subgraph SK["Shared Kernel / Substrate"]
    GRAPH["Lot Graph (lots nodes + lot_edges, mass on every edge)"]
    EVT["lot_event ledger (append-only, hash-chained)"]
    UNIT["UCUM unit/yield ledger"]
  end
  LAND["Land & Geometry (Supporting)"]
  HARV["Harvest (CORE)"]
  PROC["Processing (CORE)"]
  INV["Inventory / GreenLot (CORE)"]
  COMP["Compliance / EUDR (Supporting)"]
  COST["Costing (Supporting)"]
  SEM["Derived-Metrics Semantic Layer (views — NOT a context)"]

  LAND -->|Customer/Supplier: PlotGeometryRef DTO| HARV
  LAND -->|polygon + establishedYear| COMP
  HARV --> PROC --> INV
  HARV & PROC & INV -->|Shared Kernel| GRAPH
  HARV & PROC & INV & LAND -->|publish events| EVT
  GRAPH -->|Conformist (read graph as-is)| COMP
  GRAPH -->|Conformist| COST
  HARV & PROC -.->|labor/processing cost feed| COST
  GRAPH & COST & HARV --> SEM
  SEM -->|the ONLY source for season_summary / daily_cherries / weekly_harvest / variety_shares| UI["Glass UI screens"]
```

**Two Anti-Corruption Layers** protect the in-flight `feat/supabase-backend` work from a rewrite:
- **ACL-1 (Land):** legacy flat `Plot.altitudeMasl`/`areaHa` become **generated columns / view expressions** over the canonical polygon + DEM (`ST_Area`, DEM zonal mean). `mapPlot()` is unchanged; new consumers call a new `getPlotGeometry()` GeoJSON port. Old screens see scalars, new screens see polygons, one truth underneath.
- **ACL-2 (Graph):** `lots(code)` stays the PK and the `lot_code` FKs keep working untouched while new code traverses `lot_edges`. Auto-minting happens behind `intake_cherry()`.

---

## 4. The lifecycle (cherry → process → green → inventory → EUDR/COGS)

```mermaid
graph LR
  P[Plot polygon] -->|intake_cherry| H[Lot JC-564 • cherry • 480kg<br/>mints code + LotMinted event]
  H -->|split kg=300| A[JC-564-A Washed]
  H -->|split kg=180| B[JC-564-B Natural]
  A -->|process kg=54 • yield 0.18 ✓| GA[JC-564-A green • GreenLot]
  B -->|process kg=36 • yield 0.20 ✓| GB[JC-564-B green]
  GA -->|materialize_green_lot| INV[GreenLot: grade/screen/moisture<br/>location + ATP]
  INV -->|reserve / ship claim rows| ATP[atp_kg = qty − reserved − shipped]
  GA -. read-only walk .-> EUDR[issue_dds: gate on plot checks → DDS_ISSUED]
  GA -. read-only walk .-> COGS[lot_cogs: direct_usd / green_kg]
  style H fill:#00291D,color:#fff
```

**Command → event → read-model catalogue:**

| Flow | Command | Event(s) on ledger | Powers read |
|---|---|---|---|
| Intake | `RecordCherryIntake` | `CherryReceived` + `LotOpened` (auto-mint) | activity feed, `daily_cherries_v` |
| Process | `AdvanceBatchStage` | `BatchStageAdvanced` (mass Δ, yield check) | pipeline board, drying curve |
| Genealogy | `SplitLot`/`MergeLots`/`BlendLots` | `LotSplit`/`LotMerged`/`LotBlended` (+`lot_edges`) | lineage graph |
| Green | `PromoteToGreenLot` | `GreenLotCreated` | inventory grid, ATP |
| Green | `Reserve…`/`AdjustGreenStock` | `GreenStockReserved`/`GreenStockMoved` | ATP |
| EUDR | `GenerateEUDRStatement` (assembler) | `DDS_ISSUED` only on success | DDS export |
| COGS | `RollUpLotCost` (assembler) | *(none — pure projection)* | cost-per-kg-green |

EUDR and COGS emit no mutation when *reading* (COGS none at all; EUDR only the issuance event) — a compliance statement must never mutate the record it attests to.

---

## 5. Consolidated schema (additive, sequenced migrations)

All additive, all `public`, all `security_invoker` views + SELECT-only RLS mirroring `20260620140000`. Writes flow only through `SECURITY DEFINER` RPCs.

```sql
-- ============ 20260620150000_lot_graph_and_event_log.sql ============
-- Foundation: promote lots() to nodes, the edge table, the ledger, the yield curve.
create type lot_stage  as enum ('cherry','fermentation','drying','parchment','milled','green'); -- mirrors batch_stage
create type edge_kind  as enum ('split','merge','blend','process');
create type lot_event_type as enum (
  'CherryReceived','LotOpened','BatchStageAdvanced','ReposoGatePassed',
  'LotSplit','LotMerged','LotBlended','GreenLotCreated','GreenStockMoved','GreenStockReserved');

alter table lots
  add column variety          coffee_variety,                 -- null ⇒ blend
  add column stage            lot_stage   not null default 'cherry',
  add column origin_kg        numeric     not null default 0 check (origin_kg  >= 0),
  add column current_kg       numeric     not null default 0 check (current_kg >= 0),
  add column is_single_origin boolean     not null default true,
  add column root_plot_ids    text[]      not null default '{}',
  add column minted_at        timestamptz not null default now();

create table lot_event (
  seq bigint generated always as identity primary key,
  event_uid uuid not null unique, idempotency_key text not null unique,
  lot_code text not null references lots(code), type lot_event_type not null,
  occurred_at timestamptz not null, recorded_at timestamptz not null default now(),
  actor text references workers(id), mass_kg numeric, payload jsonb not null default '{}',
  prev_hash text, hash text not null);
create index lot_event_lot_idx on lot_event(lot_code, seq);
-- + _lot_event_immutable() trigger blocking UPDATE/DELETE

create table lot_edges (
  id bigint generated always as identity primary key,
  parent_lot_id text not null references lots(code),
  child_lot_id  text not null references lots(code),
  kind edge_kind not null, kg numeric not null check (kg > 0),
  event_seq bigint not null references lot_event(seq),
  check (parent_lot_id <> child_lot_id));
create index lot_edges_parent_idx on lot_edges(parent_lot_id);
create index lot_edges_child_idx  on lot_edges(child_lot_id);

create table lot_yield_curve (
  method process_method, variety coffee_variety, from_stage lot_stage, to_stage lot_stage,
  yield_factor numeric not null check (yield_factor > 0 and yield_factor <= 1),
  tolerance_pct numeric not null default 8,
  primary key (method, variety, from_stage, to_stage));

create sequence lot_code_seq start 565;
-- mint_lot_code(), intake_cherry(), advance_stage(), record_lot_event() RPCs (SECURITY DEFINER)

-- ============ 20260620160000_green_inventory.sql ============
create type green_lot_status   as enum ('resting','graded','available','depleted');
create type reservation_status as enum ('reserved','fulfilled','released','expired');
alter table lots
  add column screen_size integer, add column moisture_pct numeric, add column water_activity numeric,
  add column defect_count_full numeric, add column cup_score numeric,
  add column warehouse_id text, add column bin_id text,
  add column green_status green_lot_status,
  add column sca_grade text generated always as (        -- D-INV-3: computed grade
    case when defect_count_full is null or moisture_pct is null then null
         when defect_count_full <= 5 and moisture_pct between 9 and 12   then 'Specialty Grade'
         when defect_count_full <= 8 and moisture_pct between 9 and 12.5 then 'Premium Grade'
         when defect_count_full <= 23 then 'Exchange Grade' else 'Below Grade' end) stored;
create table lot_reservations (id text primary key, lot_code text not null references lots(code),
  qty_kg numeric not null check (qty_kg > 0), buyer_ref text not null,
  status reservation_status not null default 'reserved', expires_at date, created_at timestamptz default now());
create table lot_shipments (id text primary key, lot_code text not null references lots(code),
  reservation_id text references lot_reservations(id), qty_kg numeric not null check (qty_kg > 0), shipped_date date not null);
create view green_lots_atp with (security_invoker=on) as  -- D-INV-2: derived ATP, single canonical number
  select l.*, /* reserved_kg, shipped_kg, */ l.current_kg
    - coalesce((select sum(r.qty_kg) from lot_reservations r where r.lot_code=l.code and r.status='reserved'),0)
    - coalesce((select sum(s.qty_kg) from lot_shipments s where s.lot_code=l.code),0) as atp_kg
  from lots l where l.stage='green';
-- + prevent_oversell() BEFORE INSERT/UPDATE trigger (fail-closed)

-- ============ 20260620170000_costing.sql ============
create type cost_category as enum ('labor','processing','input','overhead');
create type cost_basis    as enum ('per_kg_cherry','daily','hourly','flat');
create table cost_entry (id text primary key, occurred_on date not null, category cost_category not null,
  basis cost_basis not null, amount_usd numeric not null check (amount_usd >= 0), currency text not null default 'USD',
  worker_id text references workers(id), task_id text references tasks(id), batch_id text references processing_batches(id),
  target_kind text not null check (target_kind in ('plot','lot','farm')),
  plot_id text references plots(id), lot_code text references lots(code), note text, created_at timestamptz default now());
-- NO updated_at / NO delete: corrections are reversing entries
create view lot_cogs with (security_invoker=on) as /* direct_usd / green_kg → cost_per_kg_green_usd */ ;

-- ============ 20260620180000_compliance.sql ============
-- compliance_threshold (canonical law params) + compliance_check (snapshotted verdict)
-- + dds + plot_eudr_status view + run_compliance_check()/issue_dds() RPCs.
-- plot_geometry is OWNED BY THE POSTGIS TRACK — see §7 coordination, authored once there.
```

**Demotion migration** (after the views above exist): drop the writable `season_summary`/`daily_cherries`/`weekly_harvest`/`variety_shares` tables and recreate as `*_v` views; flip `src/lib/db/trends.ts` `.from()` targets only.

---

## 6. Migration sequencing (one author, collision-free)

Current prod/repo max is `20260620140000`. Locked sequence — strictly increasing, foundation-first so each FKs into the prior:

1. `20260620150000_lot_graph_and_event_log.sql` — nodes + edges + ledger + yield curve + mint/intake/advance/record RPCs. **Foundation; everything else depends on it.**
2. `20260620160000_green_inventory.sql` — GreenLot columns + reservations/shipments + ATP view + oversell trigger.
3. `20260620170000_costing.sql` — cost ledger + rollup views.
4. `20260620180000_compliance.sql` — thresholds + checks + DDS + RPCs (coordinates with PostGIS track for `plot_geometry`).
5. `20260620190000_demote_aggregates_to_views.sql` — drop hand-authored aggregate tables, recreate as views.

Per the one-schema-author rule this is a single serialized lane — no parallel migration authoring. The recursive blend/split mass-weighting function for COGS ships *inside* migration #1's RPC set (where the graph lives), not in #3.

---

## 7. Module layout (extends `src/lib/db/*`, never forks)

```
src/lib/
  domain/                         ← pure TS, node-vitest, no I/O (the TDD core)
    events.ts                     ← LotEvent union (1:1 with lot_event_type)
    units/ucum.ts                 ← D-UNIT-1 converter (heavily tested)
    invariants/{massBalance,yieldCurve}.ts
    commands/{recordCherryIntake,split,merge,blend,advanceStage}.ts
    ports/{lotEventStore,deforestationOracle}.ts
  contexts/{land,harvest,processing,inventory,compliance,costing,event}/port.ts
  contexts/_guard.test.ts         ← fails if a context imports another's table name
  db/                             ← EXISTING read-adapter pattern (mapX + cache() + getSupabase)
    {lotEvents,greenLots,cogs,compliance}.ts   ← new adapters mirroring processing.ts
```

Existing `src/lib/db/{plots,harvests,processing,trends}.ts` become thin re-exports during migration so nothing downstream breaks and PRs review in slices. Command handlers depend on **ports**, not Supabase — TDD-able with fakes in the current node env, no DB needed for red→green.

---

## 8. World-class UI surfaces (the non-negotiable bar)

Every projection maps to an Apple-grade liquid-glass surface, **mostly Server Components**, GPU transform/opacity only, glass skeletons, `prefers-reduced-motion`, WCAG AA on translucent forest `#00291D`, reusing the locked `glass-card`/`stagger`/`animate-rise`/`cv-auto`/`perf-contain` primitives:

- **`<LotLineage>` (the Shared Kernel made visible)** — chosen design is a **server-laid-out Sankey-style ribbon**, NOT force-directed. Layout computed in the Server Component from `lot_edges` via one recursive CTE → static SVG; **edge `stroke-width ∝ kg`** so mass-carried is literally visible; deterministic (provenance looks identical every load); ~0KB interactive JS beyond keyboard focus traversal. Flagged yield anomalies pulse amber (motion-safe). Reused on lot detail, the MapLibre plot click-through, and the EUDR preview. *(Rejected: react-flow — 50KB+, physics jank on field phones, non-deterministic layout.)*
- **Lot Passport** — vertical glass timeline projection of `lot_event`, hash-chain rendered as a subtle "verified" sheen. The buyer/auditor artifact.
- **GreenLot inventory grid** (`/inventory`) — dense glass table; a **dual-bar ATP meter** (committed vs available) as stacked `transform: scaleX()` fills; reservation drawer is the one client island, calling a Server Action whose `prevent_oversell` trigger surfaces oversell as a clean glass toast — the UI cannot create a double-sell.
- **COGS** (`/costing`) — cost-decomposition bars (labor|processing|agronomy|overhead) as pure CSS flex widths; per-lot waterfall reveal under `stagger`; every figure links to its `cost_entry` provenance.
- **Compliance** (`/compliance`) — readiness board driven by the `plot_eudr_status` view's single `ui_state` enum (clear/unverified/expired/blocked/indeterminate); state never conveyed by color alone (icon + label).
- **Activity feed** — now a pure projection of `lot_event` (the `activity` table is retired) → can never disagree with the timeline.

The semantic-layer view-swap (D-MET-1) means **dashboard numbers reconcile by construction** — no screen ever shows two different "harvested kg" again.

---

## 9. TDD plan (every PR ships a failing-first test — repo hard rule)

Lowest layer that catches the root cause:
1. **Pure domain** — `units/ucum.ts` (lata/quintal/parchment-vs-green), `massBalance`/`yieldCurve` (Natural-within-curve NOT flagged, Washed-30%-loss IS), `commands/*` against fake stores (emits correct events, auto-mints code). Node, no DB.
2. **Keystone gates, written red first** — `prevent_oversell` rejects over-commit; `issue_dds` raises + rolls back (no `dds` row, no event) when any plot unverified/expired/failed, and freezes the snapshot.
3. **Mappers/getters** — `Number()` coercion of numeric-as-string, mirroring `mappers.test.ts`.
4. **Static guards** (no-CI local gate): migration contains the immutability/oversell triggers; `record_lot_event` is `SECURITY DEFINER` with base tables ungranted for write; `compliance-no-honor-flag` bans settable `deforestation_free`/`is_compliant` booleans + direct `dds`/`compliance_check` inserts. Each must fail on a planted violation.
5. **UI render/smoke** (jsdom + @testing-library, already wired) — `<LotLineage>` ribbon width reflects kg; GreenLot ATP meter; compliance badges; reduced-motion path renders without animation classes.

---

## 10. Free-tier reality ($0 forever, 500MB ceiling — honest)

The lot graph, cost ledger, inventory, and DDS are all **inherently low-cardinality** for a single estate — low thousands of rows/season, single-digit MB/year. None threatens the 500MB cap; derived views are cheap indexed GROUP-BYs. **The real space risk is the PostGIS DEM and any future IoT/sensor stream** (the report's #5) — keep telemetry in a *separate* partitioned table, never in `lot_event`. The 7-day idle-pause is a hosting trait unchanged by this design; a single page-load wakes the read-mostly projection (mitigation is a platform/DevOps-track call, not ours).

---

## 11. Flags for adjacent tracks (out of scope — not built)

- **PostGIS track owns `plot_geometry`.** Compliance and the `<LotLineage>` map click-through both need the polygon; author the geometry table **once** in the PostGIS migration (one-schema-author lane), not duplicated in the compliance migration. ACL-1's generated `area_ha`/`altitude_masl` columns depend on it.
- **Event-log envelope shape** (`event_uid`, `prev_hash`/`hash` algorithm, `payload` schema per type) is shared substrate — lock the envelope with the Platform track; `lot_edges.event_seq` and `dds`/`cost_entry` events all point at it.
- **`lot_yield_curve` seed values, SCA grade thresholds, and the EUDR allocation/overhead rule** are defensible placeholders — flag for Janson's agronomy/house-standard review before seed.
- **TRACES-NT submission + real GFW/JRC oracle** are future-phase fills behind `DeforestationOracle`; Phase-1 ships schema + snapshotting + fail-closed gate + establishment-only verdict so neither requires reshaping.
- **Blended-payroll worker-day computation** (per-kg vs daily vs minimum-wage make-whole) is the People-domain track; Costing consumes the resulting `cost_entry`, doesn't derive it.

**Grounding (read-only):** `/Users/andres/coffee-farm-operations/src/lib/types.ts`, `/Users/andres/coffee-farm-operations/supabase/migrations/20260620120000_init.sql`, `/Users/andres/coffee-farm-operations/supabase/migrations/20260620140000_auth_required_rls.sql`, `/Users/andres/coffee-farm-operations/src/lib/db/{harvests,processing,trends,plots,workers}.ts`, `/Users/andres/janson-coffee-INTEGRATION-INVESTIGATION.md`. **Proposed new migrations (sequenced, §6):** `20260620150000`→`20260620190000`.

### Application Architecture

I am the Track Lead for Application Architecture. Let me consolidate the six design fragments into one coherent, decisive section. I have everything I need in the dossier — these fragments overlap heavily and contain a few real contradictions I must resolve. No repo reads needed; the fragments already did the grounding.

The contradictions I must resolve before writing:

1. **Caching strategy conflict.** Fragment 2 (App Router) proposes per-surface ISR tiers (`revalidate=300`, `force-static`, keeping `force-dynamic` global). Fragment 6 (derived-metrics) proposes dropping global `force-dynamic` and using `unstable_cache` + `revalidateTag`. These must be reconciled into one policy.

2. **Write-path module organization.** Fragment 1 puts use cases in `src/modules/<m>/service.ts` with injected ports; Fragment 3 (data-access) puts commands in `src/lib/db/commands/*` extending the existing `src/lib/db/*` pattern. One must win.

3. **Module structure conflict.** Fragment 1 proposes `src/modules/` with ESLint-enforced boundaries; Fragment 7 (reuse) says the existing `src/lib/db/*` IS the ports layer — extend in place, don't create `src/modules/`. Direct contradiction on the biggest structural decision.

4. **Geometry storage.** Fragment 5 (MapLibre) proposes a side table `plot_geometry`; Fragment 7 proposes adding columns to `plots`. Must pick one.

5. **types.ts split.** Fragment 7 proposes splitting into a barrel; others assume single file.

Let me write the consolidated section now, resolving each.

# Application Architecture — Phase-1 SPINE (Consolidated Track Brief)

**Track Lead consolidation.** This section locks the application-architecture decisions for the Phase-1 SPINE, resolves the contradictions across the six design fragments, and hands the schema/geo/design-system tracks the seams they plug into. The governing principle is the one all six fragments converged on independently: **the existing read path (`Server Component → src/lib/db/*.ts getter → getSupabase() → PostgREST`, with pure `mapX` mappers and a frozen domain contract) is already an accidental ports-and-adapters layout. We extend it; we do not rebuild it.** Every decision below is scored against the #1 quality attribute — world-class liquid-glass UI at 60fps — and the $0/Supabase-free-tier ceiling.

---

## Locked decisions (D-numbered)

### D1 — Extend `src/lib/db/*` as the port layer; do NOT introduce `src/modules/`
**Resolves the structural contradiction (Fragment 1 vs Fragment 7).** Fragment 1's `src/modules/` + ESLint-boundary proposal is the textbook modular-monolith answer, but it is **over-engineering for this codebase**: the existing functional read-repository (`getPlots()` etc.) is already stateless, `cache()`-correct, RLS-correct, and pinned by `getters.test.ts`/`mappers.test.ts`. Moving it into `src/modules/land/adapters/...` would churn every import and break those tests to buy a boundary a solo $0 app does not need. **The port is the TypeScript module surface of `src/lib/db/*.ts` (functions returning domain types); the adapter is the Supabase call inside; the contract is `src/lib/types/*`.** Each new Phase-1 entity gets **one new sibling port file** in the exact existing shape (`Row` interface + pure `mapX` + getter). The ports-and-adapters *intent* (dependency inversion, swappable adapter for the future offline phase) is satisfied by one enforced rule, not a folder tree:

> **The boundary rule:** nothing under `src/app/**` or `src/components/**` may import `getSupabase` or call `.from()`/`.rpc()` directly. App code imports only `src/lib/db/*` functions. Enforced by a grep-style guard unit test (Fragment 3 §8 / Fragment 1's lint intent, realized as a test since there is no CI).

### D2 — Writes: Server Actions → thin `command()` helper → one `SECURITY DEFINER` RPC that mutates **and** appends the event in a single transaction
**Resolves the write-path organization contradiction (Fragment 1 vs Fragment 3) in favor of Fragment 3**, because it stays inside the D1 pattern. The new write side lives at `src/lib/db/commands/*.ts` (symmetric twin of the read getters) and `src/app/(app)/**/actions.ts` (`"use server"` thin wrappers). The non-negotiable core: **mutation + event-log append = one Postgres RPC = one transaction.** Free-tier Postgres has no client-side multi-statement transaction across HTTP, so two PostgREST calls (insert row, then insert event) can leave a state change with no audit row and a broken hash chain — the exact trust defect this phase exists to kill. The transaction boundary therefore lives in a `plpgsql SECURITY DEFINER` function, granted `EXECUTE` to `authenticated` only (`REVOKE` from `anon`). Reads stay direct-table + RLS; **writes are RPC-gated**. Validation is doubled by design: Zod in the command for typed, friendly form errors; SQL `raise`/`CHECK` as the actual enforcement (promise → enforced at the data layer, never honor-system UI).

### D3 — Driving ports: Server Actions for all mutations; Route Handlers only for non-HTML outputs
Server Actions are the React 19 / Next 15 idiom — progressive-enhancement forms (work before hydration), no bespoke client fetch layer, tiny JS bundle, cookie session already wired by `getSupabase()`. Route Handlers (`app/api/.../route.ts`) are reserved for the two things Actions cannot return: the **EUDR file download** (`Content-Disposition` on the GeoJSON) and any future webhook. A Server Action is only ever invoked by an authenticated human submitting a form — combined with D2's grant model, no agent or inbound text can reach a write path.

### D4 — Derived metrics become `security_invoker` SQL **views**, not materialized; the four hand-authored aggregate tables are dropped
**The #1 trust fix, delivered with zero port-signature or UI change.** `season_summary`, `daily_cherries`, `weekly_harvest`, `variety_shares` are dropped as tables and recreated as `security_invoker` views of **identical column shape**, computed from `harvests`/`processing_batches`/`green_lots` rows. The `db/trends.ts` getters, the `mapSeason`/`mapTrend`/`mapVarietyShare` mappers, and every dashboard component and test stay byte-identical — the swap is entirely behind the seam. Plain views (not materialized) win the explicit trade-off: at family-farm scale (hundreds of rows) a `SUM`/`GROUP BY` is sub-millisecond and **always correct**; a materialized view re-introduces a refresh step that can drift/fail, cannot be `security_invoker` (RLS-bypass risk), and has no reliable cron on a tier that pauses after 7 days idle. This structurally fixes the concrete defect — `KpiRow`'s headline `SEASON.todayKg` and its sparkline today read two independent hand-typed tables; post-fix both resolve to one `SUM(harvests.cherries_kg WHERE date=today)` definition and **cannot disagree**.

**COGS is the one exception that earns a materialized view** (`mv_lot_cost`): per-lot activity-based cost is a recursive walk down the lot-genealogy graph apportioning labor/task/processing cost over green-kg output. It refreshes (`REFRESH MATERIALIZED VIEW CONCURRENTLY`) only on the same write path that invalidates the cache tag (D5). It is served through thin `security_invoker` functions `cogs_per_lot(lot_code)` / `cogs_per_plot(plot_id)` via `supabase.rpc(...)`.

### D5 — Caching: drop blanket `force-dynamic`; cache *derived* reads with `unstable_cache` + tag invalidation; keep *raw operational* reads dynamic
**Resolves the caching contradiction (Fragment 2 per-surface ISR vs Fragment 6 tag-based).** The reconciled policy, because the actual scarce resource on the free tier is **DB round-trips and the 7-day idle pause**, not compute:

| Surface | Policy | Mechanism |
|---|---|---|
| Raw operational reads (plots, harvests, tasks lists) | dynamic, always fresh | `noStore()` / `cache()` per-request |
| Derived metrics (dashboard KPIs, trends, variety mix) | event-driven freshness | `unstable_cache(fn, key, { tags:['metrics:harvest'], revalidate: 1800 })` |
| Per-lot/plot COGS | event-driven | `unstable_cache(..., { tags:['metrics:cogs'] })` over the matview |
| Map base geometry | event-driven, rarely changes | `unstable_cache(..., { tags:['geometry'] })` |
| EUDR statement | static, on-demand, byte-stable | `dynamic='force-static'` + regenerate busts tag |
| Activity feed | dynamic | always fresh (append-only) |

Each write Server Action calls `revalidateTag('metrics:*')` after its RPC, so every dependent number recomputes from rows on the next read; the `revalidate: 1800` is a self-healing safety net for a forgotten tag. The data cache **survives the idle-pause** (a cold farm loads metrics from cache, not a waking DB). The single component-tree change outside `src/lib/`: `(app)/layout.tsx` drops `export const dynamic = "force-dynamic"`, and the raw operational getters opt into freshness explicitly via `noStore()` — coordinate this with the `db/{harvests,tasks,plots}.ts` owner so they don't get accidentally stale-cached. (Fragment 2's per-surface tiering is subsumed: tags give event-driven freshness where ISR gave only time-based, blind refresh.)

### D6 — PostGIS geometry lives in a **side table `plot_geometry`** keyed by `plots.id`; flat scalars are retained as derived-backfilled columns
**Resolves the geometry-storage contradiction (Fragment 5 side-table vs Fragment 7 columns-on-plots) in favor of the side table.** A side table keeps the frozen `plots`/`PlotRow`/`mapPlot` contract and all 50+ consuming components untouched, lets a plot exist before its polygon is surveyed, and isolates the heavy `geometry`/DEM columns from the daily-read row. `area_ha`/`altitude_masl` stay on `plots` as **derived-but-retained** (backfilled from `ST_Area(geom::geography)` / DEM by the geo track) so nothing that reads them breaks. The 200-ha reserve is a first-class `protected_areas` table (no plot field models a non-producing protected polygon). Geometry is served to the map as a **server-computed GeoJSON FeatureCollection** via a `plots_geojson` view (`ST_AsGeoJSON(geom, 6)` — ~10 cm precision, single-digit KB for ~25 plots), read in a Server Component and passed to the map island as a prop — **no PostGIS or Supabase call ever runs client-side**.

### D7 — Lot genealogy: reuse `lots.code` (text PK) as the canonical node; add the graph as new `lot_nodes`/`lot_edges` with mass on every edge
The degenerate `lots(code)` table is promoted in place (add `kind`, `variety`, `minted_from`, `created_at`) — preserving every existing FK and the human `JC-564` ids (no surrogate-UUID renumber; the SSOT "canonical id per real-world thing" intent is **already satisfied** by the text PKs). The genealogy is the one unavoidable new relation: `lot_edges(parent, child, op ∈ {split,merge,blend,mill,roast}, mass_kg)` with **`CHECK (mass_kg >= 0)` and a server-side mass-conservation guard** (`sum(child mass) <= parent mass`) enforced in the split/merge/blend RPCs. Auto-mint on cherry intake is a `BEFORE INSERT` trigger on `harvests` that mints `JC-<next>`, creates the root node/edge, and appends a harvest event — all inside D2's transaction. A **GreenLot is a lot node** (`green_lots.code → lots.code`) promoted via a `mill` edge, reusing the graph rather than inventing a second linkage.

### D8 — Append-only `events` table (hash-chained) is the substrate; the activity feed becomes a view projecting it
`events(seq, at, kind, subject, payload jsonb, prev_hash, hash)` with `hash = sha256(seq||at||kind||subject||payload||prev_hash)` computed inside the `emit_event()` definer function. Immutability is DB-enforced: `REVOKE insert/update/delete` from `authenticated` (only the definer inserts) plus `DO INSTEAD NOTHING` rules on update/delete. The existing `activity` table is replaced by a `security_invoker` view projecting `events` into the existing `ActivityItem` shape — `getActivity()` and `activity-feed-card.tsx` are **unchanged**; the feed becomes event-driven for free, and every later phase (EUDR, COGS, GreenLot) appends into the same chain.

### D9 — Split `src/lib/types.ts` into a `src/lib/types/` barrel
The only structural CREATE. `index.ts` re-exports `plot.ts`, `harvest.ts`, `lot.ts`, `green-lot.ts`, `event.ts`, `metrics.ts`. Existing `@/lib/types` imports keep working; new lot-graph/GreenLot/event types land as file-disjoint new files so parallel agents don't serialize on one 140-line contract.

### D10 — Layering: derived **truth** in SQL, **presentation** in TS
Metrics, COGS, EUDR mass-balance, the deforestation verdict → SQL views/functions (one definition = every screen reads the same row = the trust property is *structural*, not disciplinary, and respects RLS automatically). Formatting, genealogy-graph layout, GeoJSON shaping, map styling → TS in/above the port (refactorable, testable in jsdom without a DB).

---

## Component & route architecture

**Route tree (extends the `(app)` group; one new route group only where layout policy diverges):**

```
src/app/(app)/
  layout.tsx            # shell; drops global force-dynamic (D5)
  page.tsx              # dashboard — reads DERIVED views (D4)
  plots/[plotId]/       # NEW deep-link target from the map
  lots/[lotCode]/       # NEW lot-genealogy (SVG graph island)
  inventory/            # NEW GreenLot available-to-promise
  costs/                # NEW activity-based COGS
  exports/eudr/[lotCode]# NEW EUDR workbench (+ api/eudr/[lot]/geojson route handler)
  activity/             # NEW full event-log feed
  (spatial)/map/        # NEW full-bleed group; @sheet parallel + (.)plots/[plotId] intercept
```

The **map is the spatial index**, `/` stays the numeric dashboard (don't hijack `/` — keep deep links and muscle memory). The map's `@sheet` parallel route + `(.)plots/[plotId]` intercept is the one non-obvious App Router feature the spine needs: clicking a polygon slides a glass detail sheet over the map **without unmounting the WebGL context** (expensive to re-init), while a hard load of `/plots/[plotId]` still renders the standalone page — shareable deep links for free.

**Server/Client boundary — exactly three client islands; everything else stays a Server Component:**

| Island | Why client-only | Isolation |
|---|---|---|
| `FarmMap` (MapLibre GL `5.24.0`, **vanilla — no react-map-gl**) | WebGL canvas | `next/dynamic(ssr:false)` + glass map skeleton; ~230 KB chunk on `/map` only |
| `LotGraph` | interactive pan/zoom over an **SSR SVG** sankey/tree (rendered like `donut.tsx`; no graph lib) | `next/dynamic`; loads only on `/lots/[lotCode]` |
| `EntryForm` / PDF island | controlled inputs + optimistic UI; `@react-pdf/renderer ^4` client-side (no server Chrome) | small; one shared primitive driving Server Actions |

Boundary rules: data crosses as already-mapped domain objects (never PostgREST rows); geometry crosses as **trimmed GeoJSON**, not full `Plot[]`; islands receive serializable props only (Server Actions passed as props, never imported into the island graph); no `"use client"` on a layout. Map interaction (hover/select/camera) uses MapLibre **`feature-state` + paint expressions** — GPU repaint inside the canvas, never a React re-render — which is what guarantees 60fps; `cooperativeGestures: true` so page scroll stays smooth.

**Streaming:** keep a hand-authored glass `loading.tsx` on every route (instant route-transition skeleton, layout-faithful → zero CLS — map-shaped for the map, faint-nodes for the graph, never a spinner), **plus** granular `<Suspense>` boundaries inside slow pages so the shell + cheap content (legend, KPI row, header) paint immediately while the expensive query (geometry, derived aggregation, COGS, graph slice) streams behind its own fallback.

---

## New ports & schema deltas (the seams sibling tracks plug into)

**New port files (each mirrors `db/plots.ts`: `Row` + pure `mapX` + getter):** `db/lots.ts` (`getLotGenealogy → {nodes, edges}`), `db/green-lots.ts`, `db/events.ts` (reads direct; writes only via `appendEvent()` RPC), `db/cogs.ts`, `db/geometry.ts` (GeoJSON FeatureCollection + protected areas), `db/eudr.ts` (`getEudrDossier(lotCode)`); `db/trends.ts` keeps its signatures (views swap underneath). New write side: `db/commands/{recordHarvest,advanceBatch,splitLot,blendLots,gradeGreenLot,generateDDS,...}.ts` + `src/app/(app)/**/actions.ts`. One adapter addition: `getActor()` in `supabase/server.ts` (no service-role client, ever — RLS + definer RPCs are the complete enforcement surface).

**Migrations (additive, timestamps strictly after `20260620140000`, each appends its tables to the RLS loop):**
1. `lot_graph_events` — promote `lots`; `lot_edges` (mass-guarded); `events` (hash-chained, append-only); intake trigger + `emit_event()`/`appendEvent()`.
2. `geometry_greenlots` — `create extension postgis`; `plot_geometry` side table + `protected_areas`; `plots_geojson` view; `green_lots` (with generated `available_kg = weight_kg - reserved_kg`).
3. `semantic_layer_eudr` — drop the 4 aggregate tables → `security_invoker` views; `mv_lot_cost` + `cogs_per_lot/plot()`; `activity` → view over `events`; `deforestation_checks` (keyed `(plot_id, geom_hash)` so a re-drawn polygon yields a new verdict) + append-only `dds_exports`.

---

## Reuse Analysis (the hard gate)

| Capability | Existing overlap | Decision | Action |
|---|---|---|---|
| 1. Lot graph | `lots(code)`, `lotCode` FKs | **EXTEND `lots` + NEW `lot_edges`** | reuse text PK; graph is the only forced new relation |
| 2. PostGIS | `plots` flat scalars | **EXTEND via side table `plot_geometry`** (D6) | scalars retained, derived-backfilled |
| 3. Map | dashboard, sidebar, glass utils | **NEW `/map` route + island; EXTEND shell** | only large client island added |
| 4. Semantic layer | 4 aggregate tables, `db/trends.ts` | **EXTEND ports, REPLACE table bodies with VIEWS** (D4) | zero port/UI change |
| 5. GreenLot | pipeline dead-ends at `green` | **NEW `green_lots` (= a lot node)** | promoted via `mill` edge |
| 6. Event log | `activity` table + `getActivity()` | **NEW `events`; EXTEND activity as VIEW** (D8) | feed unchanged |
| 7. EUDR | `established_year`, geometry | **NEW route + RPC** | reuses polygon; verdict pre-computed offline |
| 8. COGS | `workers`/`tasks`/`processing` + graph | **NEW `mv_lot_cost` view + port** | pure computation, no new captured data |

**`feat/supabase-backend` to build on:** `getSupabase()` (verbatim, one client), the `security_invoker` view pattern (`harvests_view`/`tasks_view`), the RLS loop array, `mappers.test.ts`/`getters.test.ts` patterns, and the existing text PKs (canonical-id intent already met).

---

## World-class UI commitments (the #1 quality attribute, baked into the boundaries)

The split keeps the render path Server-Component-first (tiny JS bundle preserved); only the three islands ship client JS. The lot-genealogy graph and the map both read the **same `getLotGenealogy()`** port → one source, two visualizations that cannot disagree (trust applied to viz). The genealogy graph is an SSR SVG sankey (edges' stroke-width ∝ `mass_kg`, brand `#00291D`, the `donut.tsx` gloss `<defs>`) with a thin pan/zoom island — near-zero JS. Map chrome (filter chips, plot drawer, EUDR workbench, inventory table) is all Server Components reusing `Card`/`Badge`/`ProgressBar`/`page-header`. Every new surface ships a layout-faithful glass skeleton (CLS = 0), GPU-only motion, `prefers-reduced-motion` honored, and WCAG-AA contrast carried by opaque inner chips (verdict pills, map labels) never by text-on-blur. Field forms use Server Actions + `useActionState` for progressive-enhancement optimistic glass feedback. No chart/graph library is added beyond MapLibre.

---

## Free-tier ceiling — honest call

The architecture is free-tier-safe by construction: PostGIS for ~25 plots + one reserve is single-digit KB at rest; `events` at ~hundreds/season is ~tens of KB/yr — both rounding errors against 500 MB (keep `events.payload` to scalars/refs, blobs go to Storage by URL). The two real constraints drive specific decisions: **(a) the 7-day idle pause** → D5's tag-cache survives it, plain (non-materialized) views need no cron to recompute on wake, and the EUDR/DEM/deforestation external calls happen **once at geometry creation** (cached in columns), never per-request; downloaded DDS/GeoJSON artifacts never depend on the DB being awake. **(b) No background workers / no CI** → D2 puts the event append *inside* the write RPC (no queue), COGS/metrics recompute on-demand in a Server Action (no cron), and the quality gate is local `npm run build && npm run test` with a fixture test asserting `getSeason()` equals a hand-summed seed (the regression guard the dropped CI would have run).

---

## Test-first plan (every PR ships a test; logic tested without a DB)

| Under test | Layer | Test |
|---|---|---|
| `recordHarvest`/`splitLot` commands | pure (ports faked) | mints code, appends event, conserves mass |
| `metrics/*`, COGS views | SQL fixture | derived == hand-summed seed; **fails on pre-fix tables that can be seeded to disagree** (the trust regression) |
| `event-log` chain | pure | `hash(n)` depends on `prev_hash`; tamper breaks chain |
| `eudr` verdict roll-up / DDS GeoJSON | pure | conjunctive fail-closed; ≤4 ha → Point, >4 ha → Polygon |
| new `mapX` mappers | seam | clone `mappers.test.ts` |
| Server Actions | unit | validate + RPC + `revalidateTag`; non-compliant DDS rejected server-side |
| islands + every `loading.tsx`/`<Suspense>` | render-smoke (jsdom) | mounts, key structure, no throw; `maplibre-gl` mocked |
| **port discipline** | guard | no `src/app/**` file imports `getSupabase` or calls `.from(`/`.rpc(` (enforces D1) |

**One-line thesis:** keep the proven functional read-repository exactly as-is; add a symmetric write side whose single inviolable rule is *mutation and its event are one SQL transaction*; turn the four hand-authored aggregate tables into `security_invoker` views; store geometry in a side table and the genealogy as a mass-conserving graph over the existing text-PK lots — so every number on every screen provably comes from one source, behind a tiny-JS, 60fps liquid-glass surface.

### World-Class UI/UX (first-class track)

I'm the Track Lead for World-Class UI/UX. My job is to consolidate these design fragments into one coherent, decisive architecture-brief section. Let me write it directly.

---

# Architecture Brief — Track: World-Class UI/UX

**Mandate:** The UI/UX is the #1 quality attribute of the Phase-1 Spine, not an afterthought. Every surface — maps, the lot-genealogy graph, dense tables, field-entry forms, the public microsite — must be Apple-grade liquid glass: buttery 60fps (GPU transform/opacity only), the established glass language, `prefers-reduced-motion`, WCAG 2.1 AA on translucent surfaces, mostly Server Components for a tiny JS bundle, and instant glass skeletons. This track **extends** the existing `globals.css` glass system — it does not fork it.

---

## A. Locked Decisions (D-numbered)

These resolve all cross-fragment overlaps and contradictions. They are binding for every Phase-1 UI PR.

### Foundations & tokens

- **D1 — One token source, extended in place.** All color/elevation/blur/z/motion tokens live in the existing `@theme` block in `src/app/globals.css`. `src/lib/brand.ts` is the *read-only JS mirror* (hex for charts + MapLibre paint). No parallel token file, no second palette. A guard test asserts `globals.css` ↔ `brand.ts` stay in sync.
- **D2 — Extend, never fork, the glass material.** `glass` (true blur, floating chrome only), `glass-card` (no-blur content), `glass-forest`, `glass-hover`, `glass-sheen`, `stagger`, `animate-rise`, `perf-contain`, `cv-auto`, `--ease-glass` are all reused verbatim. New utilities are additive only.
- **D3 — Blur is a scarce resource spent only where cheap.** Real `backdrop-filter` is for floating chrome (sheets, palettes, map/graph overlays). Content cards stay no-blur glass-lite. Never nest two blurs. Never blur over a live-repainting canvas (see D7).

### The Server/Client split (the bundle contract)

- **D4 — Server-first by default; Client is a budgeted exception.** Pages and `sections/` composites are Server Components. `"use client"` is allowed only in: leaf interaction primitives (`Segmented`, `Tabs`, `Sheet`, filter toolbars), the nav islands (command palette, mobile nav, connectivity banner), and the two heavy islands (map, interactive graph). Every `"use client"` carries a one-line "why interactive" comment. The current ~9.5% client-file ratio is the asset to protect; a `check-client-budget.mjs` guard fails if `"use client"` appears in `app/**` or `sections/**`.
- **D5 — The Island pattern quarantines heavy JS.** Heavy interactivity (MapLibre, interactive lot-graph) lives in `src/components/islands/*.client.tsx`, mounted via `next/dynamic(..., { ssr: false })` with a server-rendered glass skeleton fallback. Data is fetched server-side and passed as plain-serializable props (GeoJSON, node/edge arrays). Pages and sections never gain a client boundary. The heavy chunk is route-split — only `/` (map) and `/lots/[code]` (graph) ever download it.
- **D6 — MapLibre is the ONLY sanctioned runtime UI dependency.** Pin `maplibre-gl@^5`, wrapped manually (no `react-map-gl`). Everything else stays hand-rolled SVG/CSS in the existing chart idiom: all charts, the lot-genealogy graph (pure-SVG layout + thin pan/zoom island), all tables. Zero charting/graph/animation libraries.

### Maps & the 60fps-over-canvas problem (resolving the one cross-fragment contradiction)

Two fragments proposed different mechanisms for glass-over-a-live-map. **They are unified here into one canonical rule:**

- **D7 — Glass over a moving canvas: blur the static veil, never the live pixels, and kill blur entirely while moving.** Three coordinated mechanisms, all required:
  1. The map canvas sits on its own GPU compositor layer (`.map-canvas` / `.map-layer`: `transform: translateZ(0)`, `isolation: isolate`, `contain: layout paint size`, `overflow: hidden`, reserved intrinsic size → zero CLS).
  2. A **static, cached, non-interactive gradient veil** (`.glass-scrim`) is painted over the map edges where chrome lives. Floating overlays (`.glass-overlay` / `.glass-map`, `blur(14–20px) saturate(1.4)`) sit above this veil, so the expensive `backdrop-filter` samples the *static* scrim — not the per-frame WebGL output.
  3. On `movestart`/drag-start, JS sets `.is-panning` / `data-mapmoving` on the map root; CSS drops every overlay's `backdrop-filter` to `none` (swapping to a more-opaque background) for the duration of the gesture; `moveend` (debounced) restores it. iOS Safari's `backdrop-filter`-on-moving-region weakness becomes a non-issue.

  This satisfies *both* "Apple-grade frosted glass on the map" and "buttery 60fps pan" — the only option that does.

- **D8 — Camera moves are configured, never hand-tweened.** MapLibre owns its rAF camera animation. `flyTo`/`easeTo` use `--dur-camera` (650ms) with `ease-inout`; **no opening fly-in** on load (`fitBounds` with `duration: 0`); camera speed is deliberately unhurried so free-tier OSM tiles arrive before the camera lands.

### The lot-genealogy graph

- **D9 — Layout is a pure server function; interactivity is a thin island.** `src/lib/ui/graph-layout.ts` (Sugiyama-lite layered DAG) is a pure, tested function returning node coordinates + edge paths. `charts/genealogy-graph.tsx` renders it as **server SVG** (prints, works with JS off, cheap render test). `islands/lot-graph-interactive.client.tsx` adds pan/zoom + lineage-trace highlighting (~1.5KB, transform/opacity only). No graph library.
- **D10 — Mass-flow alluvial encoding.** Nodes are stage-colored mini glass-cards in time-ordered columns (reuse the `STAGE_ACCENT` palette from `stage-pipeline.tsx`). Edges are **mass-proportional Bézier ribbons** — width ∝ kg carried, left→right gradient from parent stage color to child stage color. Processing yield-loss is drawn honestly as a dashed "loss" wisp. The single terminal node earns the one `glass-sheen`. Reduced-motion / narrow-viewport / no-JS falls back to an indented `role="tree"` outline built from the *same* node/edge data.

### Data-viz design language

- **D11 — One semantic chart-token layer.** `src/lib/charts/tokens.ts` (single-author contract file) maps *metric meaning* to brand hue: `yield`=forest, `cost`=coffee, `quality`=honey, `cherry`=cherry, `water`=sky, `reserve`=forest-deep. Charts read meaning, not hex. Exports `METRIC_COLOR`, `METRIC_TEXT` (AA-safe text twins), `CATEGORICAL`, `SEQUENTIAL_YIELD`, `CHART_MOTION`, `CHART_INK`.
- **D12 — Every new chart is a pure-SVG Server Component** matching the existing `Donut`/`TrendLine`/`BarMini`/`StatRing` contract: deterministic content-hashed `<defs>` UID, `currentColor`/token theming, HTML overlays for round/un-stretched elements, `role="img"` + generated `aria-label` summary, plus a visually-hidden data table for screen readers. New primitives: `CostWaterfall`, `MarginBar`, `MarginGauge` (StatRing wrapper), `BucketMiniBar`, `ScoreSpider` (the one genuinely new shape — SCA cupping radar), `StackedBar`, `GaugeArc`, `ElevationProfile`. Shared frame layer: `ChartFrame`, `ChartLegend`, `ChartEmpty`, `ChartSkeleton`, `ChartInteractive` (the only client chart wrapper — crosshair + glass tooltip, opt-in, hydrates over already-painted SVG).

### Motion

- **D13 — One motion vocabulary, token-driven.** Promote all magic-number durations/easings into named `@theme` tokens. Two signature curves: `--ease-glass` (decelerate, "arrival" — entrances, hover, sheen) and `--ease-inout` (symmetric, "travel" — map camera, graph re-layout); `--ease-out` for fills; `--ease-spring` rationed to value-emphasis only. Durations: `--dur-instant 120ms` → `--dur-sheen 800ms`. Stagger 50ms/child capped at 9 (≤450ms total). All motion is `transform`/`opacity`/`filter` only, plus a small audited whitelist (`stroke-dashoffset`, `stroke-width`, `width` on ProgressBar, `background-color` flash, MapLibre paint transitions).
- **D14 — Reduced motion degrades to instant + legible, never broken.** The global kill-switch stays the floor; per-surface overrides guarantee information-bearing motion *lands in final state* (graph edges fully drawn, camera jump-cuts to destination, validation shows color+icon not shake) rather than freezing mid-tween.

### Accessibility & contrast on glass

- **D15 — Certify foreground tokens against a pinned worst-case composited background, not pure white.** Add contrast-floor tokens (`--cf-glass-card`, `--cf-glass`, `--cf-glass-forest`) = the darkest the aurora can composite under each surface. A pure `contrastRatio()` util (`src/lib/a11y/contrast.ts`) + `contrast-tokens.test.ts` hard-gate every text token at ≥4.5:1 and non-text/focus at ≥3:1 against those floors.
- **D16 — The fills-vs-text accent contract (the honey-700 rule, generalized).** Every accent has two roles: `--color-X` (fills/strokes/≥24px icons, ≥3:1) and `--color-X-700` (text/small icons, ≥4.5:1). `text-{accent}` for any base that fails 4.5:1 is a lint error (`honey-rule.test.ts` static guard). **Action:** add `--color-sky-700: #2f5680` and repoint the two `text-sky` usages; honey usages are already correct.
- **D17 — One two-tone focus ring meeting WCAG 2.4.11.** `.focus-ring` = dark forest core + light halo (3px total, ≥3:1 on both light glass and dark map), with a `forced-colors` fallback. **Fixes the load-bearing bug:** `button.tsx` `focus-visible:ring-forest-100` (~1.1:1 on the forest button) fails Focus Appearance — replace with `.focus-ring`.
- **D18 — Maps and graphs are operable, not just summarized.** Dual representation: the interactive canvas/SVG is `aria-hidden` delight layered over a real, keyboard-navigable accessible primary — an SR-only plot **list** (`<nav>`) for the map, a `role="tree"` lineage walk (with edge mass as text) for the graph. An `aria-live="polite"` region announces map state. This also doubles as the no-JS / map-failed-to-load fallback. Honor `prefers-contrast: more` and `forced-colors: active` (both currently missing — glass evaporates without them).

### States (empty / loading / error / offline)

- **D19 — One shared skeleton primitive set.** Extract `Skeleton`, `SkeletonText`, `SkeletonCard`, `SkeletonKpiRow`, `SkeletonTable`, `SkeletonChart`, plus per-surface `SkeletonMap`/`SkeletonGraph`. Existing `loading.tsx` files refactor to compose them (kills current duplication). Add a GPU-only `.skeleton-shimmer` (auto-killed by reduced-motion). Skeletons mirror final layout dimensions → zero CLS.
- **D20 — Stream within routes via `<Suspense>` per section; three-tier error taxonomy.** Per-section `<Suspense>` so a slow getter (a waking free-tier DB) never blanks the whole route. Errors: `SectionErrorBoundary` (one panel fails, the rest live) → route `error.tsx` (exists) → new `global-error.tsx` (self-contained html/body). **Distinguish cold-start from failure:** a `<WarmingHint>` ("Waking the farm records…") appears only after 1.2s; the error card is reserved for genuine retried failure.
- **D21 — Offline is honest, not fake.** Phase-1 is read-mostly: a `<ConnectivityBanner>` shell island ("Offline — showing last-loaded data") + stale-while-revalidate via `force-dynamic` + `router.refresh()` on reconnect. No fake optimistic writes. The event-log schema must carry `client_uuid` + `client_seq` + `occurred_at` so future offline-write replay drops in (flag to schema track).

### Responsive, IA & navigation

- **D22 — Mobile is a first-class viewport; build the missing mobile nav.** **Finding to flag loudly:** the brief says "mobile nav (already built)" — it is **not** in the repo (sidebar is `hidden md:flex` with no replacement; below 768px there is no navigation). Build a fixed **bottom tab bar** (4 primary: Map, Harvest, Tasks, Home) + a **"More" glass sheet**, driven by the nav registry. `md` (768px) is the chrome pivot (sidebar in, bottom-nav out). Add `--breakpoint-xs: 24rem` as the test floor.
- **D23 — Touch ergonomics contract.** 44×44px minimum targets (bottom-nav 56px); 16px-minimum input font (fixes the iOS auto-zoom bug the `text-sm` topbar search currently triggers); `min-h-dvh` (not `min-h-screen`); `env(safe-area-inset-*)` + `viewportFit: "cover"`; `touch-action` tuning (`none` on the map canvas); `-webkit-tap-highlight-color: transparent` + `.tap-press` active feedback. Never disable pinch-zoom (WCAG 1.4.4).
- **D24 — Dense tables collapse to record-cards below `md`, never horizontal scroll.** Extend `data-table.tsx` into `ResponsiveTable` with per-column `priority` (`primary`/`secondary`/`meta`) — generalizing the existing `PlotsExplorer` card/row dual-render. Kills pinch-and-pan on every table (harvest log, GreenLot inventory, COGS).
- **D25 — Registry-driven, three-tier IA.** One typed nav registry (`src/lib/nav/registry.ts`) is the single source for sidebar, command palette, mobile nav, and breadcrumbs — adding a module is a one-line append. Three groups by task cadence: **Operate** (≤6 items, guard-tested), **Trace & Inventory**, **Compliance & Records**. The map is the home route `/`.
- **D26 — Revive the dead search input as a command palette.** The topbar `<input>` is currently a no-op. Promote it to the trigger for a headless (no `cmdk` dependency) ⌘K / `/` command palette — lazy-imported on first keypress (out of the initial bundle), native `<dialog>` for focus-trap. Searches nav + entities (Postgres `ILIKE`/`pg_trgm`, free-tier-safe) + actions. Resolves to canonical entity URLs.

### Universal surfaces & feature-specific UX

- **D27 — Canonical entity URLs.** `/plots/[id]`, `/lots/[code]`, `/workers/[id]`, `/processing/[lotCode]`, `/eudr/[plotId]` — so map pins, palette results, activity feed, breadcrumbs, and the public microsite all resolve identically.
- **D28 — `DetailDrawer` is the universal "drill into one entity" surface** (lot/GreenLot/plot/EUDR), real `glass` blur (floating chrome), GPU `translateX`, scrim at `--z-scrim`. `KeyValueList` (promoting the inlined `Fact` pattern) and `LotNodeChip` are shared.
- **D29 — Field-entry capture is its own field-instrument language, schema-forward.** One `<CaptureSheet>` shell (bottom-sheet mobile / side-rail desktop, density-parameterized `field`|`desk`); big targets, `NumberPad` (64px keys, haptics, native `inputMode="decimal"` fallback), `TapGrid` (recents-first). Posts append-only **events** (not row updates) via Server Actions through `SECURITY DEFINER` RPCs (presentation never `.rpc('<write>')` directly). `clientId` UUID idempotency key. The outbox seam (`outbox.ts`) is built now (flushes immediately online), so offline-first drops in later with no form changes. **Flag:** this is the first write surface — the events table + INSERT RLS + `mint_lot_code` RPC are the schema track's lane.
- **D30 — Derived dashboards swap substrate invisibly.** Season/harvest/variety views keep their exact component APIs; the trust fix is repointing getters from hand-authored aggregate tables to derived views + a tested TS metric layer. Make trustworthiness *visible*: a "Live · derived" chip per card; `ytd_revenue_usd` (no row source in Phase-1) renders as an honest "Est. revenue · modeled" until GreenLot sales exist.
- **D31 — The public per-lot microsite is a separate `(public)` route group, SSG.** `/lot/[code]` is statically generated (`force-static` + `generateStaticParams`, on-demand `revalidateTag`) → instant, free-tier-pause-proof, no auth. **Security-load-bearing:** it reads ONLY a curated `lot_provenance_view` granted to `anon` (buyer-safe columns: no phones, no rates, no costs — crew names as a celebratory honor-roll), never base tables; a regression test asserts no PII/cost column is ever selected. Reuses `TrendLine`/`StatRing`/`Donut`/`glass-forest`; adds only `ScoreSpider`.

---

## B. Recommended Design

### B.1 Code structure — four layers, one-way dependencies

```
tokens (globals.css @theme  ·  lib/brand.ts mirror  ·  lib/charts/tokens.ts  ·  lib/a11y/contrast.ts)
   ↑
primitives (components/ui/*   ·  components/charts/* pure SVG)        ← server-safe, no domain types
   ↑
islands (components/islands/*.client.tsx)  ← MapLibre + interactive graph ONLY, dynamic ssr:false
   ↑
composites (components/sections/<domain>/*)  ← domain-aware, render glass chrome + mount islands
   ↑
screens (app/(app)/**/page.tsx  ·  app/(public)/lot/[code])  ← thin async server: fetch → compose
```

Import rule: a layer imports only downward. Enforced by `check-layer-imports.mjs` (primitive→section or chart→domain-type fails) and `check-client-budget.mjs`, both wired into `pretest` (no GitHub Actions).

### B.2 New CSS utilities (additive to `globals.css @layer utilities`)

`.map-canvas`/`.map-layer`, `.glass-scrim`, `.glass-overlay`/`.glass-map`, `.metric-readout` (tabular metric), `.skeleton-shimmer`, `.focus-ring`, `.tap-press`, `.animate-rise-sm`, plus `@keyframes` `shimmer`/`draw-edge`/`chart-grow`/`field-shake`/`cell-flash` (all inside the existing reduced-motion guard). New `@theme` token groups: elevation, blur scale, z-layer contract, map/dataviz semantic colors, contrast-floors, motion durations/easings, `--breakpoint-xs`, `--color-sky-700`, `--text-metric`.

### B.3 Component inventory (new — author + test)

| Group | Components |
|---|---|
| **Primitives** | `Skeleton*`, `Sheet`, `Tabs`, `ResponsiveTable`, `KeyValueList`, `LotNodeChip`, `GradeBadge` (+2 Badge tones: `specialty`, `flag`), `SectionErrorBoundary`, `WarmingHint`, `ConnectivityBanner` |
| **Charts (server SVG)** | `CostWaterfall`, `MarginBar`, `MarginGauge`, `BucketMiniBar`, `ScoreSpider`, `StackedBar`, `GaugeArc`, `ElevationProfile`, `GenealogyGraph`, + frame layer `ChartFrame`/`ChartLegend`/`ChartEmpty`/`ChartSkeleton`/`ChartInteractive` |
| **Islands (client)** | `FarmMap.client`, `LotGraphInteractive.client` |
| **Nav** | `CommandPalette` (lazy), `BottomNav`, `NavSheet`, `Breadcrumbs` |
| **Drawers/sheets** | `DetailDrawer`, `MapOverlayPanel`, `EventTimeline`, `ExportStepper` |
| **Capture** | `CaptureSheet`, `NumberPad`, `TapGrid`, `FieldShell`, flow forms |
| **Microsite** | `(public)` layout + 8 lot sections |

Everything else is composition of existing primitives — no new files.

---

## C. Key Trade-offs (decisions and what we gave up)

1. **MapLibre is accepted as the one ~200KB dependency** (D5/D6) — it cannot be hand-rolled, but it's quarantined to two routes via `ssr:false` dynamic import, so the rest of the app pays nothing. We gave up SSR of the map (correct: MapLibre touches `window`); the `SkeletonMap` makes the cold path feel instant.
2. **Hand-rolled graph over React Flow** (D9) — costs us a Sugiyama-lite layout function to write and test, buys 0KB, full glass control, server-renderable/printable graph, and visual coherence with the existing charts.
3. **Glass-over-map via static-veil + pan-kill (D7)** over either naive live-blur (jank) or no-blur (flat/off-brand) — more JS choreography (the `is-panning` flag), but it's the only path that holds both 60fps and the frosted aesthetic, especially on the iPad-class hardware a farm office uses.
4. **Certify contrast against a pinned worst-case composited background (D15)** rather than raising card opacity — keeps full liquid-glass translucency at the cost of a small contrast util + token-floor tests (which we want anyway, as the enforcement layer the current honor-system lacks).
5. **SSG public microsite (D31)** over a live public view — gives instant, free-tier-pause-proof buyer pages and a tighter security surface (one curated `anon` view, rebuilt on demand), at the cost of a `revalidateTag` call when a lot finalizes.

---

## D. Dependencies & Flags (out of this track's scope — for the schema/data-model lane)

- **Geometry (PostGIS `geom`/`geom_point` + GeoJSON RPC), derived-metrics views, event log (with `client_uuid`/`client_seq`/`occurred_at`), GreenLot/allocations, `lot_cogs` view + inputs-cost column, EUDR tables + `compliance_thresholds`, `lot_provenance_view`** are all schema-author-lane migrations. This track *consumes contracts* and specifies them; it must not author them (one-schema-author rule).
- **Status/color agreement is a data contract, not just a token contract** — the map choropleth, COGS, and dashboards only deliver "no disagreeing numbers" if every screen reads the *same derived query*. The semantic-layer track owns this; we provide the single status→color token mapping.
- **Single-author contract files:** `globals.css`, `lib/brand.ts`, `lib/charts/tokens.ts`, `lib/nav/registry.ts` must each be edited by one author per wave (serialized lane), per the no-drift rules.
- **Test-env prerequisite:** vitest env is `node`; the first UI render/smoke PR must set up jsdom + `@testing-library/react`. This gates all render tests across the track.
- **Load-bearing bug to fix immediately:** `src/components/ui/button.tsx` `focus-visible:ring-forest-100` fails WCAG 2.4.11 (~1.1:1 on the forest fill) → replace with `.focus-ring` (D17).
- **iOS input-zoom bug:** topbar search at `text-sm` (14px) auto-zooms on focus → enforce 16px-min on all inputs (D23).
- **`min-h-screen` shell bug:** switch to `min-h-dvh` (D23).

### Cross-Cutting Concerns

Grounding confirms the load-bearing facts: no Docker (PGlite is forced), Supabase CLI 2.90.0 present, prod migration max `20260620140000`, the `en-US` choke point in utils.ts, and the lean dep tree. The dossier had one version contradiction (MapLibre `^5.6.0` vs `^4.7.x`) which I resolve below. Here is the consolidated section.

---

# Phase-1 SPINE — Cross-Cutting Concerns (Architecture Brief)

**Track Lead consolidation.** Grounded in `feat/supabase-backend` as it exists today: 6 runtime deps (`@supabase/ssr`, `supabase-js`, `lucide-react`, `next ^15.1.6`, `react ^19`), Vitest 4 + jsdom, Supabase CLI 2.90.0, **no Docker on the build machine**, prod migration max `20260620140000`, all formatting funneled through `src/lib/utils.ts`, the glass system in `globals.css`. This section locks the cross-cutting decisions every other track (lot graph, PostGIS, MapLibre, metrics, GreenLot, event log, EUDR, COGS) must conform to. Overlaps and one version contradiction in the source fragments are resolved here.

## 0. The one sentence the whole section turns on

**For a single-estate Geisha house, provenance IS the product premium** — so *data-integrity/trust* is the load-bearing quality attribute, *world-class UI* is the mandated surface it is delivered through, and *$0-cost* and *offline-readiness* are a ceiling and a future-option to be **governed, not built**. Every decision below is derived from that ordering, not from pattern-shopping.

## 1. Locked decisions (D-numbered)

| D# | Decision | One-line rationale |
|---|---|---|
| **D1** | **Quality-attribute rank order is fixed:** ① data-integrity/trust → ② UI-excellence → ③ auditability → ④ maintainability → ⑤ $0-cost (ceiling) → ⑥ offline-readiness (future-option). | A wrong cost-per-kg or a broken lineage loses a five-figure sale or fails EU market access; a janky screen does not. Trust outranks everything; UI is how trust is *believed*. |
| **D2** | **Store canonical, render localized.** Every quantity persists in ONE canonical SI/UCUM unit (mass `kg`, area `m²`, length `m`, temp `Cel`, sugar `[Brix]`); money as integer `usd_cents`; enums as codes. Conversion + locale formatting happen ONLY at the UI edge. | Kills unit drift and "numbers disagree across screens" at the source; new capabilities inherit correct units/locale for free. |
| **D3** | **No i18n framework.** A typed `const`-dictionary + native `Intl.*`, locale resolved server-side (cookie → `accept-language` → default), threaded through the existing `utils.ts` choke point. **es-PA is the default**, `en-US` the fallback. | Honors all three hard constraints at once: world-class (Intl is correct/fast), $0/no-CI (no tooling, no deps, missing key = compile error), tiny bundle (RSC reads the dict; zero added client JS). |
| **D4** | **Server-first is the default; a `"use client"` island needs written justification.** Phase 1 adds **at most 3** islands: `<FarmMap>`, `<LotGraph>` pan/zoom, field-entry forms (forms prefer Server Actions). | Defends the already-excellent baseline (6 islands today). The other 6 capabilities ship as server work with ~0 KB net client JS. |
| **D5** | **If a pixel doesn't need WebGL or a per-frame pointer interaction, it is server-rendered SVG.** Static plot boundaries (cards, EUDR PDF, OG images), dashboard charts, and the lot-genealogy graph render as server-computed `<svg>`. | One rule lets a world-class map, charts, and genealogy graph coexist without bloating non-map routes. |
| **D6** | **MapLibre GL JS `^5.6.0`** (via `react-map-gl ^8`) is the ONE sanctioned heavy client chunk: `dynamic(..., { ssr: false })`, imported from **exactly one module**, `/map ≤ 230 KB` first-load. Tiles from **OpenFreeMap** (no key/quota) with MapTiler free as fallback — **never proxied through Supabase**. | Only $0 + WebGL-vector + self-hostable renderer. Version resolved to v5.x (current line, React-19-ready `react-map-gl@8`) over the fragment's stale `^4.7.x`. Bundle fully isolated to one lazy route. |
| **D7** | **No charting library and no graph-layout library, ever.** Charts = hand-authored SVG + `d3-shape`/`d3-scale` *functions only*, server-side. Lot graph = server-computed layered-DAG layout → SVG; `elkjs ^0.9.3` is a pinned, lazy, server-side escape hatch only if simple layout proves insufficient. | The repo already proves hand-authored SVG is a first-class chart (0 KB). Rejects recharts/visx/react-flow/cytoscape (90–350 KB client runtimes). |
| **D8** | **Add no client data/state library.** Keep `react.cache()` + Server Components + PostgREST. Interaction state (map viewport, selected lot, filters) lives in **URL search params** + local `useState` islands. First writes use **Server Actions**. | Phase 1 is read-mostly; preserves the "mostly Server Components / tiny bundle" contract verbatim. No React Query/SWR/tRPC/Zustand/Redux/Jotai. |
| **D9** | **Derived metrics replace hand-authored aggregate *tables* with `security_invoker` views** of the *identical column shape* the db helpers already select. The `season_summary`/`daily_cherries`/`weekly_harvest`/`variety_shares` mappers in `src/lib/db/trends.ts` stay byte-identical. | EXTEND not rewrite — the source flips from hand-typed table to derived view; the read layer needs zero TS change. This is the structural cure for the #1 trust defect. |
| **D10** | **One append-only, hash-chained `events` table** is the audit substrate. `payload` size-capped (`CHECK octet_length < 4096`); telemetry NEVER writes to it (separate downsampled `measurements` table). `idempotency_key` (nullable unique) is the **entire** Phase-1 offline investment. The existing `activity` table becomes a **view over `events`** so the feed reads unchanged. | Auditability (③) + the offline seam (⑥) at the cost of one column each. No sync engine, service worker, or IndexedDB ships. |
| **D11** | **PostGIS in the `extensions` schema; geometry is additive on `plots`.** Polygons stored at SRID 4326, simplified server-side (`ST_SimplifyPreserveTopology`), shipped as compact GeoJSON (`ST_AsGeoJSON`) — never WKB, ≤ 60 KB whole-farm. Elevation/slope/aspect sampled ONCE from **Copernicus GLO-30 at ingest into scalar columns; the DEM raster is never stored.** | Geometry is kilobytes vs the 500 MB cap; raster would blow it alone. `extensions` schema matches the repo's `extra_search_path`. |
| **D12** | **Migrations use expand-and-contract with paired, tested down-files.** Every forward `NNNN_x.sql` ships an `_down/NNNN_x.down.sql`; additive-first (old scalars kept) so `main` stays green at every commit; the contract (DROP) migration is a separate, gated PR. Timestamps strictly `> 20260620140000` (the applied prod max), checked against `schema_migrations`, not repo max. One schema author at a time. | Supabase has no reliable auto-`down` and the free tier has no PITR/branching — reversibility must be authored, version-controlled, and tested (D16). |
| **D13** | **Anti-pause heartbeat is a Phase-1 deliverable**, not a nice-to-have: `pg_cron` daily internal touch **+** a daily Vercel-Cron `GET /api/heartbeat` REST hit. **No GitHub Actions.** | The 7-day idle pause bites a single-farm app in the off-season *before any data limit* — it would dark the app / block an EUDR export on demand. Both legs are $0. |
| **D14** | **The AI layer is a deferred Phase-2 brain on a Phase-1 seam.** Phase 1 ships only: AI-provenance on `events` (`actor_type='ai_suggested'`), an `ai_suggestions` HITL queue (empty), a read-only `getGroundingContext()` over the *same* semantic layer the UI uses, and a fail-closed `ai_usage` cost cap. The copilot reads through the semantic layer — **never raw tables**. | The copilot can never compute a number that disagrees with a screen; the seam slots in with zero schema/security retrofit. |
| **D15** | **Two AI invariants enforced structurally, not in the prompt:** (a) **untrusted text never drives a write** — the model has *no write tools*, runs under an `ai_reader` role with INSERT only on `ai_suggestions`, and free-text grounding is provenance-fenced; (b) **human-in-the-loop on every state change** — model output lands as a *proposal*; a human approval is the only writer. EUDR export is **never** an AI-writable kind. | Mirrors the proven dispatcher invariant: the model is a suggester to the owner, never a puppet of texters. A deforestation-free attestation is a legal statement — pure deterministic, human-triggered. |
| **D16** | **PGlite (`@electric-sql/pglite`, Postgres 17 WASM + `postgis` contrib) is the test substrate** for SQL/RLS/PostGIS/recursive-genealogy, in-process under Vitest. The full Supabase/Docker stack is a manual, on-demand pre-merge smoke only. **The quality gate is local `npm run build && npm run test` + `tsc --noEmit`** (the CI replacement). | Docker is absent on this machine; PGlite is the only $0/no-Docker/no-CI path that runs *real* Postgres where the spine's trust lives. Tests never touch the pausable prod DB. |
| **D17** | **A `npm run perf:budget` script is the executable budget SSOT** (no CI): sums per-route first-load JS from the build manifest and fails on breach; static-greps the invariants — `maplibre-gl` imported once (D6), zero imports of `recharts\|d3\|react-flow\|cytoscape\|chart.js` (D7), `"use client"` count ≤ pinned ceiling (D4). | The performance budget and the architectural rules become enforced artifacts, not aspirations — the no-CI analogue of "green trunk is a contract." |
| **D18** | **No regenerable artifact is ever persisted; all binary media is referenced by pointer, never stored in Supabase.** EUDR DDS PDFs, derived aggregates, MV outputs are computed on request and streamed. Future drone/photo/audio media stores bytes in external free object storage (Cloudflare R2 free tier) with only a `media_ref` + content hash in Postgres. | Protects the 500 MB DB / 1 GB Storage caps and kills the drift defect; forward-compat for telemetry/media phases with zero Phase-1 build. |

## 2. Recommended design (how the locked decisions cohere)

**The trust spine (D1, D9, D10, D2).** The database is the SSOT, so it is where correctness is *enforced and tested*. Derived views (D9) guarantee one definition of every aggregate; the hash-chained `events` log (D10) makes every state reconstructible; canonical units (D2) make mass-balance arithmetic unambiguous. An invariant guard asserts `season_summary.harvested_kg == sum(harvests.cherries_kg)` and per-node `sum(edge.mass_out) ≤ mass_in`, run in the local gate (D16).

**The UI spine (D4, D5, D6, D7, D8).** Server-first by default; SVG for anything not needing WebGL; MapLibre isolated to one lazy route; no chart/graph libraries; no client data/state lib. Net: non-map routes stay at ~0 KB added viz/JS; the map adds exactly one ~210 KB lazy chunk on `/map`. **Where glass and the legibility of a trust-number conflict, the number wins the surface** — grade/COGS values render on a forest-tinted *solid* (WCAG-AA) token, not translucency. Maps/graph use `perf-contain`+`cv-auto`; blur is reserved for floating chrome; pan/zoom is a single GPU `transform`; `prefers-reduced-motion` is honored; every async surface ships an instant glass skeleton (`stagger`+`animate-rise`) with `aria-busy`.

**The platform spine (D11, D12, D13, D18).** PostGIS additive in `extensions`; expand-and-contract reversible migrations; a two-legged anti-pause heartbeat; persist pointers and inputs, never regenerable artifacts or raster/media.

**The governance spine (D14, D15, D16, D17).** The AI brain is deferred behind a cheap, secure seam; tests run on real in-process Postgres; the budget + invariants are an executable script.

## 3. Component / schema / UI specifics

**Schema (one author, timestamps > `20260620140000`, each with a `_down`):**
- `…300000_postgis_geom` — `create extension postgis with schema extensions;` + `plots.geom geometry(Polygon,4326)`, generated `area_m2`/centroid; scalar `area_ha`/`altitude_masl` kept until contract.
- `…310000_lot_graph` — `lot_nodes` + `lot_edges(mass_kg, basis)` FK→`lots(code)`; mass-conservation CHECK; cycle prevention; backfilled from `harvests`/`processing_batches`.
- `…320000_event_log` — `events(seq, at, kind, entity, payload jsonb CHECK octet_length<4096, idempotency_key unique, prev_hash, hash, actor_type enum{human,system,ai_suggested}, suggestion_id, approved_by)`; BEFORE-INSERT hash trigger; UPDATE/DELETE revoked; `activity` becomes a view over it.
- `…330000_green_lots` — `green_lots` (grade, location, ATP with over-allocation CHECK) FK→`lots(code)`.
- `…340000_derived_views` — drop aggregate tables, recreate as `security_invoker` views of identical shape; promote the one genuine input (`target_kg`) to a small `season_targets` table.
- `…ai_seam` — `ai_suggestions`, `ai_usage`, `ai_feature_flags` (copilot default OFF); `ai_reader` role with no domain-table grants.
- `…400000_drop_flat_scalars` — **gated, separate PR**, only after read-path cutover verified.

**New TS modules:** `src/lib/units/quantity.ts` (branded `Quantity<U>`), `src/lib/i18n/{locale,format,dict}.ts` + `dictionaries/{es-PA,en-US}.ts`, `src/lib/ai/{context,budget}.ts`, `src/lib/domain/*` (pure COGS/yield-ledger/EUDR predicate/genealogy mass — zero Supabase imports). `src/lib/utils.ts` re-exports `format.ts` so the 86 format call sites migrate incrementally. `next.config.mjs` gains `experimental.optimizePackageImports: ["lucide-react"]`.

**Dependency delta (all pinned):** runtime — `maplibre-gl ^5.6.0`, `react-map-gl ^8.0.0` (lazy, map route only), `d3-shape ^3.2.0`, `d3-scale ^4.0.2`, `js-quantities ^1.8.0` (all server-side, 0 KB client except the two map pkgs); optional lazy `elkjs ^0.9.3`. dev — `@electric-sql/pglite ^0.3.x`, `@testing-library/user-event ^14`, `@types/d3-*`. Hashing uses node `crypto` (no dep).

**UI specifics:** `MapGlassSkeleton` sized to the final box (CLS≈0); MapLibre plot polygons as native GL GeoJSON layers with `feature-state` hover (no React re-render); `LotGraph` server-computed `{nodes,edges}` → SVG with edge thickness ∝ mass, ~2 KB pan/zoom island, `<canvas>` swap above ~400 nodes behind the same prop contract; derived-metric cards assert displayed value == the L2 calc on the same fixture.

**Test layers (under one `vitest run`, split into `ui` jsdom + `db` node projects):** L0 static guards (`tsc`, seed↔schema parity via PGlite, migration lint) · L1 PGlite SQL/RLS/PostGIS/recursive-CTE (fresh DB per file via `loadDataDir` clone; RLS matrix; append-only + hash-chain; mass-conservation; derived-view equality; EUDR baseline flip; COGS NULL-on-zero-yield) · L2 pure-domain units · L3 data-access getters (extend the chainable stub with `.rpc()`) · L4 render/smoke (MapLibre **mocked** — test that the right GeoJSON/layers/handlers wire, never WebGL pixels; geometry correctness lives in L1). Anti-flakiness: no network ever, deterministic time, fresh DB per file, mock the GPU not the data.

## 4. Key trade-offs

- **Trade ① over ②:** nothing ships wrong-but-pretty; a trust number takes a solid AA surface even where glass would be prettier. Rejected "UI #1" — a buttery dashboard showing a total that disagrees with the harvests table is a *worse* product because it makes the lie convincing.
- **Trade ③ for write cost:** every new write path appends an event + hash (~2× write cost, append-only growth). Mitigated by the `payload` cap (D10) and a season-rollup retention view that preserves the last hash per lot so the chain stays verifiable post-eviction.
- **Trade read CPU for trust:** derived views recompute (D9). Mitigated by plain `security_invoker` views at Phase-1 scale (10 plots are trivial); promote to materialized + event-append refresh only if measured slow.
- **Trade generality for bundle:** we write a DAG layout and SVG charts instead of importing libraries (D5/D7) — cheaper than the entire map budget and keeps the graph a near-static island.
- **$0 ceiling is honest, not free:** the only forced spend is storing media *in* the DB (prevented by D18) or pushing high-frequency telemetry into the ledger (prevented by D10's cap + separate `measurements`). Documented escape hatch: Supabase Pro $25/mo (8 GB) on sustained genuine >80% DB growth — Phase-1 SPINE data alone reaches ~150 MB after five seasons (~30% of cap), so it never gets there.
- **Offline costs one column:** `idempotency_key` (D10) is the whole investment; building a sync engine now is the rejected over-build.

## 5. Conformance rules for the other tracks

1. No track hand-authors an aggregate — every season/daily/variety/COGS number is a derived view (D9) or it doesn't ship.
2. Every new write path appends to `events` with an `idempotency_key` (D10); the `ai_reader` path may write only `ai_suggestions` (D15).
3. Every new screen ships a glass skeleton + a render/smoke test; trust-numbers render on a solid AA surface (D4/D5).
4. No track stores raster, regenerable artifacts, large blobs, or per-read recompute; media is by pointer (D11/D18).
5. No track builds an offline runtime or an AI write-tool; offline = schema seam, AI writes = HITL proposals only (D10/D14/D15).
6. All new logic is TDD test-first; SQL invariants run in PGlite; the local `build + test + tsc` gate + `perf:budget` are the CI replacement and must stay green (D16/D17).
7. Geometry ships as simplified GeoJSON ≤ 60 KB whole-farm, never WKB; the DEM raster is never stored (D11).
8. Migration timestamps strictly `> 20260620140000`, paired with a tested `_down`, expand-before-contract, single author (D12).

**Version contradiction resolved:** the dossier's tech-stack fragment pinned MapLibre `^5.6.0`/`react-map-gl ^8`; the performance fragment pinned `maplibre-gl ^4.7.x`. **Locked to `^5.6.0` + `react-map-gl ^8`** (D6) — current line, React-19-ready, and the budget isolation (lazy, `ssr:false`, one import site, `/map ≤ 230 KB`) holds identically at v5.

**Grounding (read-only, untouched):** `/Users/andres/coffee-farm-operations/package.json`, `next.config.mjs`, `vitest.config.ts`, `src/lib/utils.ts`, `src/lib/types.ts`, `src/lib/db/trends.ts`, `src/lib/supabase/server.ts`, `src/app/globals.css`, `supabase/migrations/20260620120000_init.sql`, `supabase/migrations/20260620140000_auth_required_rls.sql`, `/Users/andres/janson-coffee-INTEGRATION-INVESTIGATION.md`.
