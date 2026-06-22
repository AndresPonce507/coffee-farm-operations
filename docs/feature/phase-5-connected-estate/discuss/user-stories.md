<!-- markdownlint-disable MD024 -->
# User Stories — Phase 5 "Connected Estate"

> LeanUX stories grounded in the live codebase. Every story carries a `job_id` (→
> `docs/product/jobs.yaml`) and — when not `@infrastructure` — an **Elevator Pitch**
> (Before / After / Decision-enabled). Acceptance criteria are derived from the UAT
> scenarios and embedded per story (no standalone acceptance-criteria.md).

## System Constraints (cross-cutting — apply to every story's AC + the DoR)

> Governed by `docs/feature/phase-5-connected-estate/PRINCIPLE.md` (the north star). Its **Rule 2**
> raises the bar: *"Every clickable is a real CREATE or EDIT surface… Reading is the floor; editing
> and creating real records is the expectation."* So where a story surfaces an entity, the default
> is not just a read/navigate link but a **write/edit affordance** (modal/form/inline editor) wired
> to the SECURITY-DEFINER command-RPC write door — unless the entity is genuinely read-derived
> (e.g. a computed COGS number), in which case the navigate-to-dossier link is the correct wiring.
> DESIGN must decide, per element, between *create/edit* and *navigate* — never *cosmetic*.

- **Wiring AC (mandatory on every story):** every control introduced or touched is wired to
  real DB data or a real action — no cosmetic-only, no mock data; the story ships a **render
  test + a behavior test** proving the wiring AND the connection it makes (the navigation/RPC/ripple).
- **Create/Edit-first AC (PRINCIPLE Rule 2):** for every entity a story surfaces, prefer a real
  create/edit surface over a read-only view; the acceptance test answers "what happens when I click
  this, and where does that data go?" with a concrete write-path + downstream-update answer.
- **No new mock reads:** `grep "from '@/lib/data/'"` over non-test `src/` must not increase; a
  story that touches Workers must *decrease* it (the `CREWS` leak).
- **No dead clicks:** no element ships with a pointer affordance and no destination/handler.
- **Solution-neutral writes only via the spine:** all writes go through existing
  SECURITY-DEFINER command RPCs (`record_weigh_in`, `advance_processing_stage`, …); DISCUSS
  prescribes outcomes, DESIGN picks the wiring.
- **es-PA first · offline-safe · $0 / free-tier · world-class liquid-glass UI · TDD test-first**
  (per repo CLAUDE.md) — these are requirement constraints, not implementation detail.
- **Dossiers never fabricate:** a dossier for a non-existent entity 404s (it must not render an
  empty/fake story) — mirrors the live `/lots/[code]` `notFound()` behavior.

---

## US-01: The morning weigh-in visibly ripples to the Dashboard and the tally (WALKING SKELETON)

`job_id: J1`

### Elevator Pitch
- **Before:** Marcelino captures a weigh-in, but Don Ricardo can't tell whether the Dashboard
  headline reflects it without re-checking — so he re-keys the morning total into a spreadsheet.
- **After:** On the **Weigh tab**, the moment Capturar succeeds, a proof panel shows "esto también
  actualizó: Tablero +18.4 kg · Lote JC-7NN", and the **Dashboard "Today"** figure already includes it.
- **Decision enabled:** Don Ricardo decides he can trust the cockpit's morning number and stops
  reconciling by hand.

### Problem
Don Ricardo is the owner who reconciles today's picking across a notebook and three spreadsheets
because he doesn't trust that one screen agrees with another. He finds it tedious and error-prone
to re-key the same weight to confirm the headline.

### Who
- Owner | glances at the Dashboard after the morning pick | wants to trust the number without re-entry.
- Crew-lead | at the weigh station | wants the tally to reflect the tap instantly.

### Solution
Surface the J1 ripple that already exists: one `record_weigh_in` already updates
`v_weigh_today_by_picker` (tally) and `harvests`→`season_summary_view` (Dashboard). Add a
**reactive proof panel** on Weigh that names + links the consumers it just updated, and ensure
the Dashboard "Today"/season headline derives from the same harvests truth.

### Domain Examples
1. **Happy path** — Lupita Gonzalez, plot Tizingal-Alto, 18.4 kg ripe. Capturar → tally shows
   "Lupita 18.4 kg · 1 lata"; Dashboard "Today" rises by 18.4 kg; proof panel links lot JC-7NN.
2. **Edge case** — Lupita's second lata (12.1 kg) the same morning: tally shows 30.5 kg · 2 latas;
   Dashboard "Today" rises by 12.1 kg more; the same lot JC-7NN grows (no second lot minted).
3. **Error/offline** — no signal: Capturar queues; when signal returns, exactly one weigh-in lands
   and the ripple appears once (no double count).

### UAT Scenarios (BDD)
#### Scenario: The Dashboard headline reflects a weigh-in with no re-entry
Given Marcelino has captured Lupita's 18.4 kg ripe weigh-in at Tizingal-Alto today
When Don Ricardo opens the Dashboard
Then the "Today" figure includes the 18.4 kg
And the season headline is derived from harvests (not a hand-authored aggregate)
And Don Ricardo made no additional entries

#### Scenario: The Weigh tally and a proof panel confirm the ripple on the same screen
Given Marcelino has just captured the 18.4 kg weigh-in
Then the per-picker tally shows "Lupita 18.4 kg · 1 lata"
And a proof panel lists the Dashboard and the lot it also updated
And each item in the proof panel links to that destination

#### Scenario: An offline weigh-in ripples exactly once
Given the device has no signal when Marcelino taps Capturar
When signal returns and the queued weigh-in replays
Then the tally and Dashboard each reflect the 18.4 kg exactly once

### Acceptance Criteria
- [ ] Dashboard "Today"/season headline reads from `season_summary_view` (verified: no `__deprecated` read).
- [ ] Weigh proof panel names ≥2 downstream consumers it updated and links each.
- [ ] Capturar control is wired to `record_weigh_in` (already true) and the result drives the tally + proof.
- [ ] Offline replay is exactly-once (no double ripple).
- [ ] Ships a render test (proof panel renders the consumers) + a behavior test (a weigh-in updates the tally and the Dashboard figure derives from harvests).

### Outcome KPIs
- **Who:** the owner · **Does what:** trusts the morning headline without re-keying ·
  **By how much:** hand-reconciliation of the daily total drops from daily to 0 ·
  **Measured by:** dogfood observation + "derived from N harvests" provenance shown ·
  **Baseline:** today he re-keys every morning.

### Technical Notes
- Reuses live `record_weigh_in` (20260622102000), `v_weigh_today_by_picker`, `season_summary_view`,
  `getSeasonProvenance`. Only NEW surface: the proof panel + the lot link.

---

## US-02: Replace the mock crew constant with the live crews table

`job_id: J4`

### Elevator Pitch
- **Before:** On the **Workers tab**, the crew dropdown and crew board read a hardcoded `CREWS`
  constant — add a crew in the DB and it never appears; the UI lies about reality.
- **After:** The crew dropdown and crew board on **/workers** read the live `crews` table, so they
  always match what's actually on the farm.
- **Decision enabled:** Don Ricardo assigns a worker to a crew that actually exists and trusts the board.

### Problem
The owner sees crews in the Workers UI that come from a mock constant, not the real `crews`/`crew_memberships`
tables. It's misleading: the one place in the UI still showing fake data.

### Who
- Owner / crew-lead | manages roster + crew assignment | needs crews to be real.

### Solution
Add a `getCrews()` getter over the live `crews` table; replace the two `@/lib/data/workers` `CREWS`
imports (worker-form.tsx, crew-board.tsx) with it.

### Domain Examples
1. **Happy path** — Crew "Norte" exists in `crews`; the dropdown lists it; assigning Lupita to it persists.
2. **Edge case** — A crew added directly in the DB ("Sur-2") appears in the dropdown on next load.
3. **Error** — No crews exist yet: the dropdown shows an empty state, not phantom mock crews.

### UAT Scenarios (BDD)
#### Scenario: The crew dropdown reflects the real crews table
Given crews "Norte" and "Sur" exist in the database
When Don Ricardo opens the new-worker form on /workers
Then the crew dropdown lists exactly "Norte" and "Sur"
And no crew comes from a hardcoded constant

#### Scenario: The crew board reflects the real crews
Given a crew "Sur-2" was added directly in the database
When Don Ricardo opens the Workers tab
Then the crew board shows "Sur-2"

#### Scenario: No mock import remains in the Workers UI
Given the Workers components are loaded
Then no Workers UI file imports CREWS from "@/lib/data/workers"

### Acceptance Criteria
- [ ] `worker-form.tsx` and `crew-board.tsx` read crews via a live getter, not `@/lib/data/workers`.
- [ ] The repo-wide `grep "from '@/lib/data/'"` over non-test UI returns **0** hits after this story.
- [ ] Ships a render test (board renders live crews) + a behavior test (getter returns DB crews; a DB-added crew surfaces).

### Outcome KPIs
- **Who:** the Workers UI · **Does what:** reads crews from the live table · **By how much:**
  mock-data reads on prod paths 1 → 0 · **Measured by:** the grep guard · **Baseline:** 2 UI files import CREWS.

### Technical Notes
- Live tables: `crews`, `crew_memberships` (20260622090000/104000). `getCrewRoster` already exists in `src/lib/db/people.ts`.

---

## US-03: Open any plot's whole story (the /plots/[id] dossier)

`job_id: J2`

### Elevator Pitch
- **Before:** Clicking a plot on the **Map**, **Plots**, **Satellite**, or **EUDR** tab does nothing
  (the Map even shows a pointer cursor that goes nowhere) — to learn a plot's story Don Ricardo visits six tabs.
- **After:** Clicking any plot opens **/plots/[id]** — its harvests, sprays + PHI status, satellite
  vegetation, costs, and lots-of-origin in one view.
- **Decision enabled:** Inés decides whether a plot is safe and ready to pick from one screen.

### Problem
A plot's life is scattered across Harvests, Scouting, Satellite, Costing, and EUDR. There is no
plot dossier, and the Map's plot click is a dead-end.

### Who
- Agronomist | assessing a plot's readiness + safety | wants its whole story in one place.
- Owner | answering "what's going on with Tizingal-Alto?" | wants one click.

### Solution
Build `/plots/[id]` aggregating the plot's harvests, `v_plot_phi_status`, satellite vegetation,
plot cost, and EUDR origin status; make every plot-bearing row/card across all tabs link to it,
and give the Map polygon a real click → `/plots/[id]` (killing the DEAD click).

### Domain Examples
1. **Happy path** — Tizingal-Alto: dossier shows this season's harvests, an active PHI-until date,
   vegetation confidence, $/kg, EUDR "deforestation-free". Map click lands here.
2. **Edge case** — A plot with no spray: the PHI section shows "sin ventana activa" (not a false block).
3. **Error** — `/plots/does-not-exist` → 404 (no fabricated dossier).

### UAT Scenarios (BDD)
#### Scenario: A plot opens its whole story from one click
Given plot "Tizingal-Alto" has harvests, an active spray PHI, and a cost
When Don Ricardo clicks the plot on the Map
Then he lands on /plots/tizingal-alto
And he sees its harvests, PHI-until date, vegetation, cost, and EUDR status in one view

#### Scenario: Every plot-bearing row links to the plot dossier
Given the Plots, Satellite, and EUDR-origin lists are shown
Then each plot row/card links to /plots/<id>
And none has a pointer cursor without a destination

#### Scenario: An unknown plot 404s
Given no plot "ghost-plot" exists
When the URL /plots/ghost-plot is opened
Then the page returns 404 and renders no fabricated plot story

### Acceptance Criteria
- [ ] `/plots/[id]` aggregates harvests + PHI (`v_plot_phi_status`) + vegetation + cost + EUDR origin from live getters.
- [ ] Map polygon click navigates to `/plots/[id]` (the DEAD click is removed).
- [ ] Plot rows on Plots, Satellite, EUDR origin, Dashboard plot-health link to the dossier.
- [ ] Unknown id → 404.
- [ ] Ships a render test (dossier sections render) + a behavior test (Map click routes; unknown id 404s).

### Outcome KPIs
- **Who:** owner + agronomist · **Does what:** open a plot's whole story in one click ·
  **By how much:** tabs visited to assess a plot 6 → 1 · **Measured by:** dogfood + audit "DEAD clicks = 0" ·
  **Baseline:** no plot dossier; Map click dead.

### Technical Notes
- Mirror the live `/lots/[code]` dossier pattern (Server Component + `notFound()`). Live sources:
  `getPlots`, `v_plot_phi_status`, `getPlotVegetation`, plot cost getter, `getEudrSummary`.

---

## US-04: Open any worker's whole story (the /workers/[id] dossier)

`job_id: J2`

### Elevator Pitch
- **Before:** Picker rows on **Harvests** (top pickers), the **Workers** roster, and **QC** cup-to-cause
  name a person but click nowhere — their attendance, kg, and pay live in separate tabs.
- **After:** Clicking a worker opens **/workers/[id]** — attendance timeline, kg picked, por-obra pay,
  crew, and certifications in one view.
- **Decision enabled:** Don Ricardo settles a pay question from one screen instead of cross-checking tabs.

### Problem
A worker's contribution and pay are scattered. There's no worker dossier, so a pay question means
visiting Harvests, Workers, and payroll separately.

### Who
- Owner | answering "what is Lupita owed and did she show up?" | wants one place.

### Solution
Build `/workers/[id]` from the live people/weigh spine (attendance_event, weigh_event tally,
por-obra rate, crew, certifications); link every worker-bearing row to it.

### Domain Examples
1. **Happy path** — Lupita: dossier shows clock-ins this week, 142 kg, por-obra pay due, crew Norte.
2. **Edge case** — A worker with no picks today: kg shows 0, attendance shows the rest day.
3. **Error** — `/workers/unknown` → 404.

### UAT Scenarios (BDD)
#### Scenario: A worker opens their whole story from a picker row
Given Lupita has attendance, picked kg, and a por-obra rate this week
When Don Ricardo clicks Lupita in the Harvests top-pickers list
Then he lands on /workers/lupita
And he sees her attendance, kg, pay, crew, and certifications in one view

#### Scenario: Every worker-bearing row links to the worker dossier
Given the Workers roster and QC cup-to-cause are shown
Then each worker row/name links to /workers/<id>

#### Scenario: An unknown worker 404s
Given no worker "ghost" exists
When /workers/ghost is opened
Then the page returns 404

### Acceptance Criteria
- [ ] `/workers/[id]` aggregates attendance + kg tally + pay + crew + certs from live getters.
- [ ] Worker rows on Harvests, Workers, QC link to the dossier.
- [ ] Unknown id → 404.
- [ ] Ships a render test + a behavior test (a worker row routes to the dossier; data is live).

### Outcome KPIs
- **Who:** owner · **Does what:** resolves a pay/attendance question in one place · **By how much:**
  tabs visited 3 → 1 · **Measured by:** dogfood · **Baseline:** no worker dossier.

### Technical Notes
- Live sources: `attendance_event`, `weigh_event`/`v_weigh_today_by_picker`, por-obra rate
  (`v_active_por_obra`), `crew_memberships`, certifications. Mirror the lot-dossier pattern.

---

## US-05: Reach the lineage/ferment/cupping dossiers from nav and a ⌘K entity jump

`job_id: J2`

### Elevator Pitch
- **Before:** The deep `/lots/[code]`, `/ferment/[batch]`, and `/qc/cup/[lot]` dossiers exist but the
  sidebar links to none — Don Ricardo can only reach them by typing a URL or stumbling on an inline link.
- **After:** A ⌘K "open entity" jump and contextual links make any lot/batch/cup dossier reachable in two keystrokes.
- **Decision enabled:** Don Ricardo pulls up a lot's dossier to answer a buyer's question on the spot.

### Problem
The flagship traceability dossiers are orphans (the lot page itself notes "nav wiring is a later
slice"). Built value nobody can find is wasted.

### Who
- Owner | showing a buyer a lot's story | needs to reach the dossier fast.

### Solution
Add a ⌘K command palette that resolves a typed lot/batch/cup code to its dossier, plus a persistent
"open lot…" affordance; route to the existing dossiers (no dossier rebuild).

### Domain Examples
1. **Happy path** — Don Ricardo hits ⌘K, types "JC-712", lands on /lots/JC-712.
2. **Edge case** — Types a ferment batch id → /ferment/[batch]; a green lot → /qc/cup/[lot].
3. **Error** — Types "JC-999" (no such lot) → the palette shows "sin resultados" (and a direct nav 404s, not a fake page).

### UAT Scenarios (BDD)
#### Scenario: The entity jump opens an existing lot dossier
Given lot "JC-712" exists
When Don Ricardo opens the ⌘K palette and selects "JC-712"
Then he lands on /lots/JC-712 with its full lineage + EUDR + cost

#### Scenario: The palette resolves ferment and cup entities
Given a ferment batch and a green lot exist
When their codes are entered in the palette
Then they open /ferment/<batch> and /qc/cup/<lot> respectively

#### Scenario: An unknown code shows no result, never a fake dossier
Given no lot "JC-999" exists
When "JC-999" is entered
Then the palette shows no result and no fabricated dossier is rendered

### Acceptance Criteria
- [ ] A ⌘K palette routes lot/batch/cup codes to their existing dossiers.
- [ ] Unknown codes resolve to "no result"; direct nav to an unknown code 404s.
- [ ] Ships a render test (palette renders) + a behavior test (a known code routes; an unknown shows no result).

### Outcome KPIs
- **Who:** owner · **Does what:** opens any entity dossier in ≤2 keystrokes · **By how much:**
  dossier reachability from nav 0% → 100% · **Measured by:** audit (every dossier reachable without typing a URL) ·
  **Baseline:** dossiers are orphans.

### Technical Notes
- Dossiers already exist (`/lots/[code]`, `/ferment/[batch]`, `/qc/cup/[lot]`). This story is wiring/nav only.

---

## US-06: A spray PHI block shows on every plot surface, not just the planner

`job_id: J3`

### Elevator Pitch
- **Before:** The planner refuses a pick inside a PHI window (live, fail-closed), but the **Map**,
  **Satellite**, and the plot dossier don't visibly show *why* — so the block feels arbitrary in the field.
- **After:** The same `phi_clears_on` shows as a "PHI hasta <fecha>" badge on the Map, Satellite, Scouting,
  and the plot dossier, sourced from the one view that drives the gate.
- **Decision enabled:** Inés sees at a glance which plots are still in a residue window and routes the crew elsewhere.

### Problem
PHI is enforced at the planner but invisible elsewhere. A crew-lead can't tell from the Map which
plots are safe to pick today.

### Who
- Agronomist / crew-lead | deciding where to send the crew | needs PHI visible everywhere a plot appears.

### Solution
Surface `v_plot_phi_status.phi_clears_on` as a consistent badge on Map, Satellite, Scouting, and the
plot dossier — the same source the gate reads.

### Domain Examples
1. **Happy path** — Tizingal-Alto sprayed, PHI clears 2026-07-02: a "PHI hasta 2-jul" badge shows on
   Map + Satellite + plot dossier; the planner still refuses a pick before that date.
2. **Edge case** — A plot with no spray: no PHI badge (the view inner-joins spray; no over-block).
3. **Error** — Two sprays on one plot: the badge shows the later clear date (max), matching the gate.

### UAT Scenarios (BDD)
#### Scenario: PHI is visible on the Map and the plot dossier from one source
Given plot "Tizingal-Alto" was sprayed and its PHI clears on 2026-07-02
Then the Map and the plot dossier both show "PHI hasta 2-jul"
And the planner refuses a pick scheduled before 2026-07-02

#### Scenario: A plot with no spray shows no PHI block anywhere
Given plot "La Esperanza" has no spray
Then no PHI badge appears on any surface
And the planner allows scheduling a pick there

#### Scenario: The PHI date matches across surfaces and the gate
Given a plot has two sprays clearing 2026-06-30 and 2026-07-02
Then every surface shows 2026-07-02
And the planner's refusal boundary is 2026-07-02

### Acceptance Criteria
- [ ] Map, Satellite, Scouting, and `/plots/[id]` show the PHI-until badge from `v_plot_phi_status`.
- [ ] The displayed date equals the date the planner gate uses (single source).
- [ ] No PHI badge on plots without sprays.
- [ ] Ships a render test (badge renders the date) + a behavior test (badge date == gate boundary; no-spray plot shows none).

### Outcome KPIs
- **Who:** agronomist/crew-lead · **Does what:** sees PHI status on every plot surface · **By how much:**
  surfaces showing live PHI 1 → ≥4 · **Measured by:** audit · **Baseline:** PHI only at the planner.

### Technical Notes
- Live source: `v_plot_phi_status` (20260622106000); gate in 20260623110000. No new write path.

---

## US-07: A QC-held lot reads un-sellable everywhere it can be sold

`job_id: J3`

### Elevator Pitch
- **Before:** A lot on **QC-hold** can still look reservable on **Inventory** and shippable on **Dispatch** —
  the hold lives on the QC tab.
- **After:** A held lot shows an "en QC-hold · no vendible" banner on Inventory and Dispatch and its reserve
  control is blocked, sourced from the one hold state.
- **Decision enabled:** Don Ricardo doesn't promise a buyer a lot that's on hold.

### Problem
QC-hold is a cross-cutting safety state surfaced only on QC. A held lot must read as un-sellable
wherever it can be reserved or dispatched.

### Who
- Owner | reserving/shipping green lots | must not commit a held lot.

### Solution
Read `getQcStatus().held` on Inventory and Dispatch; show the hold banner and block the reserve
control for held lots (the DB oversell/hold guard remains the real enforcement).

### Domain Examples
1. **Happy path** — Lot JC-680 placed on hold in QC: Inventory shows "no vendible" and disables Reserve; Dispatch flags it.
2. **Edge case** — Hold released in QC: Inventory re-enables Reserve on next load.
3. **Error** — Attempt to reserve a held lot anyway → refused (DB hold guard), friendly message.

### UAT Scenarios (BDD)
#### Scenario: A held lot is un-sellable on Inventory
Given lot "JC-680" is on QC-hold
When Don Ricardo opens Inventory
Then JC-680 shows "en QC-hold · no vendible"
And its Reserve control is blocked

#### Scenario: A held lot is flagged on Dispatch
Given lot "JC-680" is on QC-hold
When the Dispatch board is shown
Then JC-680 is flagged as on hold

#### Scenario: Releasing the hold restores sellability
Given JC-680's QC-hold is released
When Inventory reloads
Then its Reserve control is available again

### Acceptance Criteria
- [ ] Inventory + Dispatch read `getQcStatus().held` and show the hold banner for held lots.
- [ ] The Reserve control is blocked for a held lot (UI) on top of the DB guard.
- [ ] Releasing the hold restores the control.
- [ ] Ships a render test (banner renders for a held lot) + a behavior test (held → blocked; released → available).

### Outcome KPIs
- **Who:** owner · **Does what:** never commits a held lot · **By how much:** surfaces enforcing the hold 1 → ≥3 ·
  **Measured by:** audit · **Baseline:** hold only on QC.

### Technical Notes
- Live: `qc_hold` / `place_qc_hold` / `getQcStatus` (20260622096000). DB guard remains SSOT enforcement.

---

## US-08: Deepen Satellite from read-only surveillance into a connected, drill-in tab

`job_id: J4`

### Elevator Pitch
- **Before:** The **Satellite** tab is the thinnest: vegetation tiles and PHI chips render but every
  one is cosmetic — nothing opens, nothing connects.
- **After:** Each plot's vegetation card drills into **/plots/[id]** (satellite section), and each PHI chip
  links to the spray that set it — Satellite becomes a connected diagnostic surface.
- **Decision enabled:** Inés clicks a low-confidence plot and decides whether to scout it on the ground.

### Problem
Satellite is read-only with zero connectivity — the clearest "thin tab" in the audit. It names plots
and PHI windows but lets you do nothing with them.

### Who
- Agronomist | triaging plot health from imagery | wants to act on what she sees.

### Solution
Make each vegetation card link to the plot dossier (satellite section) and each PHI chip link to the
originating spray record; add a "scout this plot" affordance that routes to Scouting pre-filled.

### Domain Examples
1. **Happy path** — A "honestly unknown" (low-confidence) plot card → /plots/tizingal-alto#satellite.
2. **Edge case** — A PHI chip "PHI hasta 2-jul" → the spray record that set it.
3. **Error** — A plot with no vegetation read: the card shows "sin lectura" and is not a dead link.

### UAT Scenarios (BDD)
#### Scenario: A vegetation card drills into the plot dossier
Given the Satellite tab shows a vegetation card for "Tizingal-Alto"
When Inés clicks it
Then she lands on /plots/tizingal-alto and sees its satellite section

#### Scenario: A PHI chip links to the spray that set it
Given a plot has an active PHI from a logged spray
When Inés clicks the "PHI hasta…" chip
Then she sees the spray record that set the window

#### Scenario: No card is a dead click
Given the Satellite tab is shown
Then every vegetation card and PHI chip has a real destination (no pointer-only cosmetic)

### Acceptance Criteria
- [ ] Each vegetation card links to `/plots/[id]`; each PHI chip links to its spray record.
- [ ] Satellite moves from "thin" to "deep" on the wire-up audit (0 cosmetic-only entity controls).
- [ ] Ships a render test (cards render with links) + a behavior test (card routes to the plot dossier; chip routes to the spray).

### Outcome KPIs
- **Who:** agronomist · **Does what:** acts on satellite findings via drill-in · **By how much:**
  Satellite cosmetic-only entity controls 6 → 0 · **Measured by:** the wire-up audit re-run ·
  **Baseline:** Satellite is read-only (audit depth: thin).

### Technical Notes
- Depends on US-03 (`/plots/[id]`). Live: `getPlotVegetation`, `v_plot_phi_status`, `getSprayHistory`.
