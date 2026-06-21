# Janson Coffee — Phase-2 · DESIGN (Architecture) — "Close the make-quality loop & the people system"

> DESIGN wave (full-stack, propose mode). 11 capability-area design fan-out (offline weigh substrate · crew dispatch · ripeness/pasada planner · ferment & wet-mill · drying-reposo gate · QC & cupping · worker system-of-record · blended payroll · satellite/IPM/phenology · cross-area sequencing) → Chief Architect synthesis. Designed against the SHIPPED Phase-1 spine (`feat/supabase-backend`: Next.js 15 + React 19 + TS strict + Tailwind v4 + Supabase free-tier Postgres). Date: 2026-06-21.
>
> **This document is the Phase-2 SSOT contract DISTILL/DELIVER build against.** It decomposes Phase 2 into **P2-S0 … P2-S12** with the same spine-first ordering rule, per-slice migration + ports + world-class UI + failing-first tests + dogfood moment, and cross-slice rails the Phase-1 plan used.

---

## §0 — Build Sequence (the DELIVER-ready plan)

I have enough grounding. **One load-bearing baseline correction up front:** the live migration head is **`20260621110000_phase1_review_fixes.sql`**, not `094500` (the EUDR slice landed as `20260621102000_eudr_traceability.sql`, and a review-fix migration `20260621110000` sits above it). Every Phase-2 migration must sort strictly above **`20260621110000`**. I renumber the whole Phase-2 lane to **`20260622NNNNNN`** (next-day scheme) so nothing collides with the Phase-1 head and the serial schema lane stays unambiguous.

Two Phase-1 facts every Phase-2 slice inherits and must honor (verified against the migrations on disk):

- **`grant_hygiene` default-privilege lock is still in force.** Every new table/view is born with **no write grant and no read grant** to either role. Every Phase-2 migration must explicitly `grant select … to authenticated` on each new table/view (or reads 404), `revoke execute … from public` then `grant execute … to authenticated` on each RPC (the PUBLIC-execute default is the exact hole that let anon mint lots in S3), and **never** grant anything to `anon` except the one curated public view the microsite already uses.
- **The write door is the command RPC.** Every write mutates the domain row AND appends a `lot_event` (or new `*_event`) row in **one** `SECURITY DEFINER` transaction with `set search_path = public, extensions`, idempotent on `idempotency_key`. The append-only `lot_event` hash-chain (`prev_hash → hash`, computed in a `BEFORE INSERT` trigger, immutable via no-UPDATE/DELETE policy + block trigger), the `device_id`/`device_seq` causal-ordering columns, and the dual clocks `occurred_at`/`recorded_at` are **already on disk from event #1** — Phase-2's offline capture is a *consumer* of that investment, not a retrofit.

Here is the build sequence.

---

# PHASE-2 — BUILD SEQUENCER OUTPUT

## 0. Baseline correction (read first — affects every migration timestamp)

The capability briefs variously numbered new migrations at `20260621NNNNNN`. **All collide with the applied Phase-1 lane** (`20260621090000`–`20260621110000`). The live head is **`20260621110000_phase1_review_fixes.sql`**. New migrations must sort strictly above it. I renumber the entire Phase-2 lane to **`20260622090000`+**.

Three load-bearing consequences from the Phase-1 spine that reshape Phase 2:

- **0.1 — There is no offline substrate yet, and the app is server-rendered.** Phase-1 shipped exactly **two client islands** (MapLibre, lot-graph pan/zoom) and writes through Server Actions → command RPCs. Per-picker weigh capture must work **at 1,700 masl with no signal** — that requires a PWA + IndexedDB outbox + a Service Worker + a client-side UUIDv7 minter that the server RPC accepts. **This substrate does not exist and gates every field-capture slice.** It is the Phase-2 equivalent of Phase-1's S0 test-substrate gate, and it must land first.

- **0.2 — `workers` and `crew` are flat denormalized rows, not a people system.** `workers` is a single table with `crew text NOT NULL`, `attendance attendance_status` (one current enum value, not a ledger), `daily_rate_usd`, `today_kg` — a snapshot, not a system of record. Phase-2's people system promotes `crew text` into real `crews`/`crew_memberships` and `attendance` into an **append-only attendance ledger**, *keeping the existing `workers.id` text PK* (`w-06`) so every Phase-1 FK (`harvests.worker_id`, `tasks.worker_id`) survives — the same promote-in-place move Phase-1 used on `lots(code)`.

- **0.3 — `advance_processing_stage` is the one chokepoint the reposo gate extends.** The stage machine is a single RPC (`advance_processing_stage(p_lot_code, p_to_stage, p_current_kg, …)`) that `update lots set stage = p_to_stage`. The reposo gate is **not** a new table-driven workflow engine — it is a **precondition check added inside this existing RPC** (and a hard trigger backstop) that raises when `p_to_stage` crosses the drying→milling boundary without moisture-stability + min-rest-days met. One chokepoint, one gate.

---

## 1. The spine-first ordering rule

Across all 11 briefs the Phase-2 dependency graph is unambiguous and has **two trunks**, not one:

1. **The capture trunk:** offline PWA substrate → crew/worker identity → per-picker weigh capture. Nothing that captures a field event (weigh, attendance, scouting) can be built before the offline outbox and the crew identity it stamps exist.
2. **The make-quality trunk:** ferment/wet-mill tracker → drying + reposo gate → QC/cupping. Each extends the Phase-1 processing chain (`processing_batches`, `advance_processing_stage`, `green_lots`) and each is the input the next reads.

The two trunks **join at payroll** (needs attendance + por-obra + weigh-events) and at QC (needs `green_lots` from Phase-1 + drying curves). The remote-sensing/agronomy capability is a **branch read** off plot geometry that fires tasks onto the existing board — it depends on nothing in Phase-2 and can land any time after the planner wants its NDVI input.

**Must-land-first, in strict order:** **P2-S0 (offline PWA + outbox substrate) → P2-S1 (crew + worker system-of-record + append-only attendance) → P2-S2 (per-picker weigh capture).** Only after S2 does the genesis field event exist; only after S1 does payroll have people to pay. The make-quality trunk (S3 ferment → S4 drying/reposo → S6 QC) can fan out in parallel with the capture trunk because it extends the *processing* spine, not the *people* spine — they share only `lot_code`.

---

## 2. The slices (dependency-ordered, each end-to-end + demo-able + test-first + world-class UI)

Each slice = one migration (or none), its `src/lib/db/*` port(s), its Server Component screen / client island, its glass UI, its failing-first tests. **"Dogfood moment"** = the first time the family can *use* the slice on real farm data and trust it.

---

### P2-S0 — Offline-first PWA substrate + sync outbox *(THE CAPTURE TRUNK FOUNDATION; no DB-schema migration)*

**Migration: none** — but one **RPC-contract change** lands in the S2 migration it unblocks: every command RPC that field devices call must accept a **client-minted `idempotency_key` + `device_id` + `device_seq`** (the Phase-1 RPCs already take these) and be **commutative under replay** (idempotent insert on `idempotency_key`, already true). S0's job is the client half of that contract.

**Build (no schema):**
- **PWA shell:** `manifest.webmanifest` + a Service Worker (Workbox-free, hand-rolled ~80 lines — $0, no dep) doing app-shell precache (Next.js static chunks) + a **stale-while-revalidate** strategy for read getters and a **background-sync queue** for writes. `next-pwa` is rejected (unmaintained on Next 15 App Router); the SW is authored by hand and tested in jsdom with a mocked `caches`/`fetch`.
- **The outbox:** `src/lib/offline/outbox.ts` — an IndexedDB queue (via `idb` ^8, 1.1KB, the one new dep; or hand-rolled `indexedDB` to stay zero-dep — **decision flag below**). Each queued mutation = `{ uuidv7, rpc_name, args, occurred_at, device_id, device_seq, status }`. A `flush()` drains FIFO, calls the Server Action, and on the RPC's idempotent success marks done; on network failure leaves queued; on a **business-rule rejection** (oversell, min-wage, reposo) moves to a **dead-letter** state surfaced in UI (never silently dropped).
- **The id minter:** `src/lib/ids.ts` is promoted from server-only to **isomorphic UUIDv7** (monotonic, client-mintable, no DB DEFAULT — the Phase-1 UA-10 contract already anticipated this). `device_id` is a per-install UUID in IndexedDB; `device_seq` is a monotonic per-device counter — together they give the causal ordering the `lot_event` schema reserved.
- **Connectivity + sync UI:** a `useSyncStatus()` hook + a glass **sync pill** in the shell (online · N queued · syncing · N failed) — the one piece of always-visible chrome that tells a picker in a dead zone their weigh-in is safe.

**Ports:** `src/lib/offline/{outbox,sync,db-idb}.ts`, `src/lib/ids.ts` (promoted). A thin `enqueueCommand()` wrapper that every later field-capture slice calls instead of the raw Server Action.

**UI:** the **sync pill** + an **offline outbox drawer** (glass slide-over listing queued/failed mutations with retry/dismiss) — world-class means the offline state is *legible and reassuring*, not a spinner. Reduced-motion safe; the pill is the only animated shell element and animates opacity/transform only.

**Key invariants (data-layer + client):**
- **Exactly-once under replay** — enforced server-side by the existing `idempotency_key` dedup in every RPC (S0 proves it with a "flush twice" test); the client never assumes its write landed.
- **No silent loss** — a business-rejected mutation dead-letters into a visible state; a network-failed mutation stays queued. This is a *client* invariant tested in jsdom.

**Dependencies:** Phase-1 command RPCs (already idempotent), `src/lib/ids.ts`. None on other Phase-2 areas — **this is the foundation S2/S5/S6/S8/S12 capture surfaces all sit on.**

**Tests (jsdom + node):** outbox enqueues offline and flushes on reconnect (mocked `navigator.onLine` + fetch); flush-twice is exactly-once (idempotent — the SAME `idempotency_key` second call is a no-op); business-rejection → dead-letter, network-failure → stays queued (the two paths must not be confused — this is the load-bearing test); UUIDv7 monotonicity; SW precache/runtime-cache strategy with mocked `caches`.

**Dogfood moment:** the farm manager turns off wifi, records three dummy actions, watches the sync pill say "3 queued", turns wifi back on, and sees them drain to the server with zero duplicates. The app stops being online-only and becomes **field-trustworthy** — the prerequisite the family must believe before they capture a single real lata offline.

**Highest risk + de-risk:** Service-Worker caching on a Next 15 App Router build is the classic footgun (stale chunks after deploy → white screen). **De-risk with a 1-day PROBE (P2-SPIKE-A):** stand up the SW + outbox against the *current* app, deploy to the free host, and verify (a) offline app-shell load, (b) a queued write surviving a forced SW update, (c) the cache-busting on a new build. Promote the probe into S0's walking skeleton only if all three pass.

---

### P2-S1 — Crew + worker system-of-record + append-only attendance + por-obra contracts + certification ledger *(THE PEOPLE TRUNK FOUNDATION; depends: S0 for offline attendance capture, else standalone)*

**Migration** `20260622090000_people_system.sql`:
- **Promote `crew text` in place** → `crews` table (`id text PK` e.g. `crew-norte`, `name`, `lead_worker_id → workers.id`, `season`, `farm_id NOT NULL` + RLS via the `app.apply_farm_rls` factory) and `crew_memberships` (`worker_id → workers.id`, `crew_id → crews.id`, `joined_at`, `left_at` nullable — **append-only**, membership history not a flag). Backfill from the existing `workers.crew` string; **retain `workers.crew` as a derived-backfilled column** (latest active membership) so every Phase-1 read survives, exactly the Phase-1 `area_ha`-retention move.
- **Worker identity, append-only:** keep `workers.id` text PK. Add an **`worker_event` append-only ledger** (or reuse `lot_event` with a `stream_key='worker:<id>'` — **decision flag**; recommend a dedicated `worker_event` with the same hash-chain trigger and immutability policy, because worker streams are PII-bearing and want their own RLS + grant surface). Add a `worker_identity` extension table for the dignity fields the Ngäbe-Buglé crew needs but the flat row lacks: `preferred_name`, `comarca_origin`, `id_doc_kind`/`id_doc_ref` (cédula or migrant-worker doc), `languages text[]` (e.g. `{es, ngäbere}`), `emergency_contact`, `rehire_eligible bool`.
- **Append-only attendance ledger:** `attendance_event` (`worker_id`, `crew_id`, `event_kind text check in ('clock-in','clock-out','rest-day','absent')`, `occurred_at`, `plot_id` nullable geofence stamp, `device_id`/`device_seq`/`idempotency_key`, hash-chained). The Phase-1 `workers.attendance` enum becomes a **derived view** `worker_attendance_today` projecting the latest event per worker — `workers.attendance` retained as a derived-backfilled column for Phase-1 reads. **This is the ledger payroll and labor-law evidence both read.**
- **Por-obra (piece-work) contracts:** `por_obra_contracts` (`id`, `worker_id`, `task_kind text` e.g. `picking`, `rate_basis text check in ('per-lata','per-kg','per-tarea','per-tree')`, `rate_usd numeric`, `effective_from`/`effective_to`, `signed_at`, `signature_ref`, `farm_id`). **Append-only with reversing-supersede** (a new row supersedes; the old is never UPDATEd) so the rate a worker agreed to on a given day is forever auditable — the same reversing-entry discipline as `cost_entry`.
- **Certification ledger:** `worker_certifications` (`worker_id`, `cert_kind text` e.g. `pesticide-handling`, `chainsaw`, `first-aid`, `issued_at`, `expires_at`, `issuer`, `doc_ref`) — append-only. Backs the IPM slice's **certification-gated hazard work** invariant (S12).
- **One-tap rehire:** `rehire_worker()` `SECURITY DEFINER` RPC — reactivates a `rehire_eligible` worker into a new season's crew with a fresh membership row and a `WORKER_REHIRED` event, carrying forward identity + valid certs, **never** re-keying their history. Treats the returning Ngäbe-Buglé crew as named partners, not new hires.

**Command RPCs (AD-8: `revoke execute from public`, `grant execute to authenticated`):** `record_attendance(worker, kind, plot, occurred_at, device…)`, `enroll_crew_member(worker, crew)`, `sign_por_obra_contract(worker, basis, rate, …)`, `record_certification(worker, kind, expires, …)`, `rehire_worker(worker, crew, season)`. **Read views/ports (`grant select to authenticated`):** `v_crew_roster`, `worker_attendance_today`, `v_active_por_obra(worker, task_kind, on_date)` (the rate-resolver payroll calls), `v_worker_certs_valid`.

**Ports:** `src/lib/db/people.ts` (read getters), `src/lib/db/commands/{recordAttendance,enrollCrewMember,signPorObra,rehireWorker}.ts`. Attendance writes route through S0's `enqueueCommand()` (offline clock-in at the plot).

**UI:** `/crew` route — **glass roster board**: crews as columns, members as draggable glass worker-cards (photo-optional avatar, comarca origin chip, valid-cert badges, attendance dot). A **worker profile sheet** with the append-only attendance timeline + por-obra contract history + cert ledger (chain-verified badge reused from Phase-1's audit drawer). **One-tap rehire** is a single glass button on a returning worker's card that fires `rehire_worker` — the dignity moment made literal. Bilingual labels (es / ngäbere) on the field-facing surfaces.

**Key invariants (data-layer):**
- **Attendance is append-only** — no UPDATE/DELETE policy + block trigger on `attendance_event` (same substrate as `lot_event`). You can correct only with a reversing/superseding event, never by mutating history. *Where:* RLS policy + block trigger + AD-8 grants (INSERT-only to authenticated, like the Phase-1 claim tables).
- **Por-obra rate is immutable once signed** — supersede-don't-update; `v_active_por_obra` resolves the rate effective on a date by `effective_from/to` windowing. *Where:* append-only table + CHECK that `effective_to >= effective_from`; rate edits are new rows.
- **Certification gates hazard work** (consumed by S12) — `v_worker_certs_valid` is the single source the spray-log RPC checks. *Where:* the gate fires in S12's RPC, but the *ledger* and its validity view live here.

**Dependencies:** S0 (offline attendance capture; degrades gracefully to online-only if S0 slips). Phase-1 `workers`, the `app.apply_farm_rls` factory, the `lot_event` hash-chain trigger pattern (reused for the new ledgers).

**Dogfood moment:** the family opens `/crew` at season start, sees last season's Ngäbe-Buglé crew as named returning partners, and **one-taps rehire** the eight pickers who came back — each carrying their identity, languages, and still-valid pesticide cert, with a fresh membership and a logged rehire event. The crew stops being a free-text string and becomes a remembered, respected roster.

**Highest risk + de-risk:** the `workers.crew` string → `crews`/`crew_memberships` backfill must be lossless and reversible. **De-risk** with a backfill-parity test: after migration, `v_crew_roster` reproduces the exact original `crew` grouping for every worker; the migration is a rename-aside (retain `workers.crew` derived) so nothing reads a dropped column.

---

### P2-S2 — Offline-first per-picker weigh capture *(THE GENESIS FIELD EVENT; depends: S0 outbox, S1 crew identity, Phase-1 record_cherry_intake + plot geometry)*

**Migration** `20260622091000_weigh_capture.sql`:
- **`weigh_event` append-only ledger** (the genesis event feeding traceability + pay + attendance + mill-intake at once): `worker_id → workers.id`, `crew_id → crews.id`, `plot_id → plots.id` (the geofenced plot), `lot_code → lots.code`, `kg numeric`, `ripeness ripeness` (the Phase-1 enum), `brix numeric` nullable, `scale_source text check in ('ble','manual')`, `captured_lat`/`captured_lng` (the geofence stamp), `occurred_at`/`recorded_at`, `device_id`/`device_seq`/`idempotency_key`, hash-chained, immutable. **This is the row that splits four ways downstream** — pay (× por-obra rate), attendance (presence proof), traceability (→ harvest → lot), mill-intake (Σ kg per lot).
- **`record_weigh_in()` command RPC** — the field write door. Validates the worker is an active crew member, the plot exists, mints/appends to the day's `harvests` row (or supersedes the flat Phase-1 `harvests` insert path), and **chains into `record_cherry_intake`** so a `JC-NNN` lot still auto-mints on first intake of a plot/day. One txn, idempotent, `SECURITY DEFINER`. Accepts the S0 client-minted ids.
- **Geofence as data, not gate:** `captured_lat/lng` + a `plot_geofence_distance_m` generated check (using the Phase-1 PostGIS `plots.geom`) writes a **`geofence_ok bool`** — a *data-quality signal* (was the weigh-in inside the claimed plot?), never a hard block (signal-dead reality means GPS can be stale; flag, don't reject — the Phase-1 `geom_area_ha` reconciliation precedent).

**Ports:** `src/lib/db/weigh.ts`, `src/lib/db/commands/recordWeighIn.ts` (routes through S0 `enqueueCommand()`). A `src/lib/ble/scale.ts` adapter (Web Bluetooth `navigator.bluetooth`, GATT weight-scale profile) behind a port so manual entry is the always-available fallback.

**UI:** `/weigh` — the **<3-second capture surface**, the single most-used screen on the farm. Full-bleed, glove-friendly, huge tap targets: **(1) badge the picker** (scan QR / tap from crew grid → preloaded offline), **(2) plot auto-selected from GPS** (confirm chip), **(3) BLE scale auto-reads kg** (or a giant numeric pad), **(4) one ripeness tap** (underripe/ripe/overripe as three big glass buttons). A satisfying glass "weight captured" confirmation + the running per-picker tally. Works **100% offline** (S0), every field preloaded. The sync pill shows it's safe.

**Key invariants (data-layer):**
- **Weigh events are append-only + exactly-once** — immutable ledger + idempotent RPC; a double-tap or a replay from the outbox is one row. *Where:* append-only policy + `idempotency_key` dedup.
- **kg conserves into the lot** — Σ `weigh_event.kg` for a lot/day reconciles to the `harvests.cherries_kg` and the lot's `origin_kg`. *Where:* a reconciliation view + test (signal, with a hard CHECK that kg ≥ 0).
- **Geofence is a signal, never a gate** — `geofence_ok` flags but never rejects. *Where:* generated column from `ST_Distance`, no blocking trigger.

**Dependencies:** **S0 (offline outbox — hard), S1 (crew identity to badge against — hard)**, Phase-1 `record_cherry_intake` (chains into it), `plots.geom` (geofence), `harvests`/`lots`. This is why S0+S1 must precede it.

**Dogfood moment:** a Ngäbe-Buglé picker empties a lata at 1,700 masl with no signal; the supervisor badges them, the plot auto-fills from GPS, the BLE scale reads 12.4 kg, one tap "ripe" — **<3 seconds, fully offline**, and the kg is now simultaneously this picker's pay, their attendance proof, and a node in lot `JC-NNN`'s genealogy. The single genesis event the whole farm's data flows from is captured with dignity and zero re-keying.

**Highest risk + de-risk:** **Web Bluetooth scale pairing** is the one genuinely uncertain integration ($0 constraint = a cheap BLE scale, not a proven SDK). **De-risk with P2-SPIKE-B (timeboxed PROBE):** pair ONE BLE scale via `navigator.bluetooth` GATT in the field, read a weight, confirm it works on the cheap Android phones the crew has. **If it fails, manual numeric entry is the shipped path** (the port makes BLE a drop-in upgrade) — the slice does not block on hardware.

---

### P2-S3 — Fermentation & wet-mill tracker (recipe library + live curves + cut-point alert + eco-mill water log) *(MAKE-QUALITY TRUNK; depends: Phase-1 processing_batches + advance_processing_stage + lot_event; parallel to S1/S2)*

**Migration** `20260622092000_fermentation_wetmill.sql`:
- **Versioned recipe library:** `ferment_recipes` (`id`, `name`, `method process_method`, `altitude_band text` e.g. `1360-1500` / `1500-1700`, `target_ph_curve jsonb`, `target_temp_curve jsonb`, `target_brix_drop`, `target_hours`, `version int`, `superseded_by` — **append-only versioned**, a recipe is never edited in place; the altitude-tuned Volcán-Geisha recipe is a first-class versioned asset).
- **Live ferment readings:** `ferment_readings` append-only ledger (`batch_id → processing_batches.id` or `lot_code`, `reading_kind text check in ('ph','temp','brix')`, `value numeric`, `occurred_at`, `device_id`/`device_seq`/`idempotency_key`, hash-chained). Manual taps now, **BLE pH/temp probe later** behind the same `src/lib/ble/*` port S2 establishes.
- **Predicted cut-point:** `v_ferment_cutpoint(batch)` — a `security_invoker` view fitting the live pH/Brix curve against the recipe's target and projecting the window-close time. The **cut-point alert** fires a task onto the existing `tasks` board (`category` extended or a `ferment-cut` kind) BEFORE the window closes — closed-loop, not a dashboard.
- **Eco-mill water log:** `mill_water_log` append-only (`batch_id`/`lot_code`, `liters numeric`, `occurred_at`) → `v_water_per_kg(lot)` derived view (the L/kg sustainability number Phase-3/4 carbon & Bird-Friendly dossiers read).

**Command RPCs:** `record_ferment_reading(batch, kind, value, …)`, `record_mill_water(batch, liters, …)`, `apply_ferment_recipe(batch, recipe_id)`. **Read views:** `v_ferment_curve(batch)`, `v_ferment_cutpoint(batch)`, `v_water_per_kg(lot)`. AD-8 grants throughout.

**Ports:** `src/lib/db/ferment.ts`, `src/lib/db/commands/recordFermentReading.ts` (offline via S0). A pure `src/lib/ui/curve-fit.ts` (tested, no DB) for cut-point projection.

**UI:** `/process/[lot]/ferment` — **live curve canvas**: pH/temp/Brix as server-rendered SVG curves (the Phase-1 zero-JS chart idiom) with the recipe's target band as a glass overlay and a **pulsing cut-point marker** projecting the window close. A big "log reading" glass control (manual tap, BLE later). The cut-point alert surfaces as a glass toast + a board task. Water-per-kg as a live sustainability chip.

**Key invariants (data-layer):**
- **Readings are append-only** — a ferment curve is evidence; no UPDATE/DELETE. *Where:* append-only policy + block trigger.
- **Recipes are versioned, never edited** — a batch records *which recipe version* it ran, so the curve is forever comparable to its own target. *Where:* `superseded_by` supersede chain + a CHECK that a referenced recipe version is immutable.

**Dependencies:** Phase-1 `processing_batches`, `lot_event`, the `tasks` board (cut-point alert target), S0 (offline reading capture). **No dependency on the people trunk** — runs in parallel.

**Dogfood moment:** the mill operator taps a pH reading every hour; the app draws the live ferment curve against the altitude-tuned recipe band and, 40 minutes before the window closes, fires a "cut now" alert to the board — the family hits the cut-point on the cup-defining ferment instead of guessing. The make-quality loop opens.

**Highest risk + de-risk:** the cut-point projection model is farm-knowledge, not a known formula. **De-risk:** ship v1 as a **simple target-threshold crossing** (pH ≤ recipe target → alert), log the readings, and let the family's own curves train a better projection later (Phase-4 ML). Don't block the slice on a perfect model — the *logged evidence* is the durable asset.

---

### P2-S4 — Drying management + the REPOSO GATE + capacity-tracked stations *(MAKE-QUALITY TRUNK; depends: S3 ferment output, Phase-1 advance_processing_stage — THE GATE EXTENDS IT)*

**Migration** `20260622093000_drying_reposo_gate.sql`:
- **Drying stations:** promote the flat `processing_batches.patio text` into `drying_stations` (`id`, `name`, `kind text check in ('patio','raised-bed','guardiola','parabolic')`, `capacity_kg numeric`, `farm_id`) + `station_occupancy` view tracking committed kg vs capacity (the same ATP-meter pattern as Phase-1 green inventory). Retain `processing_batches.patio` as derived-backfilled (Phase-1 reads survive).
- **Moisture & rest tracking:** `moisture_readings` append-only ledger (`batch_id`/`lot_code`, `moisture_pct numeric`, `occurred_at`, device cols, hash-chained) — the Phase-1 `processing_batches.moisture_pct` becomes the *latest reading* (derived). `v_reposo_status(lot)` derived view computes **(a)** moisture-stable = last N readings within **10.5–11.5%** and trending flat, **(b)** `rest_days_elapsed` since drying complete vs a configurable `min_reposo_days` (in `farm_season_config`).
- **THE REPOSO GATE** — the load-bearing Phase-2 invariant: **a lot physically cannot advance `drying → milled` until moisture-stable AND min-rest-days met.** Enforced in **two layers**: (1) a precondition check **added inside the existing `advance_processing_stage` RPC** — when `p_to_stage` crosses the drying→milling boundary it calls `v_reposo_status` and `raise exception 'reposo gate: lot % not rest-stable' using errcode='check_violation'` if unmet; (2) a **`BEFORE UPDATE` trigger backstop on `lots`** that blocks the stage transition even if a future code path tries to bypass the RPC. The disabled UI button is courtesy; the gate is in the database (the exact Phase-1 EUDR `issue_dds` precedent).
- **Weather-coupled cover alert:** `v_drying_weather_risk(station)` joins the Phase-1 per-plot Open-Meteo forecast feed to fire a "cover/move the beds" task onto the board when rain is incoming — closed-loop.

**Command RPCs:** `record_moisture(batch, pct, …)`, `assign_drying_station(batch, station)`. **Extended RPC:** `advance_processing_stage` gains the reposo precondition (one-author change in the schema lane). **Read views:** `v_reposo_status(lot)`, `station_occupancy`, `v_drying_weather_risk`. AD-8 grants.

**Ports:** `src/lib/db/drying.ts`, `src/lib/db/commands/recordMoisture.ts` (offline via S0).

**UI:** `/process/[lot]/drying` + a `/drying` stations board — **moisture curve** (server SVG) converging on the 10.5–11.5% target band; a **reposo gate chip** that is red ("resting — 4 days / 11.8%") then green ("rest-stable — clear to mill") with the exact reason; the advance-to-mill button **disabled with the gate's reason** until green. Station board shows capacity utilization as dual-bar meters (reused from Phase-1 ATP).

**Key invariants (data-layer):**
- **THE REPOSO GATE** — `drying → milled` blocked unless moisture ∈ [10.5, 11.5] stable AND `rest_days ≥ min_reposo_days`. *Where:* precondition in `advance_processing_stage` RPC **+** `BEFORE UPDATE` trigger backstop on `lots`. Two layers because this gate protects the cup — the single most cup-defining process control on the farm.
- **Moisture readings append-only** — the drying curve is evidence. *Where:* append-only policy.
- **Station never oversubscribed** — committed kg ≤ capacity, fail-closed. *Where:* a `prevent_overcapacity` trigger (the Phase-1 `prevent_oversell` pattern).

**Dependencies:** **Phase-1 `advance_processing_stage` (HARD — the gate is surgery on this RPC)**, S3 ferment output (drying follows ferment in the chain), `farm_season_config` (min-rest-days config), the Phase-1 Open-Meteo feed (weather alert), S0 (offline moisture capture).

**Dogfood moment:** a lot finishes drying; the family tries to advance it to milling and the app **refuses** — "reposo gate: JC-571 resting 6/10 days, moisture 11.9% not yet stable." Six days later it goes green and clears. For the first time the system, not memory, protects the rest period that defines the cup — and it's *impossible* to skip.

**Highest risk + de-risk:** modifying the live, hash-chain-critical `advance_processing_stage` RPC. **De-risk:** the gate is purely *additive* (a new precondition before the existing mutate+append) — write the reposo-gate test FIRST (advancing an unrested lot raises and rolls back with no event written, exactly the Phase-1 `issue_dds` rollback test), prove it fails on the current RPC, then add the minimal precondition. The trigger backstop is independently tested.

---

### P2-S5 — Morning crew dispatch (WhatsApp card) *(depends: S1 crew entities, S8 pasada plan for routing; the WhatsApp leg is the one paid-API flag)*

**Migration** `20260622094000_crew_dispatch.sql`:
- `dispatch_plans` (`id`, `date`, `crew_id`, `season`, `status text check in ('draft','sent','acknowledged')`, `farm_id`) + `dispatch_assignments` (`dispatch_plan_id`, `worker_id`, `plot_id`, `task_kind`, `target_kg` nullable, `ripeness_target`) — the morning routing, append-only with a supersede chain (re-planning around a rain front writes a new version, never edits).
- `dispatch_acknowledgements` (`dispatch_plan_id`, `worker_id`, `acked_at`, `channel text`) — proof the crew lead saw it.
- `dispatch_outbound` queue (ports-and-adapters seam, the Phase-1 EUDR `outbound_deliveries` pattern) — a message to be delivered, behind an adapter so the channel is swappable.

**Command RPCs:** `build_dispatch_plan(crew, date)` (reads S8's ripeness-aware pasada plan), `acknowledge_dispatch(plan, worker)`. **Read views:** `v_dispatch_card(plan)` (the renderable card payload). AD-8 grants.

**Ports:** `src/lib/db/dispatch.ts`, `src/lib/integration/dispatch/{port,queue,flush}.ts` + `adapters/{whatsapp,sms,web-share}.ts`. **The default $0 adapter is `web-share`** (a generated glass dispatch card the manager shares via the device's native share sheet into WhatsApp manually) — **no paid API**. The WhatsApp Business Cloud API adapter is a flagged, optional drop-in (see Decision §4).

**UI:** `/dispatch` — a **morning dispatch composer**: the ripeness-aware plan auto-drafted from S8, crew assignments as draggable glass cards onto plots (reusing the `/crew` and map surfaces), a live preview of the **dispatch card** (crew, plots in pasada order, target kg, ripeness note, bilingual). One tap "share" → native share sheet (web-share adapter) or the queue (WhatsApp adapter if enabled). Acknowledgement dots when the lead opens it.

**Key invariants (data-layer):**
- **Dispatch plans are append-only/superseded** — re-planning writes a new version; the morning's plan is forever auditable. *Where:* supersede chain.
- **No untrusted inbound drives a write** (carried from the global injection invariant) — an inbound WhatsApp ack is *recorded as evidence*, never an action trigger; the manager acts. *Where:* the inbound adapter only writes `dispatch_acknowledgements`, no command RPC.

**Dependencies:** S1 (crews), **S8 (pasada plan — the routing input; degrades to a manual plan if S8 slips)**, the map (plot picking). The WhatsApp *delivery* leg depends on a paid API (flagged) — **the slice ships fully on the $0 web-share adapter**.

**Dogfood moment:** at 5:30am the manager opens `/dispatch`, sees the ripeness-aware plan already drafted (plots ready for their pasada, in route order), tweaks two assignments, and shares the bilingual card into the crew-lead WhatsApp group with one tap. The crew knows exactly which plots to pick today — closed loop from the maturation model to the picker's morning.

**Highest risk + de-risk:** the WhatsApp Cloud API is **not $0** (free tier is limited service-conversation windows; user-initiated templates can bill). **De-risk:** ship the **web-share adapter as the default and only required path** — it is genuinely $0 and the manager already has WhatsApp open. The Cloud-API adapter is built behind the seam but **dormant until the family explicitly opts into the paid tier** (§4 decision).

---

### P2-S6 — QC & cupping (SCA CVA + legacy 100-pt + cupper-drift calibration + defect grading + QC-hold) *(depends: Phase-1 green_lots, S3 ferment curve + S4 drying curve for the cup-to-cause loop)*

**Migration** `20260622095000_qc_cupping.sql`:
- **Cupping sessions & scores:** `cupping_sessions` (`id`, `date`, `green_lot_code → green_lots.code`, `protocol text check in ('sca-cva','legacy-100')`, `cupper_id → workers.id`, `farm_id`) + `cup_scores` append-only (`session_id`, `attribute text`, `score numeric`, hash-chained). SCA CVA (the 2023 affective scale) and the legacy 100-point both modeled; a `v_cup_final_score(session)` view computes the protocol-correct total. **Bound back through `green_lot_code → lot_code` to its ferment time, drying curve, and plot** — the cup-to-cause loop.
- **Defect grading:** `defect_assessments` (`green_lot_code`, `defect_kind`, `count`, `category text check in ('primary','secondary')`) → feeds the Phase-1 **generated `green_lots.sca_grade`** (already a generated column from defect count + moisture — QC now supplies the real defect input).
- **Cupper-drift calibration:** `v_cupper_drift(cupper, attribute)` — a `security_invoker` view comparing each cupper's scores on **shared calibration samples** against the panel mean, surfacing systematic bias (a cupper consistently +3 on acidity). The calibration sample is a `cupping_sessions` row flagged `is_calibration`. *This is the cupper-drift invariant's evidence layer.*
- **QC-HOLD quarantine:** `qc_holds` append-only (`green_lot_code`, `reason`, `placed_at`, `released_at` nullable, `placed_by`). A held lot **cannot be reserved or shipped** — enforced by extending the Phase-1 `prevent_oversell` trigger family with a **`prevent_held_lot_commit` check** (a reservation/shipment against a lot with an open `qc_hold` fails closed).

**Command RPCs:** `record_cup_score(session, attribute, score, …)`, `place_qc_hold(lot, reason)`, `release_qc_hold(lot)`, `record_defects(lot, …)`. **Read views:** `v_cup_final_score`, `v_cupper_drift`, `v_qc_status(lot)`. AD-8 grants.

**Ports:** `src/lib/db/qc.ts`, `src/lib/db/commands/{recordCupScore,placeQcHold}.ts`. A pure `src/lib/ui/cva-scoring.ts` (the SCA CVA math, tested, no DB).

**UI:** `/qc` + `/qc/cup/[session]` — a **cupping form** that is a joy to use: the SCA CVA wheel as a glass radial input, live total, the lot's **cup-to-cause panel** alongside (this lot's ferment curve + drying curve + plot, so the cupper *sees why* it tastes how it does). A **cupper-drift calibration card** (your bias vs the panel, per attribute). QC-hold is a prominent red glass banner on a held lot everywhere it appears.

**Key invariants (data-layer):**
- **CUPPER-DRIFT calibration** — drift is surfaced as evidence on every calibration session; a flagged systematic bias is visible before a scarce-lot decision turns on a biased score. *Where:* `v_cupper_drift` view over shared calibration samples (evidence, not a hard block — you don't reject a cupper's score, you correct for known drift).
- **QC-HOLD blocks commerce** — a held lot cannot be reserved or shipped, fail-closed. *Where:* `prevent_held_lot_commit` trigger extending the Phase-1 `prevent_oversell` family. **This is the cup-protection teeth.**
- **Cup scores append-only** — a score is evidence bound to a lot forever. *Where:* append-only policy.

**Dependencies:** **Phase-1 `green_lots` + `sca_grade` generated column + `prevent_oversell` trigger family (HARD)**, S3 (ferment curve) + S4 (drying curve) for the cup-to-cause panel (degrades to score-only if those slip). The QC-hold→commerce block is what makes Phase-3 sales safe.

**Dogfood moment:** the family cups a finished Geisha micro-lot on the SCA CVA form, sees an 89.5, and **right beside the score sees the exact ferment curve and drying curve and the 1,650 masl plot that produced it** — the cup-to-cause loop closed for the first time. A defect lot gets a one-tap QC-hold and is now *physically un-sellable* until released. The thing that protects the Best-of-Panama premium is in the database.

**Highest risk + de-risk:** the SCA CVA scoring math (the 2023 affective protocol is non-trivial and easy to get subtly wrong). **De-risk:** implement `cva-scoring.ts` as a pure, exhaustively-tested function against published CVA worked examples FIRST (red→green), before any UI — the math is the durable asset and must be provably correct.

---

### P2-S7 — Blended piece-rate + hourly payroll with the MIN-WAGE MAKE-WHOLE GUARD + statutory withholding + disbursement + bilingual QR payslip *(THE PEOPLE-TRUNK CAPSTONE; depends: S1 attendance + por-obra, S2 weigh-events, Phase-1 cost_entry)*

**Migration** `20260622096000_payroll.sql`:
- **Pay periods & runs:** `pay_periods` (`id`, `start`, `end`, `season`, `status text check in ('open','calculated','approved','paid')`, `farm_id`), `payroll_runs` append-only.
- **Per-worker pay calculation** — `v_worker_pay(worker, period)` is the load-bearing derived view that blends:
  - **Piece-rate** = Σ `weigh_event.kg` (S2) × the `v_active_por_obra` rate (S1) effective each day.
  - **Hourly** = Σ hours from `attendance_event` clock-in/out (S1) × the worker's hourly rate.
  - **THE MIN-WAGE MAKE-WHOLE** = if (piece-rate + hourly) for the period < the legal Panama agricultural minimum wage for hours worked, a **make-whole top-up line** is computed so the worker is paid the legal minimum regardless of piece-rate yield. The minimum-wage value lives in **one canonical place** (`farm_season_config.min_wage_hourly_usd` / region table), never hardcoded.
- **Statutory withholding:** `payroll_deductions` derived per run — **CSS** (Caja de Seguro Social employee share), **Seguro Educativo**, and **décimo** (13th-month, accrued) computed by documented `v_payroll_statutory(worker, period)` rules, the rates in one canonical config table (`statutory_rates`), versioned by effective date.
- **Disbursement ledger:** `disbursements` append-only (`worker_id`, `pay_period_id`, `amount_usd`, `method text check in ('yappy','nequi','ach','cash-signed')`, `ref`, `disbursed_at`, `signature_ref` for signed-cash) → writes a `cost_entry` row (Phase-1 ledger) so payroll **is** COGS labor, no double-keying. **Append-only + reversing corrections** (the Phase-1 `cost_entry` discipline).
- **`run_payroll()` / `approve_payroll()` / `record_disbursement()` command RPCs** — calculation is a view, *committing* a run freezes a snapshot and writes events; disbursement is the irreversible action (manual confirm, never auto — the Phase-1 `issue_dds` "generate + park" precedent for money-shaped actions).

**Command RPCs:** `run_payroll(period)` (calculates → snapshot), `approve_payroll(run)`, `record_disbursement(worker, period, method, ref)`. **Read views:** `v_worker_pay`, `v_payroll_statutory`, `v_payslip(worker, period)` (the QR-payslip payload). AD-8 grants; disbursement RPC is the one that flags for human confirm.

**Ports:** `src/lib/db/payroll.ts`, `src/lib/db/commands/{runPayroll,recordDisbursement}.ts`. A pure `src/lib/payroll/calc.ts` (blend + make-whole + statutory, exhaustively tested, no DB).

**UI:** `/payroll` — a **pay-run cockpit**: per-worker rows showing piece-rate + hourly + **make-whole top-up (highlighted when it fires)** + deductions + net, with every figure linking to its provenance (the weigh-events, the attendance, the por-obra rate). A **bilingual QR payslip** (`@react-pdf/renderer`, the Phase-1 EUDR PDF idiom) the worker scans to see their own pay breakdown in es/ngäbere — dignity made legible. Disbursement is a deliberate, confirmed action with a signed-cash signature capture for the unbanked crew.

**Key invariants (data-layer):**
- **THE MIN-WAGE MAKE-WHOLE GUARD** — no worker's period pay can be below the legal minimum for hours worked; the top-up is computed at the data layer, not honored in the UI. *Where:* `v_worker_pay` computes the top-up line deterministically; a **CHECK/guard on the frozen `payroll_runs` snapshot** asserts `net_before_deductions ≥ legal_minimum(hours)` and `run_payroll` refuses to finalize a run that violates it (fail-closed). The minimum value is one canonical column. **This is the single most important Phase-2 labor invariant and the one the global "promise → enforcement" rule mandates be enforced at the data layer.**
- **Payroll/disbursement append-only** — a paid run is immutable; corrections are reversing entries. *Where:* append-only `payroll_runs`/`disbursements` + `cost_entry` reversing discipline.
- **Disbursement never auto-fires** — moving money is a confirmed human action. *Where:* the RPC requires explicit confirm; no automation path writes a disbursement.

**Dependencies:** **S1 (attendance ledger + por-obra rates — HARD), S2 (weigh-events for piece-rate — HARD)**, Phase-1 `cost_entry` (disbursement → COGS), `farm_season_config` (min wage + statutory rates). **This is why S1 and S2 must precede it** — payroll is the join of both capture trunks.

**Dogfood moment:** at period end the family runs payroll; a picker who hit a slow-ripening week shows piece-rate below minimum and the app **automatically adds a make-whole top-up** so they're paid the legal minimum — visibly, provably, at the data layer. Each worker scans a bilingual QR payslip and sees their own pay in Ngäbere. The crew is paid with dignity and the books are correct by construction.

**Highest risk + de-risk:** the Panama statutory math (CSS / Seguro Educativo / décimo / agricultural minimum wage) must be legally correct — getting it wrong underpays the crew or misfiles withholding. **De-risk:** the statutory rates and minimum-wage value are **data in a versioned config table the family confirms**, not hardcoded constants; `payroll/calc.ts` is exhaustively unit-tested against worked examples FIRST; **a real accountant/family review of the calc is an explicit Apply-OK human gate before the first real run.** This is a flagged decision (§4): the family must confirm the exact statutory rates.

---

### P2-S8 — Ripeness-aware harvest planning & pasada scheduler *(depends: Phase-1 plots/harvests + geometry; consumed by S5 dispatch; can read S12 NDVI)*

**Migration** `20260622097000_harvest_planning.sql`:
- **Maturation model inputs:** `plot_phenology` (`plot_id`, `bloom_date`, `gdd_accumulated numeric`, `ndvi_latest numeric` nullable, `updated_at`) — per-plot, fed by the Phase-1 weather feed (GDD from Open-Meteo temps) and optionally S12 NDVI.
- **Pasada plans:** `pasada_plans` append-only (`id`, `plot_id`, `season`, `pasada_number int`, `predicted_ready_date`, `predicted_ripe_pct`, `status`) — the staggered-pick schedule across the 1,360–1,700 masl altitude gradient (lower plots ripen first). Re-planning around a rain front writes a new version.
- **`v_harvest_readiness`** — the `security_invoker` view ranking plots by predicted ripeness-readiness, the input S5 dispatch reads to draft the morning card.

**Command RPCs:** `record_bloom(plot, date)`, `replan_pasada(plot)`. **Read views:** `v_harvest_readiness`, `v_pasada_calendar`. AD-8 grants.

**Ports:** `src/lib/db/planning.ts`. A pure `src/lib/agronomy/gdd.ts` (GDD accumulation + bloom→cherry phenology, tested, no DB).

**UI:** `/plan` — a **harvest-readiness map+calendar**: the Phase-1 map tinted by predicted readiness (which plots to pick this week), a pasada calendar staggering picks down the altitude gradient, and a "re-plan around rain" action when the forecast shifts. Feeds directly into S5's morning dispatch.

**Key invariants (data-layer):**
- **Pasada plans append-only/superseded** — the plan history is auditable; re-planning is a new version. *Where:* supersede chain.
- **Readiness is derived, never typed** — `v_harvest_readiness` computes from GDD/phenology/NDVI, never a hand-set "ready" flag (the Phase-1 derived-metrics discipline). *Where:* `security_invoker` view.

**Dependencies:** Phase-1 plots + geometry + the Open-Meteo weather feed (GDD), `harvests` (historical ripeness). **Consumed by S5 (dispatch)** — so S8 should land before or with S5. Optionally reads S12 NDVI (degrades to weather-only GDD without it).

**Dogfood moment:** the family opens `/plan` and sees their farm tinted by *when each plot will be ready* — the 1,400m plots ready next week, the 1,700m Geisha two weeks out — and a staggered pasada calendar that re-plans when rain is forecast. Picking stops being reactive and becomes a model the dispatch card runs on.

**Highest risk + de-risk:** the GDD bloom→cherry model is farm-knowledge with real uncertainty. **De-risk:** ship v1 as a **transparent GDD-threshold model with the family's own historical bloom/harvest dates as the calibration**, and surface a **confidence note** (the same honest-confidence ethos as S12's data badge) — never present a prediction as certainty. The logged blooms train a better model in Phase 4.

---

### P2-S9 — *(folded)* — Recipe/curve UI polish & cross-process timeline

*(No standalone migration. The make-quality trunk's unified per-lot process timeline — ferment → drying → reposo → QC, one glass scrollytelling view over S3/S4/S6 events — is built as the world-class UI capstone INSIDE S6, reading the existing `lot_event` projection. Listed for completeness; it is not a separate schema slice. This keeps the slice count honest: it is UI over already-shipped data.)*

---

### P2-S12 — Satellite NDVI/NDRE + Sentinel-1 SAR fusion (confidence badge) + IPM scouting + phenology *(BRANCH READ off geometry; depends: Phase-1 plot geometry only; feeds S8 + the task board)*

**Migration** `20260622098000_remote_sensing_ipm.sql`:
- **Vegetation indices:** `plot_ndvi_observations` append-only (`plot_id`, `source text check in ('sentinel-2','sentinel-1-sar')`, `index_kind text check in ('ndvi','ndre','sar-backscatter')`, `value numeric`, `observed_at`, `cloud_pct numeric`, `confidence text check in ('high','medium','low')`). **The fusion confidence badge** — `v_plot_vegetation(plot)` fuses optical (Sentinel-2 NDVI/NDRE) with SAR (Sentinel-1, cloud-penetrating) and emits an **honest confidence level** tuned for Volcán's near-daily cloud (optical-stale → fall back to SAR → badge says "radar, medium confidence"). This is the differentiator: a naive optical-only tool is useless half the year here.
- **IPM scouting:** `scouting_observations` append-only (`plot_id`, `pest_kind text` e.g. `broca`/`roya`, `incidence_pct`, `observed_at`, `worker_id`, device cols) → `v_ipm_threshold(plot, pest)` applies the **economic-threshold engine** (broca/roya action thresholds) and fires a spray/control task onto the board when crossed — closed-loop.
- **PHI/REI-safe spray log:** `spray_applications` append-only (`plot_id`, `product`, `active_ingredient`, `phi_days int` pre-harvest interval, `rei_hours int` re-entry interval, `applied_at`, `worker_id`). **Certification gate:** `record_spray()` RPC checks `v_worker_certs_valid` (S1) and **refuses if the applicator lacks a valid pesticide-handling cert** — fail-closed. A `v_plot_phi_status` view blocks harvest planning (S8) from scheduling a pick inside an active PHI window.
- **Phenology:** writes `plot_phenology.bloom_date`/`gdd` (S8's input) from the GDD model.

**Command RPCs:** `record_scouting(plot, pest, incidence, …)`, `record_spray(plot, product, …)` (cert-gated), `ingest_ndvi(plot, source, value, …)` (called by an off-DB ingest script). **Read views:** `v_plot_vegetation`, `v_ipm_threshold`, `v_plot_phi_status`. AD-8 grants.

**Off-DB (Andres-gated, $0):** `scripts/ingest-sentinel.mjs` — pulls Sentinel-2 (NDVI/NDRE) and Sentinel-1 (SAR) from the **free Copernicus Data Space Ecosystem** (no paid SaaS), clips to `plots.geom`, computes per-plot index means + cloud %, and calls `ingest_ndvi`. Precomputed, never a live raster on a render path (the Phase-1 terrain-derive precedent). Runs on the same keep-warm cadence as the Phase-1 terrain script.

**Ports:** `src/lib/db/remote-sensing.ts`, `src/lib/db/commands/{recordScouting,recordSpray}.ts` (offline via S0). Pure `src/lib/agronomy/{economic-threshold,confidence-fusion}.ts` (tested, no DB).

**UI:** `/satellite` (map layer) + `/scouting` — the **NDVI/SAR map** with the **confidence badge prominent** (the honest "radar-only, medium confidence" state is a first-class UI state, never hidden); offline IPM scouting capture (huge tap targets, S0); a spray log that **refuses an uncertified applicator** with a clear reason; PHI/REI countdown chips on every plot.

**Key invariants (data-layer):**
- **Confidence is never hidden** — every vegetation reading carries and surfaces its confidence; SAR-fallback under cloud is explicit. *Where:* `confidence` column + `v_plot_vegetation` fusion logic; a UI state, not a footnote.
- **CERTIFICATION-GATED HAZARD WORK** — a spray cannot be logged by an applicator without a valid cert. *Where:* `record_spray` RPC checks `v_worker_certs_valid` (S1) and raises, fail-closed.
- **PHI/REI blocks harvest** — a pick cannot be planned inside an active pre-harvest interval. *Where:* `v_plot_phi_status` blocks S8's planning; a guard on the harvest-readiness view.
- **Observations append-only.** *Where:* append-only policies.

**Dependencies:** Phase-1 plot geometry only (hard) + **S1 (cert ledger for the spray gate — hard)**. Feeds S8 (NDVI + PHI) and the task board. Otherwise a free-standing branch — can land any time after S1.

**Dogfood moment:** the family opens the satellite layer during a cloudy week and instead of a useless blank optical map, sees SAR-fused vegetation health with an honest "radar, medium confidence" badge — the genuine edge over any generic NDVI tool in Volcán. A scout logs broca incidence offline; it crosses the economic threshold and auto-fires a control task. An uncertified worker is *prevented* from logging a spray. Agronomy becomes a closed loop that respects safety and the cloud.

**Highest risk + de-risk:** the Copernicus Data Space ingest (auth, quota, the SAR processing) is the one real external-data integration. **De-risk with P2-SPIKE-C (PROBE):** pull ONE Sentinel-1 + one Sentinel-2 scene for one plot polygon via the free Copernicus API, compute the indices, and confirm the $0 quota is workable on the keep-warm cadence. If the SAR processing proves too heavy for $0 compute, ship optical-NDVI-only with the confidence badge honestly saying "optical, low confidence when cloudy" — the badge architecture makes SAR a drop-in upgrade.

---

## 3. Cross-slice rails (every slice, non-negotiable — carried verbatim from Phase 1)

- **One schema author, serial lane.** P2-S1→S12 migrations are a single serialized author (the one-migration-author rule — Andres's standing law). App-code ports, UI components, and integration adapters fan out **file-disjoint in parallel** within each slice, closed by a reviewer pass. The reposo-gate surgery on `advance_processing_stage` (S4) and the `prevent_oversell`-family extension (S6 QC-hold) are the two places the lane touches *existing* objects — they are single-author, test-first, additive-only changes.
- **Migration timestamps strictly `> 20260621110000`** (the live `phase1_review_fixes` head — *not* `094500`). Renumbered to the `20260622NNNNNN` lane. Every new table/view needs an explicit `grant select … to authenticated`; every RPC `revoke execute from public` then `grant execute to authenticated`; **never grant to `anon`** (the one public-microsite view stays the only exception).
- **The write door is the command RPC** — mutate row + append event in one `SECURITY DEFINER` txn, `set search_path = public, extensions`, idempotent on `idempotency_key`, accepting client-minted `device_id`/`device_seq` (so every Phase-2 write is offline-replayable through S0's outbox).
- **Append-only everywhere people or quality are involved** — attendance, por-obra, payroll, disbursement, cup scores, ferment/moisture/scouting readings, dispatch plans are all append-only ledgers with reversing/superseding corrections, never UPDATE/DELETE. Same hash-chain + immutability substrate as the Phase-1 `lot_event`. (Worker-stream ledgers get their own PII-scoped RLS/grants.)
- **TDD test-first, every PR** (repo hard rule, no exemptions, incl. pure UI/glass): lowest layer that catches the root cause — SQL/RLS/gate logic on PGlite (replaying the REAL migrations), pure domain math (CVA scoring, payroll calc, GDD, confidence fusion) in node, render/smoke in jsdom. The Phase-1 PGlite + vitest `db`/`ui` split substrate already exists — Phase-2 extends it. Offline-outbox tests (S0) mock `navigator.onLine`/`fetch`/`caches`.
- **World-class glass UI is in-scope of each slice, not a follow-up** — the sync pill (S0), crew roster + one-tap rehire (S1), the <3s weigh surface (S2), live ferment/drying curves (S3/S4), the reposo gate chip (S4), the dispatch card (S5), the CVA cupping wheel + cup-to-cause panel (S6), the make-whole-highlighted pay cockpit + bilingual QR payslip (S7), the readiness map (S8), the confidence-badge satellite layer (S12) each ship Apple-grade, 60fps GPU-only, reduced-motion, AA-on-glass, bilingual where field-facing, with a render test, inside their slice.
- **$0-forever ceiling** — free Copernicus Data Space, Open-Meteo, MapLibre/PostGIS on Supabase free tier, hand-rolled SW, `@react-pdf/renderer`, web-share for dispatch. **The only paid-API temptations are flagged and dormant** (WhatsApp Cloud API for S5, any managed disbursement API for S7) — neither is required to ship the slice.
- **Apply-OK human gates:** S0 (Service-Worker deploy/cache-bust spike before the offline contract is trusted), S1 (the `workers.crew` backfill — rename-aside, prove parity), S4 (the reposo-gate surgery on the live stage RPC — security/process-control posture), S7 (**the statutory-rate & minimum-wage values confirmed by the family/an accountant before the first real payroll run** — money + legal), S12 (the Copernicus ingest spike + the keep-warm cadence). Plus the standing Phase-1 gates (backup scheduler, the `<7-day` keep-warm heartbeat — which the S12 Sentinel ingest now doubles as).

---

## 4. The biggest open DECISION the family / Andres must make before building

**Primary decision — multi-user roles vs single-owner, NOW unavoidable.** Phase 1 ran on a single authenticated session (`app.current_farm_id()` coalesces to the sole farm, zero JWT plumbing). **Phase 2 introduces three distinct actors who cannot share one login:** the *owner/manager* (dispatch, payroll approval, QC-hold), the *supervisor/crew-lead* (weigh capture, attendance, scouting in the field), and arguably the *picker* (badge identity, payslip view). The data layer is ready (`farm_id` RLS, worker identity), but **the family must decide the role model before S1**: (a) **single shared device, owner-only login** (simplest, $0, but no per-actor accountability and the supervisor uses the owner's session) vs (b) **per-actor roles** (supervisor/manager JWT claims driving RLS — real accountability, the attendance/payroll evidence is genuinely attributable, but needs the role-claim plumbing S1 would otherwise skip). **Recommendation: build (b)'s data layer** (a `worker_id`/`role` claim path) because attendance and payroll evidence is worthless if anyone can write as anyone — but **the UX can start as (a)** (one device, badge-to-act) and grow into per-device logins. This decision shapes S1's RLS and cannot be deferred.

**Secondary, flagged, must-confirm-before-the-dependent-slice:**
1. **Statutory payroll values (S7 — legal).** The exact Panama agricultural minimum wage, CSS/Seguro Educativo/décimo rates must be **confirmed by the family or an accountant** and entered as versioned config data — not guessed. This is an Apply-OK gate before the first real run. **Wrong = the crew is underpaid or withholding is misfiled.**
2. **WhatsApp delivery (S5 — $0 vs paid).** Ship the **web-share adapter** ($0, manual share into WhatsApp) as the default. Only opt into the WhatsApp Business Cloud API (which can bill on user-initiated templates) if the family decides automated delivery is worth leaving the $0 envelope. **Default: stay $0.**
3. **Disbursement rails (S7 — $0 vs paid).** Yappy/Nequi/ACH automated disbursement APIs are not $0 and move money. Ship **manual-confirm disbursement with a recorded ref + signed-cash capture** ($0, the irreversible-action-never-auto-fires precedent). Automated rails are a flagged later option.
4. **BLE scale & probes (S2/S3 — hardware spike).** Confirm one cheap BLE weight scale and (later) pH/temp probe pair via Web Bluetooth on the crew's actual Android phones (P2-SPIKE-B). Manual entry is the guaranteed fallback; hardware is an upgrade, never a blocker.
5. **Worker-stream ledger placement (S1 — design).** Dedicated `worker_event`/`attendance_event` tables (recommended, PII-scoped RLS) vs reusing `lot_event` with a `worker:<id>` stream key. Recommend dedicated — confirm before S1's migration.

---

## 5. Critical-path summary

```
P2-S0 (offline PWA + outbox) ──┬─> P2-S1 (crew + worker SoR + attendance) ──┬─> P2-S2 (weigh capture) ──┐
  [CAPTURE TRUNK FOUNDATION]   │      [PEOPLE TRUNK FOUNDATION]              │                          ├─> P2-S7 (PAYROLL + make-whole)
                               │                                             └─> P2-S12 (NDVI/SAR/IPM, cert-gated spray)
                               │
Phase-1 processing spine ──────┴─> P2-S3 (ferment/wet-mill) ─> P2-S4 (drying + REPOSO GATE) ─> P2-S6 (QC/cupping + QC-hold)
  [MAKE-QUALITY TRUNK]                                            (extends advance_processing_stage)   (extends prevent_oversell)
                                                                                         │
Phase-1 plot geometry ──────────────> P2-S8 (ripeness/pasada planner) ──> P2-S5 (crew dispatch / WhatsApp card)
                                          (reads S12 NDVI optionally)        (reads S8 plan; $0 web-share default)
```

**Trunk that must land first, in order:** **P2-S0 → P2-S1 → P2-S2.** S0 is the offline foundation every field-capture surface sits on; S1 is the people foundation payroll and the cert-gate need; S2 is the genesis field event. After S2, **P2-S7 (payroll)** and **P2-S12 (agronomy)** unlock. The **make-quality trunk (S3 → S4 → S6)** runs in parallel from day one because it extends the Phase-1 *processing* spine, sharing only `lot_code` with the people trunk. **S8 (planner) → S5 (dispatch)** is the third, shortest chain off plot geometry. The two highest-stakes invariants — the **reposo gate (S4)** and the **min-wage make-whole guard (S7)** — sit at the ends of their trunks and are each enforced at the data layer with a fail-closed backstop.

**Slice count:** S0, S1, S2, S3, S4, S5, S6, S7, S8, S12 = **10 buildable schema/substrate slices** (S9 folds into S6 as UI; the numbering preserves the capability map). Build order honoring the critical path: **S0 → S1 → {S2, S3} → {S4, S8} → {S6, S5, S12} → S7** (S7 last — it is the join of S1+S2 and the most legally sensitive).

**Files grounding this sequence (read-only, absolute):** `/Users/andres/coffee-farm-operations-worktrees/phase1-deliver/supabase/migrations/{20260620120000_init,20260621092000_event_log_units_lot_graph,20260621093500_green_inventory,20260621094000_costing,20260621102000_eudr_traceability,20260621110000_phase1_review_fixes}.sql`, `.../docs/ROADMAP.md`, `.../CLAUDE.md`, `/Users/andres/janson-coffee-PHASE1-DESIGN.md`. **Proposed new migrations (renumbered to clear the live `110000` head):** `20260622090000`–`20260622098000` (S1–S12).

---

## 6. Phase 3 & 4 sequencing outline (the forward look)

**Phase 3 — Monetize the chain (commerce + provenance-as-premium + books reconcile).** Spine-first, it inherits Phase-2's people/quality data and the Phase-1 green-lot/genealogy/COGS spine:
- **P3-S0/S1 — Dual-regime pricing service** (ICE 'C' hedge for volume; decoupled cup-score/scarcity/auction-comp pricing for reserve Geisha — reads S6 cup scores; **never anchor a $13k/lb lot to the commodity index**). Foundation: a `price_book` + the pricing-rule engine. *Must land first — every commerce slice prices off it.*
- **P3-S2 — B2B green backbone** (offer list → GCA/ECF contract + Incoterms → sample tracking → fixation cockpit → export doc pack auto-filled from lot data) — reads green_lots + QC + EUDR DDS, zero re-keying.
- **P3-S3 — Specialty auction/marketplace channel** (Best of Panama / CoE / Algrano) — the single highest price-multiplier; reads cup scores + provenance.
- **P3-S4 — DTC storefront + per-lot QR provenance microsite** (Next.js + Supabase + **Stripe** — the first deliberate paid-rail decision; GS1 Digital Link) — lot-linked SKUs over the Phase-1 microsite.
- **P3-S5 — Reserve Club subscriptions + offline DGI farm-store POS** — closes cherry-to-cash at the gate.
- **P3-S6 — Dry milling + roasting** (huller→sorter outturn mass balance extending the lot-graph; versioned roast profiles + Artisan .alog import; roast-to-SKU) — extends `advance_processing_stage` past green, the natural continuation of the Phase-2 make-quality trunk.
- **P3-S7 — QBO/Xero sync + Panama DGI Factura Electrónica via a certified PAC** — the COGS/disbursement ledgers (Phase-1 `cost_entry` + Phase-2 payroll) are already the journal source.
- *Decision gate before P3:* Stripe + a PAC are the first intentional departures from $0-forever — a deliberate, revenue-justified call.

**Phase 4 — Estate intelligence & the conservation moat (least-copyable).** Reads everything; builds the differentiators:
- **P4-S1 — Grounded ML/copilot** (explainable P10/P50/P90 yield by variety+grade, offline pest image diagnosis, sell-vs-hold, Spanish-first "ask your farm") — **cites Janson's own rows, human-confirmed writes only, the hard injection invariant** (untrusted text never drives a write — carried from the global rule). Trained on the Phase-2 logged evidence (ferment curves, GDD blooms, cup scores).
- **P4-S2 — The 200-ha reserve as a first-class engine** (AudioMoth + BirdNET quetzal bioacoustics, Bird-Friendly thresholds encoded) — the single least-copyable moat, built on the Phase-1 `reserve_zones` geometry.
- **P4-S3 — Sustainability evidence graph** (per-lot CO2e via Cool Farm/Verra VM0042 agroforestry insets, biodiversity, the Phase-2 mill-water L/kg, cert dossiers) — one substrate, four views; monetizable carbon insets.
- **P4-S4 — Prescriptive agronomy** (renovate-vs-stump-vs-hold by tree-age + cup-trend; varietal-to-terroir fit; nursery back-planning).
- **P4-S5 — IoT soil/microclimate nervous system + per-tree census** (LoRaWAN/sensors feeding rust-risk & frost-nowcast; flagship Geisha trees earn per-tree QR provenance) — the first hardware-spend slices.
- **P4-S6 — Multi-tenant isolation at the DB layer** (license the proven platform to neighboring Volcán estates) — the `farm_id` RLS built since Phase-1 line one finally goes live; an *architecture-already-done, business-now-activated* slice.
- **P4-S7 — Agro-tourism self-service booking** (Lagunas Adventures tour → the literal micro-lot a guest tastes → QR sale) — converts experience to a traceable sale.
- *Sequencing rule:* P4 is reads-and-intelligence over the now-complete operational + commercial + people + quality spine; it builds **no new trunk**, only the least-copyable projections — exactly as the moat (reserve + decoupled Geisha pricing + SAR fusion + dignity-first labor) is the compounding payoff of everything Phases 1–3 made true.
