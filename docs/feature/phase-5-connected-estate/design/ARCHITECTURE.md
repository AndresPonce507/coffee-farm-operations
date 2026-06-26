# Phase 5 — "The Connected Estate" · ARCHITECTURE (the single DESIGN SSOT)

> The one document that reconciles the five facet designs into one coherent architecture for the
> DELIVER wave. It is authoritative where any facet disagrees. Read order for DELIVER: **this file
> first**, then the facet it owns. Grounded by reading the live repo at
> `/Users/andres/coffee-farm-operations-worktrees/phase1-deliver` (branch `main`). Every path / RPC /
> view / getter / migration cited is **real unless marked (NEW)**. North star: `../PRINCIPLE.md`.
>
> **Reconciles:**
> - `01-reactive-graph.md` — the reactive-propagation contract (J1 spine)
> - `02-dossiers.md` — the entity-dossier model (J2)
> - `03-smart-bar-wiring.md` — the per-element smart-bar wiring pattern (J4)
> - `04-cross-tab-triggers.md` — the guard-surface pattern (J3)
> - `05-build-plan.md` — the layered DELIVER build plan
>
> **Verified against live code (this session):** `force-dynamic` at `src/app/(app)/layout.tsx:7` ✓;
> existing `ActionState = {idle}|{success;message}|{error;message?;errors?}` at
> `src/lib/actions/plots.ts:9` ✓; weigh action hand-writes 4 `revalidatePath` calls
> (`weigh/actions.ts:85-88`) ✓; the 3 orphan dossiers (`/lots/[code]`, `/ferment/[batch]`,
> `/qc/cup/[lot]`) exist ✓; `command-palette.tsx`, `ui/dialog.tsx` exist ✓; `refresh_lot_cost` in
> `20260621094000_costing.sql` ✓; guard views in `20260622096000` / `20260622094000` /
> `20260622106000` / `20260623110000` ✓; the mock leak is exactly
> `sections/workers/{worker-form,crew-board}.tsx` ✓; **`src/lib/dossier/entity-href.ts` does NOT yet
> exist** (F-B creates it — no pre-existing conflict) ✓.

---

## 0. The architecture in one paragraph

Phase 5 adds **no new propagation infrastructure**. The reactive estate already exists in the
database: one **SECURITY-DEFINER command-RPC write door**, an append-only hash-chained `lot_event`
spine, `security_invoker` views that re-derive on every read (free), and two earned matviews
(`mv_lot_cost`, `mv_lot_cost_by_rule`) refreshed on the cost write path via `refresh_lot_cost()`.
The UI is `force-dynamic` (`src/app/(app)/layout.tsx:7`), so **every RSC render reads live and every
cross-tab ripple lands on navigation with zero re-entry** — no Realtime, no polling, no cron ($0 /
offline-safe). Phase 5's job is **connectivity and surfacing**, expressed through **four shared
contracts** that 100+ agents import without forking: (1) the **reactive-refresh SSOT**
(`reactiveRefresh`/`RIPPLE`) so no write leaves a downstream tab stale; (2) the **smart-bar
primitives** (`EditDialog`, `SmartForm`, `EntityLink`+`entityHref`) so every clickable resolves to
EDIT / CREATE / DRILL / NAVIGATE; (3) the **dossier shell** (`DossierShell`, `DossierSection`) so all
7 entity dossiers share chrome; (4) the **guard surface** (`GuardStatus`, `GuardBadge`/`GuardBanner`/
`GuardBlock`, `guardError`) so one DB gate is visible-and-honest on every tab it touches. Build order
is **walking-skeleton → freeze the four contracts → fan out 100-wide on file-disjoint leaf work**.

---

## 1. The five North-Star rules → the architectural mechanism that satisfies each

| PRINCIPLE rule | Mechanism in this architecture | Owning facet |
|---|---|---|
| **1. No dead UI** | Every clickable resolves to one of 4 smart-bar verbs; the `no-dead-ui` static guard test holds DEAD=0 | §4 (03) |
| **2. Every clickable is CREATE/EDIT (or drills to editable source)** | The smart-bar decision tree: raw→`EditDialog`+`SmartForm`; computed→`EntityLink anchor`; entity→`EntityLink`; cosmetic→wire or delete | §4 (03) |
| **3. Everything connects, every entity → dossier** | The reactive-refresh contract (writes ripple) + the 7-dossier model + `entityHref` SSOT | §2 (01) + §3 (02) |
| **4. Every tab materially deeper** | D2 row-wiring + D5 deepen, fanned out per (tab × verb) in L3/L4 | §6 (05) |
| **5. World-class craft inside each slice** | Reuse finalized portal-glass `Dialog`, `DossierShell` chrome, `GuardBadge` AA-on-aurora; test-first per PR | all |

---

## 2. The reactive-propagation contract (the J1 spine — facet 01 is authoritative)

**This is the load-bearing invariant the whole phase rests on. It is reused, not built.**

### 2.1 The mechanism (three layers, all existing)

1. **Truth layer** — append-only, hash-chained: `weigh_event`, `harvests`, `cost_entry`,
   `spray_application`, `qc_hold`, `lots`. Written only through SECURITY-DEFINER command RPCs
   (`record_weigh_in`, `record_cherry_intake`, `bookCostEntry`→`cost_entry`, `log_spray`,
   `place_qc_hold`…). One field, one home.
2. **Reactive-on-READ** — `security_invoker` views re-derive on every getter read under the caller's
   RLS, **no refresh ever**: `v_weigh_today_by_picker`, `v_weigh_today_by_plot`, `v_weigh_by_lot`,
   `season_summary_view`, `daily_cherries_view`, `variety_shares_view`, `v_plot_phi_status`,
   `v_qc_status`, `v_reposo_status`. **This is the majority case.**
3. **Reactive-on-REFRESH** — the two cost matviews (`mv_lot_cost`, `mv_lot_cost_by_rule`,
   `20260621094000_costing.sql`) are the **only** relations that need an explicit
   `refresh_lot_cost()` (SECURITY DEFINER, plain `REFRESH` not `CONCURRENTLY`) on the write path.

The UI freshness layer is `force-dynamic` (`layout.tsx:7`) + `revalidatePath` in the Server Action
(busts the client router cache so a post-write navigation skips the stale RSC payload).

### 2.2 The seven propagation invariants (every DELIVER slice obeys)

1. **One write door.** Every state change goes through a SECURITY-DEFINER command RPC. No UI insert
   on a truth table except the documented append-only grant (`cost_entry` INSERT-only).
2. **Views are free; matviews cost a refresh.** Read a plain view → write needs only `revalidatePath`.
   Read `mv_lot_cost*` → the write **must** call `refresh_lot_cost()`.
3. **Refresh both matviews together, in order** (`mv_lot_cost` then `mv_lot_cost_by_rule`).
4. **No deprecated reads.** No getter selects from a `*__deprecated` relation (would silently
   disagree with the harvests truth). Static-guard enforced.
5. **Revalidate every affected route**, not just the originating tab — via `reactiveRefresh` (§5).
6. **Exactly-once survives offline.** Advisory-lock + idempotency-key dedup means the eventual server
   ripple equals the optimistic delta; no double-count on replay.
7. **$0 / offline-safe.** No Realtime, no polling, no cron. Cross-tab propagation = navigation-time
   RSC re-render under `force-dynamic`; same-screen liveness = optimistic local state.

### 2.3 Resolved open questions (from facet-01 §6 — these are now DECISIONS for DELIVER)

- **OQ1 — COGS excluded from the weigh ripple: CONFIRMED.** `record_weigh_in` grows a *cherry* lot;
  `mv_lot_cost`'s denominator is **green**-kg. A cherry weigh-in moves no green-kg → the slice-01
  proof panel names **Dashboard + lot dossier only**, and `record_weigh_in` **must NOT** call
  `refresh_lot_cost()`. Wiring COGS into the weigh ripple is a wasted REFRESH on the hottest field
  path — **do not do it.**
- **OQ2 — Offline lot link: CONFIRMED.** A `queued` capture's lot code is unknown until drain; the
  proof panel renders a "Tu lote · se confirma al sincronizar" + `/lots` index link, not a block.
- **OQ3 — `reactiveRefresh` helper: CONFIRMED, and unified with facet-03.** See §5 — the helper lives
  at `src/lib/revalidate.ts`, owns the per-event route set, called by every command action.
- **OQ4 — No Realtime: CONFIRMED.** Declined explicitly for Phase 5.

---

## 3. The dossier model (J2 — facet 02 is authoritative)

### 3.1 The seven dossiers

| Dossier | Route | Status | Anchor getter (existence gate) |
|---|---|---|---|
| Lot | `/lots/[code]` | EXISTS — wire-in only | (exists) |
| Batch | `/ferment/[batch]` | EXISTS — wire-in only | (exists) |
| Cup | `/qc/cup/[lot]` | EXISTS — wire-in only | (exists) |
| **Plot** | `/plots/[id]` | NEW (US-03) | `getPlotById` (exists) |
| **Worker** | `/workers/[id]` | NEW (US-04) | `getWorkers` find / dedicated |
| **Crew** | `/crew/[id]` | NEW | `getCrewById` (NEW) |
| **Dispatch-run** | `/dispatch/[id]` | NEW (R4) | `getDispatchRunById` (NEW) |
| **Pay-period** | `/pay-period/[id]` | NEW (R4) | `getPayPeriodById` (NEW) |

### 3.2 The page contract (P1–P7, every dossier obeys)

`async` Server Component; `params: Promise<{…}>` (Next 15); **resolve the anchor entity with ONE
getter and `notFound()` BEFORE any section fetch** (no fabricated dossier); `Promise.all` the section
reads (`cache()`'d getters, no waterfall); render through `<DossierShell>` + N `<…Section>`
presentational Server Components; **NO `src/lib/data/*` import** (mock-leak guard); every entity name
inside a section is `<EntityLink href={entityHref…}>`; `loading.tsx` skeleton + per-section
empty/error.

### 3.3 The shell + section + cross-link contracts

- `<DossierShell kind title eyebrow subtitle backHref backLabel actions children>` (NEW,
  `src/components/dossier/dossier-shell.tsx`) — Server Component, chrome only, no fetch.
- `<DossierSection id title count empty emptyLabel children>` (NEW,
  `src/components/dossier/dossier-section.tsx`) — `#anchor`-deep-linkable; reuses `ui/empty-state.tsx`.
- **Each dossier surfaces ≥4 cross-entity links** (`outcome-kpis.md` KPI 5). The link map and the new
  thin getters (`getHarvestsForPlot`, `getPlotOriginStatus`, `getCrewById`, `getDispatchRunById`,
  `getPayPeriodById`, `getWorkerWeighSummary`) are in facet-02 §5/§7. All are read-only filters over
  **existing views** — **no migrations, no schema lane.**

### 3.4 Orphan reachability (two complementary mechanisms, both have live primitives)

1. **⌘K entity jump** — extend `command-palette.tsx` `results` to emit batch + cup destinations
   (already resolves digit-runs → `/lots/JC-NNN`). No new component.
2. **Inline `EntityLink` row-links** — the bulk D2 work in L3.

---

## 4. The smart-bar wiring pattern (J4 — facet 03 is authoritative)

### 4.1 The four verbs (one per clickable element, decided from the audit row)

| Verb | When | Mechanism |
|---|---|---|
| **EDIT** | raw owner-editable field/entity | `EditDialog` → `SmartForm` → Server Action → command-RPC |
| **CREATE** | "add" affordance | same, empty form, `idempotent=true` if it appends a `lot_event` |
| **DRILL** | computed/derived value (sum, COGS, cup score, KPI tile, matview number) | `EntityLink` with `#anchor` to the editable source records, OR `<Link>` to a filtered list |
| **NAVIGATE** | names a connected entity (lot/plot/worker/crew/batch/dispatch/pay-period) | `EntityLink kind=… id=…` → its dossier |

Cosmetic is **not a fifth verb** — it resolves INTO one of the four or is deleted. The decision tree
(facet-03 §2) is applied mechanically per `wire-up-audit.md` row. Tie-break: a row that is *both* an
entity reference *and* has an inline edit → the **body is NAVIGATE**, the **pencil is EDIT**
(stop-propagation on the pencil).

### 4.2 The primitives (NEW contract files, F-B owns them)

- `src/components/ui/edit-dialog.tsx` — `EditDialog` (render-prop trigger over the existing portal
  glass `Dialog`).
- `src/components/ui/smart-form.tsx` — `SmartForm` + `SmartActionState` + `SMART_IDLE` + `SmartReducer`.
- `src/components/ui/form-field.tsx` — the `FIELD`/`LABEL` glass classnames, one home.
- `src/lib/dossier/entity-href.ts` — **the `entityHref` SSOT** (see §7 reconciliation).
- `src/components/ui/entity-link.tsx` — `EntityLink`, which **imports** `entityHref` (does not
  redefine it).

**`SmartActionState` ↔ existing `ActionState` compatibility (verified):** the live shape is
`{status:"idle"} | {status:"success";message} | {status:"error";message?;errors?}`
(`src/lib/actions/plots.ts:9`). `SmartActionState` is a **strict superset** — it only adds an
optional `href?` to the success variant. Therefore **any existing route action passes straight into
`SmartForm` with no adapter.** REVIEWER-1 verifies this still holds.

### 4.3 The write-door binding (every EDIT/CREATE)

`element → trigger → EditDialog → SmartForm → Server Action → command (src/lib/db/commands/*) →
SECURITY-DEFINER RPC → reactiveRefresh(kind)`. Genesis/event writes (anything appending a
`lot_event`) MUST route through an existing command (owns the offline envelope + idempotency +
`friendlyRpcError`); plain dimension edits (a `plots` row) may use the direct-table action idiom
already in `src/lib/actions/plots.ts`. **Existing forms are NOT migrated (flag-don't-fix); new slices
build on the primitives.**

---

## 5. The reactive-refresh SSOT — where facets 01 and 03 unify (RESOLVED)

**Conflict:** facet-01 §6 OQ3 proposes `src/lib/reactive/revalidateRipple.ts`; facet-03 §4.1 and
facet-05 propose `src/lib/revalidate.ts`. **Decision: ONE file — `src/lib/revalidate.ts`** (facet-03/05
location wins; facet-01's `revalidateRipple` is the same idea under a different name). It exports:

```ts
// src/lib/revalidate.ts  (NEW — F-A owns; slice-01 seeds the "weigh-in" row)
export const RIPPLE: Record<string, readonly string[]> = {
  "weigh-in":    ["/weigh", "/", "/harvests", "/crew"],        // tally + Dashboard + harvests + crew
  "cherry-intake":["/harvests", "/", "/lots"],                 // mints lot + origin harvests row
  "cost-entry":  ["/costing", "/inventory", "/lots"],          // mv_lot_cost consumers
  "qc-hold":     ["/qc", "/inventory", "/dispatch", "/lots"],  // un-sellable everywhere
  "spray":       ["/scouting", "/plan", "/map", "/satellite"], // PHI surfaced
  "reposo":      ["/drying", "/processing", "/lots"],          // moisture/rest gate
  "plot":        ["/plots", "/", "/map"],
  "disbursement":["/payroll", "/costing"],                     // payroll IS labor COGS
  // …one row per write kind, values = the audit's "Connects to" graph
};
export function reactiveRefresh(kind: keyof typeof RIPPLE) { /* revalidatePath each */ }
```

**Reconciliation note on the `weigh-in` route set:** facet-03 §4.1 listed `"/costing","/inventory"`
in the weigh-in set; facet-01 OQ1 proved a cherry weigh-in moves **no** COGS. **DECISION: the
`weigh-in` row is `["/weigh","/","/harvests","/crew"]`** (the live `weigh/actions.ts:85-88` set) — it
**excludes `/costing` and `/inventory`** to honor invariant #2 (don't revalidate a tab whose numbers
the write cannot move). `/costing` belongs to the `cost-entry` kind. This is the one cross-facet route
discrepancy; facet-01's correctness argument wins.

**Load-bearing guard test** (`ripple-routes-exist.test.ts`, F-A): every route in every `RIPPLE` row
resolves to a real `src/app/(app)/**/page.tsx`, so a renamed tab can't silently drop a downstream
consumer (global Rule 5 — a dead guard is an incident).

Every Server Action calls `reactiveRefresh("<kind>")` instead of ad-hoc `revalidatePath` lists. The
live `weigh/actions.ts` four-call block is **replaced** by `reactiveRefresh("weigh-in")` in slice-01.

---

## 6. The guard-surface pattern (J3 — facet 04 is authoritative)

**Three existing DB guards, each = a derived status view + a fail-closed enforcement. Reuse the
teeth; Phase 5 only makes them visible-and-honest on every tab.**

| Guard | SSOT view | Enforcement (do NOT touch) | Entity key |
|---|---|---|---|
| **PHI/REI** | `v_plot_phi_status` | `schedule_pasada`/`replan_pasada` gate (`20260623110000`), `check_violation` | `plot_id` |
| **QC-hold** | `v_qc_status` | `_prevent_held_lot_commit` on `lot_reservations`+`lot_shipments` (`20260622096000`) | `green_lot_code` |
| **Reposo/moisture** | `v_reposo_status` | `advance_processing_stage` precond + `lots_enforce_reposo_gate` (`20260622094000`) | `lot_code` |

### 6.1 The guard contract (NEW, facet-04 §2–3)

- `src/lib/guards/types.ts` — `GuardKind`, `GuardEntity`, `GuardStatus` (`blocked` read **straight off
  the view boolean**, never recomputed), `GuardAction`.
- `src/lib/guards/status.ts` — `getPhiGuards`/`getQcGuards`/`getReposoGuards` (thin `cache()` mappers
  over the **existing** getters `getPlotPhiStatus`/`getQcStatus`/`getReposoStatuses`) + `xGuardForY`
  lookups. Pure `mapXToGuard` functions are the test-first unit surface.
- `src/components/guards/` — `<GuardBadge>` (inline chip, wrapped in a dossier `<Link>` so a guard is
  itself a drill-in), `<GuardBanner>` (top-of-dossier alert), `<GuardBlock>` (courtesy-disable an
  action control when a matching guard is blocked).
- `src/lib/guards/guardError.ts` — ONE mapper recognizing the `pasada gate:` / `qc-hold:` /
  `reposo gate:` raised-message prefixes → the same es-PA sentence the matching badge shows.

### 6.2 The guard invariants

1. **One source per guard** — badge/banner/block reads the view boolean; never recomputes from raw
   evidence (= propagation invariant #1).
2. **The DB gate is the teeth; `<GuardBlock>` is courtesy.** Never ship a `<GuardBlock>` whose action
   lacks a DB gate; never weaken a gate to make UI pass. (Reviewer-pass static check.)
3. **Reactive-on-read, $0** — a new spray/hold/moisture row flips the badge on the next RSC render
   under `force-dynamic`; the write action's `reactiveRefresh` covers every tab the guard appears on.
4. **One copy, two places** — the badge `reason` and `guardError()` sentence come from the same
   family (string-contract test).
5. **Fail-closed reach, never over-block** — `getXGuards()` filters to `blocked` only; an un-sprayed
   plot shows no badge.
6. **Every guard chip is a drill-in** (PRINCIPLE Rule 3).

### 6.3 Resolved guard open questions (facet-04 §9 — now DECISIONS)

- Migrate the 3 bespoke widgets (`PhiChips`/`QcHoldBanner`/`ReposoGateChip`) to thin re-exports over
  the new family — keeps their tests, removes drift.
- The 3 intentional courtesy STUBs (Drying "Mill", Inventory "Sold out"/"no vendible", Processing
  advance) become **live `<GuardBlock>`s** reading the view (satisfies DISCUSS OQ-5 without changing
  the teeth).
- Moisture flag reads `v_reposo_status.moisture_stable` (the gate's own band — one source).
- Lock the `pasada gate:`/`qc-hold:`/`reposo gate:` message prefixes as a tested contract.
- Reposo guard reuses `getReposoStatuses` in `src/lib/db/drying.ts` — no new getter.

---

## 7. Cross-facet conflict resolutions (the reconciliation ledger)

These are the points where the five facets disagreed or overlapped. **Each is resolved here; DELIVER
follows THIS file.**

| # | Conflict | Resolution (authoritative) |
|---|---|---|
| **C1** | **`entityHref` location** — facet-02 §5 puts it in `src/lib/dossier/entity-href.ts`; facet-03 §1.3 inlines it in `src/components/ui/entity-link.tsx`. | **ONE SSOT: `src/lib/dossier/entity-href.ts`** (pure map, component-free). `entity-link.tsx` **imports** it. Rationale: the Map imperative `router.push` (`FarmMap.client.tsx`) and the ⌘K palette need `entityHref` without pulling a React component. Verified the file does **not** yet exist → no migration of existing imports. F-B owns both files; `entity-href.ts` is the SSOT. **The single most important coherence fix.** |
| **C2** | **`reactiveRefresh` file name** — facet-01 `src/lib/reactive/revalidateRipple.ts` vs facet-03/05 `src/lib/revalidate.ts`. | **`src/lib/revalidate.ts`**, exporting `RIPPLE` + `reactiveRefresh`. F-A owns; slice-01 seeds the full key set with the `weigh-in` row exercised. |
| **C3** | **`weigh-in` ripple route set** — facet-03 included `/costing`+`/inventory`; facet-01 OQ1 excludes COGS. | **`weigh-in` = `["/weigh","/","/harvests","/crew"]`** (no `/costing`/`/inventory`). Facet-01's correctness argument (cherry weigh moves no green-kg) wins. `/costing` lives in the `cost-entry` kind. |
| **C4** | **`SmartActionState` vs `ActionState`** | Strict superset (adds `href?`) — existing route actions pass straight into `SmartForm`. No adapter; no migration of existing forms (flag-don't-fix). REVIEWER-1 verifies. |
| **C5** | **`people.ts` multi-author** — L2-worker + L2-crew + L3-workers-mock all need getters in `src/lib/db/people.ts`. | **ONE author for `people.ts`** (assign to L2-worker): hosts worker getters + `getCrewById` + `getCrews()`. L2-crew and L3-workers-mock **import** them. Same single-author rule for any shared getter file. |
| **C6** | **`revalidate.ts` ownership across L0/F-A** | slice-01 (L0) **creates** the file with the full `RIPPLE` key set; F-A only **adds the guard test + verification**. They never both write the map. |
| **C7** | **Dossier scope** (feature-delta OQ2) | All 7 dossiers in Phase 5: plot/worker/crew (R2), dispatch-run/pay-period (R4 thin), lot/ferment/cup (wire-in only). |
| **C8** | **Dispatch/pay-period param types** — `v_dispatch_card.id` numeric, route param string. | `getDispatchRunById` coerces; confirm `getPayPeriods()` exposes the same id used in the `/pay-period/[id]` link. Resolve before L2-dispatch/payperiod start. |

---

## 8. The guard-surface pattern vs the smart-bar pattern vs the reactive contract — how they compose

A single clickable can carry all three concerns. The composition order is fixed so the fleet never
nests them wrong:

```
<EntityLink kind id>                         ← NAVIGATE (the entity → dossier)        [facet 03]
  └ row body (existing card markup)
     ├ <GuardBadge status={guardForThis} />  ← the guard surface, reactive-on-read    [facet 04]
     └ <EditDialog trigger=pencil>           ← EDIT (stop-propagation so the row link  [facet 03]
          <SmartForm action={cmd}>              doesn't fire)
             → command-RPC → reactiveRefresh ← the write ripples to every tab          [facet 01]
                              + <GuardBlock>  ← courtesy-disabled if a gate blocks      [facet 04]
```

- **NAVIGATE/DRILL** never writes — pure `<Link>`, reactive-on-read covers freshness.
- **EDIT/CREATE** always ends in `reactiveRefresh(kind)` (the §5 SSOT).
- **A `<GuardBlock>`** wrapping an action is courtesy only; the matching DB gate is the real teeth and
  must already exist (§6 invariant 2).
- **A `<GuardBadge>`** is reactive-on-read; the write that sets it (`log_spray`, `place_qc_hold`,
  moisture reading) must `reactiveRefresh` every tab the badge appears on (§5 rows `spray`/`qc-hold`/
  `reposo`).

---

## 9. The layered DELIVER build plan (facet 05 is authoritative; reconciled here)

```
  L0  WALKING SKELETON   slice-01 weigh-ripple-proof            ──► GATE-0   (1 agent, ships ALONE)
  L1  SHARED FOUNDATION  4 contract lanes, ONE author each, ║   ──► REVIEWER-1 ──► GATE-1
        F-A  reactive-refresh SSOT     (src/lib/revalidate.ts)
        F-B  smart-bar primitives      (edit-dialog, smart-form, form-field, entity-href, entity-link)
        F-C  dossier shell             (dossier-shell, dossier-section)
        F-D  guard contract            (guards/types, guards/status, guards/*, guardError)   ← NEW lane
        S-LANE  schema author          (idle — Phase 5 is schema-free; serialization guarantee only)
  L2  ENTITY DOSSIERS    7 routes, file-disjoint, 7 agents ║    ──► REVIEWER-2 ──► GATE-2
  L3  THE BIG FAN-OUT    ~95 leaf items (88 cosmetic+6 mock+1 dead+depth), 100-WIDE ║ ──► rolling REVIEWER-3 ──► GATE-3
  L4  CROSS-TAB GUARDS   PHI everywhere · QC un-sellable · Satellite deepen ║ ──► REVIEWER-4 ──► FINAL audit ──► main
```

**Reconciliation with facet 05:** facet-05 folded the guard contract into "F-D-ish" work landing in
L4. **DECISION: promote the guard *contract* (`guards/types.ts`, `guards/status.ts`, the
`<GuardBadge>`/`<GuardBanner>`/`<GuardBlock>` family, `guardError.ts`) to an L1 lane (F-D),** sibling
to F-A/F-B/F-C. Rationale: it is exactly a shared-contract surface that L4's per-tab guard agents (and
the L2 dossiers, which render `<GuardBanner>` at top) all import — same "don't fork the contract"
logic as the other three. The *application* of guards to specific tabs/dossiers stays in L2/L4
(file-disjoint, wide). This makes L1 four lanes instead of three and removes the only place facet-04's
shared components would otherwise have been authored mid-fan-out.

**The two true serialization points** (everything else fans wide):
1. **L0 → L1** — the skeleton proves the reactive mechanism is real before 100 wirings invest in it.
2. **L1 → L2/L3** — the four contracts must be merged + frozen before the leaf fleet imports them.

**S-LANE expected EMPTY.** Phase 5 reads existing views/getters; new getters are read-only
`src/lib/db/*` additions (not schema), fanned out in L2 by the dossier-owning agent. If any agent
discovers it needs a migration, it routes through the single schema author with a timestamp strictly
greater than the applied max — it does **not** ship one in its own branch.

---

## 10. THE SPLIT — what one author builds first vs what fans out 100-wide

### 10.1 What ONE author builds first (serialized, the critical narrow neck)

| Lane | One author owns (file-disjoint) | Why it must be first / single-author |
|---|---|---|
| **L0 slice-01** | `src/lib/revalidate.ts` (seeds full `RIPPLE`), `sections/weigh/ripple-proof.tsx` (NEW), `sections/weigh/weigh-capture.tsx` (thread `res.lotCode`), `page.tsx:18` (delete stale comment), the L0 db-tests | proves the reactive spine end-to-end; **nothing else starts until GATE-0 green** |
| **L1 F-A** | `src/lib/revalidate.ts` guard test + `ripple-routes-exist.test.ts` | the `RIPPLE` map is THE cross-tab SSOT; one author or 100 divergent maps |
| **L1 F-B** | `src/lib/dossier/entity-href.ts` (**the SSOT**), `ui/entity-link.tsx`, `ui/edit-dialog.tsx`, `ui/smart-form.tsx`, `ui/form-field.tsx` + tests; also seeds `no-dead-ui.test.ts` + `no-mock-reads.test.ts` | every L2/L3 link/form imports these; forking = drift |
| **L1 F-C** | `src/components/dossier/dossier-shell.tsx`, `dossier-section.tsx` + tests | all 7 dossiers share this chrome |
| **L1 F-D** | `src/lib/guards/{types,status,guardError}.ts`, `src/components/guards/{guard-badge,guard-banner,guard-block}.tsx` + tests | every L4 guard agent + L2 dossier banner imports these |
| **S-LANE** | `supabase/migrations/*` (expected to ship zero) | one-schema-author serialization guarantee |
| **`src/lib/db/people.ts`** | ONE author (L2-worker) | C5 — multi-consumer getter file |

**Gate between the neck and the fan-out:** REVIEWER-1 verifies `entityHref` is a single SSOT both
facets import; `SmartActionState`↔`ActionState` compat; `RIPPLE` keys match the L3 action kinds; no
contract file forks `src/lib/**` or `globals.css`. **GATE-1 = build green + test green + REVIEWER-1
sign-off → L2/L3 open.**

### 10.2 What fans out 100-wide (file-disjoint leaf work, after GATE-1)

| Layer | Width | Unit of work | File-disjointness guarantee |
|---|---|---|---|
| **L2** | 7 | one dossier route folder + its section set + its NEW getter(s) | disjoint route dirs; `people.ts` single-authored (C5) |
| **L3** | **~100** | one (tab × verb cluster): wrap a row in `EntityLink`, swap a mock import for a live getter, add the Map `router.push`, add an `EditDialog`+`SmartForm` to an editable field | each agent edits only `src/components/sections/<tab>/*` + that tab's `page.tsx` — **disjoint directories, no two agents touch one file**; all read-only import the frozen contract |
| **L4** | ~6 | per-surface guard application + thin-tab deepen | disjoint surfaces; L4-satellite waits on L2-plot (the one cross-layer story dep, US-08→US-03) |

**L3 decomposition (the 100-wide core)** — one agent per row, the audit's per-tab tables are the work
tickets. The big tabs split further into multiple agents per tab to hit 100-wide:

- Dashboard (PlotHealth/Pipeline/Activity rows → NAVIGATE), Plots (cards → plot), **Map (the 1 DEAD
  polygon → `router.push(entityHref.plot)`)**, Harvests (top-pickers → worker), Plan (readiness →
  plot), Dispatch (cards → dispatch/crew), Processing/Ferment (DRILL → lot/batch), Drying (cards →
  lot/plot, keep "Mill" STUB as `<GuardBlock>`), Inventory (rows → lot, keep "Sold out" STUB as
  `<GuardBlock>`), **QC (23 cup-to-cause refs → plot/worker — splits into multiple agents)**, Scouting
  (threshold → `/tasks`), Costing (KPI tiles → DRILL `#cost-entries`), **EUDR (11 origin-plot rows →
  plot)**, **Workers (the 6 MOCK `CREWS` → live `getCrews()` + crew cards → `EntityLink kind="crew"`,
  US-02)**.

### 10.3 The standing guards wired into `npm run test` (CI-free repo — local gate replaces CI)

| Guard | Asserts (KPI) | Authored in |
|---|---|---|
| `no-dead-ui` static | DEAD count = 0 (KPI 3) | F-B |
| `no-mock-reads` grep | `from '@/lib/data/'` over non-test `src/` = 0 (KPI 2); flips green when US-02 lands | F-B |
| `ripple-routes-exist` | every `RIPPLE` route is a real `page.tsx` | F-A |
| `no-deprecated-read` | no getter reads `*__deprecated` | L0 |
| `weigh-ripples-to-two` / `season-derives-from-harvests` / `exactly-once-replay` (PGlite) | the reactive spine | L0 |
| per-dossier `notFound()` | unknown id → 404 | L2 |
| `guard-*` (mappers, prefix-stable, error-agrees-with-badge, render) | the guard surface (facet-04 §6) | F-D / L4 |

> **Guardrail discipline (global Rule 5):** a guard that goes dead (mock-grep matching nothing because
> a path moved) is itself an incident — every REVIEWER pass verifies each guard still *exercises* its
> target, not just that it is green.

### 10.4 The reviewer-pass checkpoints (every fan-out closes with one; two clean rounds before main)

| Checkpoint | After | Checks | Gate |
|---|---|---|---|
| REVIEWER-1 | L1 (4 contracts) | `entityHref` single SSOT (C1); `SmartActionState`↔`ActionState` (C4); `RIPPLE` keys↔L3 actions; guard family coheres; no contract fork | GATE-1 |
| REVIEWER-2 | L2 (7 dossiers) | every dossier 404s on unknown id; ≥4 cross-links; shell-coherent; 0 mock import | GATE-2 |
| REVIEWER-3 | each L3 tab-cluster (rolling) | tab's audit rows all WIRED; 0 dead cursors; 3 STUBs preserved (as `<GuardBlock>`) | GATE-3 |
| REVIEWER-4 | L4 (guards + depth) | PHI date == gate boundary on every surface; held lot blockable everywhere sellable; Satellite 0 cosmetic | GATE-4 |
| **FINAL** | whole phase | full wire-up-audit re-run = **100% wired / 0 mock / 0 dead / 17 deep / every dossier reachable / ≥4 links/dossier**; **two consecutive clean rounds** | merge to `main` |

Each gate is local: `npm run build` green **and** `npm run test` (ui + db projects) green, plus the
reviewer sign-off. Nothing merges to `main` over a red gate.

### 10.5 The critical path (the longest dependency chain — compress by prioritizing it)

```
L0 slice-01 ─► GATE-0 ─► F-B (entityHref+EntityLink) ─► L2-plot (/plots/[id]) ─► L4-satellite (US-08)
                      └─► F-C (shell) ─────────────────┘                       └─► L3 plot-row links
                                                                               └─► REVIEWER-2 ─► GATE-2
```

The longest chain is skeleton → smart-bar/shell foundation → plot dossier → Satellite drill-in
(US-08 depends on US-03). **To compress: prioritize F-B + F-C + L2-plot** — they unblock the widest
downstream fan-out (every plot-row NAVIGATE in L3 + US-08). F-A and F-D and the non-plot L2 dossiers
and non-plot L3 clusters all run fully parallel to this path.

---

## 11. Parallel-width summary (how the fleet is sized)

| Layer | Agents | Notes |
|---|---|---|
| L0 | 1 | serialized — the skeleton gate (GATE-0) |
| L1 | **4** authoring + 1 reviewer (+ S-LANE idle) | F-A/F-B/F-C/F-D, one author each, file-disjoint; reconcile `entityHref` (C1) |
| L2 | 7 authoring + rolling reviewers | one per dossier; `people.ts` single-authored (C5) |
| L3 | **~100** authoring + rolling reviewers | one per (tab × section/verb); QC/Drying/EUDR split further |
| L4 | ~6 authoring + 1 reviewer | guards + thin-tab deepen; L4-satellite waits on L2-plot |

Peak concurrency is **L3 (~100-wide)** — exactly where the work is leaf-shaped and file-disjoint, so
maximal parallelism is *safe*. The narrow points (L0=1, L1=4) are narrow **by necessity** (contract
serialization), satisfying CLAUDE.md Rule #1 (maximize parallelism within the safety rails:
file-disjoint writers, one schema author, one author per contract file, a reviewer pass per fan-out,
a phased gate before `main`).

---

## 12. Acceptance — Phase 5 is done when

1. The walking skeleton (slice-01) lands: a weigh-in's proof panel names Dashboard + the lot dossier,
   and the linked Dashboard figure agrees with zero re-entry.
2. The four L1 contracts exist with tests written first; `entityHref` is a single SSOT; existing
   forms/widgets untouched (flag-don't-fix).
3. All 7 dossiers exist, 404 on unknown id, carry ≥4 cross-entity links, render through the shell,
   import zero mock data.
4. Every non-WIRED, non-intentional-STUB row in `wire-up-audit.md` has an assigned verb and a concrete
   binding citing a real RPC/table/route; the 3 STUBs are live `<GuardBlock>`s.
5. The three guards are visible on every tab their entity appears, reading the one source view; the DB
   teeth are untouched; the badge reason and `guardError` sentence agree.
6. The standing guards hold: DEAD = 0, mock reads = 0, every `RIPPLE` route real, no deprecated read.
7. The FINAL wire-up-audit re-run returns **two consecutive clean rounds** (0 CRIT / 0 HIGH):
   100% wired, 0 mock, 0 dead, 17/17 deep, every dossier reachable, ≥4 links/dossier — then merge to
   `main`.
