# Phase 5 · DESIGN — Facet 05: THE DELIVER BUILD PLAN (100+ agent parallel fleet)

> The sequencing facet. Maps the **8 slices + ~88 COSMETIC + 6 MOCK + 1 DEAD** wire-up-audit items
> + the **17-tab depth pass** into a maximally-parallel, **file-disjoint** work breakdown for a
> 100+-agent DELIVER fleet. Defines the dependency **layers**, the **shared-foundation PRs** (one
> author each, built FIRST), the huge fan-out (100-wide, file-disjoint), the **one-schema-author
> lane**, and the **reviewer-pass checkpoints**. Walking skeleton (slice-01) ships first. Goal:
> land Phase 5 on `main` as fast as a large parallel fleet allows, rails intact.
>
> Grounded by reading the live repo at
> `/Users/andres/coffee-farm-operations-worktrees/phase1-deliver` (branch `main`) and the three
> sibling DESIGN facets: `01-reactive-graph.md`, `02-dossiers.md`, `03-smart-bar-wiring.md`. Every
> path/RPC/view/getter cited is real unless marked **(NEW)**.

---

## 0. TL;DR — the shape of the build

```
  L0  WALKING SKELETON   slice-01 weigh-ripple-proof        ──► ships to main, GATE-0
        (1 agent, validates the reactive spine end-to-end; nothing else starts until green)

  L1  SHARED FOUNDATION  3 contract PRs, ONE author each, FILE-DISJOINT, run in parallel ──► GATE-1
        F-A reactive-refresh SSOT (src/lib/revalidate.ts + guard)
        F-B smart-bar primitives (edit-dialog, smart-form, form-field, entity-link/entityHref)
        F-C dossier shell (dossier-shell, dossier-section)
        + S-LANE (schema author) idle unless a guard migration is needed — serialized, one author

  L2  ENTITY DOSSIERS    7 dossier routes, FILE-DISJOINT, 7 agents in parallel ──► REVIEWER-2 ──► GATE-2
        plot · worker · crew · dispatch-run · pay-period (NEW)  +  lot · ferment · cup (wire-in only)

  L3  THE BIG FAN-OUT    ~88 cosmetic + 6 mock + 1 dead + per-tab depth, 100-WIDE, file-disjoint
        one agent per (tab × verb) cluster; every agent imports the L1 contract, links L2 dossiers
        ──► rolling REVIEWER-3 (per-tab) ──► GATE-3

  L4  CROSS-TAB GUARDS   PHI everywhere (US-06) · QC-hold un-sellable (US-07) · depth deepen (US-08)
        ──► REVIEWER-4 ──► GATE-4 ──► FINAL audit re-run ──► main
```

**Why this order:** the three sibling facets each independently converge on the SAME shared files
(`entityHref`, `reactiveRefresh`/`RIPPLE`, the dossier shell, the smart-bar primitives). Those are
**contract files** (CLAUDE.md "Contract — don't fork these") — if 100 agents each create their own
`entityHref`, we get 100 divergent route maps. So L1 is a hard serialization point: build + freeze
the contract, THEN fan out 100-wide against the frozen import. Every later layer is pure leaf work
(add a `<Link>`, add a route folder, add a section) that touches **disjoint files**, so it
parallelizes without merge risk.

---

## 1. The dependency layers (what unblocks what)

| Layer | Unit of work | Parallel width | Depends on | Gate to exit |
|---|---|---|---|---|
| **L0** | walking skeleton (slice-01) | 1 | live spine (exists) | build+test green, ripple visibly lands |
| **L1** | 3 shared-foundation contract PRs | 3 (one author each) | L0 green | each PR test-first green + REVIEWER-1 coherence |
| **L2** | 7 dossier routes | 7 | L1 frozen (`entityHref`, shell, sections) | REVIEWER-2 (every dossier 404s + ≥4 cross-links) |
| **L3** | ~95 leaf wire-up items (cosmetic/mock/dead/depth) | **100+** | L1 frozen; L2 routes EXIST (links need a target) | rolling REVIEWER-3 per tab |
| **L4** | cross-tab guards + thin-tab deepen | ~6 | L2 (guards link to dossiers), L3 patterns | REVIEWER-4 + FINAL audit |

**The two true serialization points** (everything else is wide fan-out):
1. **L0 → L1**: the skeleton proves the reactive mechanism is real before we invest in 100 wirings.
2. **L1 → L2/L3**: the contract files must be merged + frozen before the leaf fleet imports them.

After L1 freezes, L2 (7 agents) and the **link-target-independent** parts of L3 can begin; the
**link-emitting** parts of L3 wait only on the *specific* L2 dossier they link to (plot rows wait on
`/plots/[id]`, worker rows on `/workers/[id]`) — a fine-grained, not whole-layer, dependency (§5).

---

## 2. L0 — Walking skeleton (slice-01), ships first, ALONE

**Owner:** 1 agent. **Branch:** `claude/p5-slice-01-weigh-ripple`. **No other Phase-5 work starts
until this is green on `main`.** This is the riskiest-assumption gate: *does the existing reactive
mechanism visibly land end-to-end and feel trustworthy?* (story-map §"Walking Skeleton").

**Scope (file-disjoint, per facet-01 §4 + facet-03 §6):**

| File | Change | Test (written first) |
|---|---|---|
| `src/lib/revalidate.ts` **(NEW)** | the `RIPPLE` map + `reactiveRefresh` — but ONLY the `"weigh-in"` row needed here; full map is F-A | unit: `reactiveRefresh("weigh-in")` busts the J1 route set (mock `revalidatePath`) |
| `src/components/sections/weigh/ripple-proof.tsx` **(NEW)** | client island, props per facet-01 §2 (`RippleProofProps`) | render: names ≥2 consumers, each a real `<a href>`, shows `+18.4 kg` |
| `src/components/sections/weigh/weigh-capture.tsx` | thread `res.lotCode`/`kgNum` into `<RippleProof>` below `<WeighTally>` | behavior: stubbed successful `submit` → panel lists Dashboard + `/lots/<code>` |
| `src/app/(app)/page.tsx:18` | delete the false "reads from canonical mock data" comment | covered by the db-test below |
| `src/**/*.db.test.ts` (db project) | — | `weigh-ripples-to-two-consumers` + `season-derives-from-harvests` + `exactly-once-replay` (facet-01 §5) |

**Note on `revalidate.ts`:** slice-01 creates the file with the `"weigh-in"` row only; **F-A (L1)
extends the same file** with the rest of the `RIPPLE` map. To keep them from colliding, slice-01's
author hands `revalidate.ts` to the F-A author (same lane) — OR slice-01 ships the full skeleton of
the map (all keys, only `"weigh-in"` exercised) and F-A only fills values. **Decision: slice-01
ships the full `RIPPLE` key set with real route arrays (cheap, it's just the audit's "Connects to"
graph), and F-A's job collapses to the guard test + verification.** This removes the one
foundation/skeleton file overlap.

**GATE-0 (exit):** `npm run build` green, `npm run test` green (ui + db projects), and a dogfood
check that a capture's proof panel renders and the linked Dashboard figure agrees. Only then L1 opens.

---

## 3. L1 — Shared foundation (3 contract PRs, one author each, parallel)

These are the files the entire L2/L3 fleet imports. **One author per PR, file-disjoint, built
test-first, merged + frozen before fan-out.** They run concurrently (3 agents) because they touch
disjoint files. A reviewer pass (REVIEWER-1) closes them as a set before L2/L3 import them.

### F-A — Reactive-refresh SSOT  ·  owner: 1 agent  ·  `claude/p5-foundation-reactive`
- **Files:** `src/lib/revalidate.ts` (complete the `RIPPLE` map started in slice-01; facet-03 §4.1),
  `src/lib/__tests__/revalidate.test.ts`, `src/lib/__tests__/ripple-routes-exist.test.ts`.
- **Contract:** `RIPPLE: Record<EventKind, readonly string[]>` + `reactiveRefresh(kind)`; one row per
  write kind, values = the audit's "Connects to" route set (`weigh-in`, `qc-hold`, `spray`, `plot`,
  `disbursement`, …).
- **Guard test (the load-bearing one):** every route in `RIPPLE` resolves to a real
  `src/app/(app)/**/page.tsx` — so a renamed tab can't silently drop a downstream consumer
  (facet-03 §5).
- **Depends on:** slice-01 (which created the file). **Blocks:** every L3 EDIT/CREATE binding (they
  call `reactiveRefresh`).

### F-B — Smart-bar primitives  ·  owner: 1 agent  ·  `claude/p5-foundation-smartbar`
- **Files (all NEW, facet-03 §1):** `src/components/ui/edit-dialog.tsx`,
  `src/components/ui/smart-form.tsx`, `src/components/ui/form-field.tsx`,
  `src/components/ui/entity-link.tsx` (hosts `EntityLink` + the `entityHref` SSOT), and their
  `__tests__/*.test.tsx`.
- **Contract:** `EditDialog` (render-prop trigger), `SmartForm` (`SmartActionState`, `SMART_IDLE`,
  `SmartReducer`), `FormField` (`FIELD`/`LABEL` glass classnames), `EntityLink` + `entityHref`.
- **Tests first:** EditDialog open/close/ESC; SmartForm success-pane/error/idempotency; `entityHref`
  unit (encodes ids, `anchor` appends `#`); `EntityLink` renders `<a href aria-label>`.
- **Blocks:** every L3 NAVIGATE/DRILL/EDIT/CREATE binding and every L2 dossier (sections wrap names
  in `EntityLink`).

### F-C — Dossier shell  ·  owner: 1 agent  ·  `claude/p5-foundation-dossier-shell`
- **Files (all NEW, facet-02 §3–4):** `src/components/dossier/dossier-shell.tsx`,
  `src/components/dossier/dossier-section.tsx`, and `__tests__/*.test.tsx`.
- **Contract:** `<DossierShell kind title eyebrow subtitle backHref backLabel actions children>` +
  `<DossierSection id title count empty emptyLabel children>` (deep-linkable `#anchor`).
- **Tests first:** shell renders title/eyebrow/back-link; section renders `#anchor`, count badge,
  empty state.
- **Blocks:** all 7 L2 dossier routes.

### 🔴 The `entityHref` reconciliation (a real conflict in the inputs — RESOLVE in L1)
Facet-02 §5 puts `entityHref` in **`src/lib/dossier/entity-href.ts`** (an object of functions); facet-03
§1.3 puts it inline in **`src/components/ui/entity-link.tsx`** (a `Record<EntityKind, fn>`). Two SSOTs
= drift. **Decision for DELIVER: ONE file — `src/lib/dossier/entity-href.ts`** exports `entityHref`
(the pure map, importable by Server Components, the Map island's imperative `router.push`, db-free
unit tests, and the ⌘K palette). `entity-link.tsx` **imports** it (does not redefine it). Rationale:
the imperative Map-click (`FarmMap.client.tsx`, facet-03 §3.3) and the palette (facet-02 §6) need
`entityHref` **without** pulling in a React component; a `lib/` location keeps it dependency-light.
F-B owns both files but `entity-href.ts` is the SSOT; `entity-link.tsx` re-exports `EntityLink` only.
This collapses the two facets' overlap into one frozen import — **the single most important
coherence fix in this plan.**

### REVIEWER-1 (closes L1):
Checks the three PRs cohere: `entityHref` lives in exactly one file and both facets import it;
`SmartActionState` ↔ existing `ActionState` shapes are compatible (so a route action passes straight
into `SmartForm`); `RIPPLE` keys match the event kinds the L3 actions will call; no contract file
forks `src/lib/**` or `globals.css`. **GATE-1:** all three green + REVIEWER-1 sign-off → L2/L3 open.

---

## 4. The one-schema-author lane (S-LANE)

Per CLAUDE.md Rule (one migration author) + global "one schema author at a time": **a single agent
owns `supabase/migrations/*` for the entire phase.** Phase 5 is overwhelmingly **schema-free** — the
reactive graph, all 7 dossiers, and every wire-up item read **existing** views/getters (facet-01 §7:
"thin, additive, schema-lane-free"; facet-02 §7: "no migrations, no new tables").

**S-LANE only activates if a guard needs a DB object**, e.g.:
- a `*__deprecated`-read static guard that needs a catalog view, or
- a thin convenience view if a dossier getter proves too expensive in-memory (unlikely — facet-02
  filters existing views).

If activated: the S-LANE author picks a migration timestamp **strictly greater than the current
prod/repo max** (global rule: check applied max, not just repo max), ships it test-first with a
PGlite db-test, and **no other agent touches `supabase/migrations/`**. Default expectation:
**S-LANE ships zero migrations** and exists only as the serialization guarantee. New **getters**
(facet-02 §7: `getHarvestsForPlot`, `getCrewById`, `getDispatchRunById`, …) are NOT schema — they are
read-only `src/lib/db/*` additions, each in its own file or appended by the owning dossier agent
(file-disjoint by dossier), so they fan out in L2, not S-LANE.

---

## 5. L2 — Entity dossiers (7 agents, file-disjoint, parallel)

After GATE-1, fan out **7 agents**, one per dossier, each owning a **disjoint route folder + section
set + its NEW getter(s)** (facet-02 §10). All import the frozen L1 contract (`DossierShell`,
`DossierSection`, `entityHref`, `EntityLink`).

| Agent | Branch | Owns (file-disjoint) | NEW getter(s) | Story |
|---|---|---|---|---|
| L2-plot | `claude/p5-dossier-plot` | `app/(app)/plots/[id]/{page,loading,error}.tsx` + `components/sections/plots/plot-*-section.tsx` | `getHarvestsForPlot`, `getPlotOriginStatus` | US-03 |
| L2-worker | `claude/p5-dossier-worker` | `app/(app)/workers/[id]/*` + `components/sections/workers/worker-*-section.tsx` | `getWorkerWeighSummary`, attendance/por-obra getters | US-04 |
| L2-crew | `claude/p5-dossier-crew` | `app/(app)/crew/[id]/*` + `components/sections/crew/crew-*-section.tsx` | `getCrewById` | R2 |
| L2-dispatch | `claude/p5-dossier-dispatch` | `app/(app)/dispatch/[id]/*` | `getDispatchRunById` | R4 |
| L2-payperiod | `claude/p5-dossier-payperiod` | `app/(app)/pay-period/[id]/*` | `getPayPeriodById` | R4 |
| L2-orphan-wire | `claude/p5-wire-orphans` | `command-palette.tsx` (extend `results` only) + nav entries | — (wiring only) | US-05 |
| L2-lot/ferment/cup retrofit | `claude/p5-dossier-retrofit` *(optional, off critical path)* | retrofit `/lots/[code]`,`/ferment/[batch]` onto `<DossierShell>` | — | facet-02 §11 |

**Per-dossier invariants (facet-02 §2 P1–P7):** async RSC; resolve anchor entity with ONE getter →
`notFound()` before section fetch; `Promise.all` section reads; render through `<DossierShell>` + N
`<…Section>`; **no `src/lib/data/*` import**; every entity name is `<EntityLink>`; `loading.tsx`
skeleton. Each ships render tests (sections) + behavior tests (known id renders, **unknown → 404**,
≥4 cross-links) **written first**.

**Getter-file collision avoidance:** each dossier's NEW getters land in the **dossier-owning agent's
branch**, in the getter file for that entity (`plots.ts`, `people.ts`, `dispatch.ts`, `payroll.ts`,
`weigh.ts`). These are disjoint **files**, but `people.ts` is touched by both L2-worker and L2-crew —
**resolve by splitting:** worker getters in `people.ts`, crew getter `getCrewById` appended by
L2-crew to `people.ts` is the one overlap → **give `getCrewById` to L2-worker** (single author of
`people.ts`) and have L2-crew import it. (Flagged so the orchestrator assigns `people.ts` to one
author.)

### REVIEWER-2 (closes L2):
Every dossier: 404s on unknown id (no fabricated story); ≥4 cross-entity `EntityLink`s
(`outcome-kpis.md` KPI 5); uses the shell (chrome coherent); zero mock import. **GATE-2:** 7 routes
green + REVIEWER-2 → the link-emitting half of L3 fully unblocks.

---

## 6. L3 — The big fan-out (~95 leaf items, 100-wide, file-disjoint)

This is the bulk: **~88 COSMETIC + 6 MOCK + 1 DEAD + the per-tab depth pass** (wire-up-audit). Each
item is a **leaf edit** — wrap a row in `<EntityLink>`, swap a mock import for a live getter, add a
`router.push` to the Map click, add an `EditDialog`+`SmartForm` to an editable field. Every edit
imports the **frozen L1 contract** and links a **L2 dossier that now exists**.

### 6.1 The work-breakdown axis: one agent per (tab × verb cluster)
The audit gives a per-tab element inventory with a verb (EDIT/CREATE/DRILL/NAVIGATE) decidable
mechanically (facet-03 §2 decision tree). Decompose so each agent owns a **disjoint file set** —
the natural unit is **one tab's section components** (`src/components/sections/<tab>/*` +
`src/app/(app)/<tab>/page.tsx`), since the audit already scoped work per tab and sections rarely
share files across tabs.

| Agent cluster | Tab(s) | Audit items to close | Verb mix | Links to (L2) |
|---|---|---|---|---|
| L3-dashboard | Dashboard | PlotHealth rows, Pipeline rows, ActivityFeed rows (7 cosmetic) + stale comment (done in L0) | NAVIGATE | plot, lot, worker |
| L3-plots | Plots | plot card/row/table-row (3 cosmetic) | NAVIGATE | plot |
| L3-map | Map | **the 1 DEAD polygon click** → `router.push(entityHref.plot)` | NAVIGATE (imperative) | plot |
| L3-harvests | Harvests | top-picker rows (1 cosmetic) | NAVIGATE | worker |
| L3-plan | Plan | readiness/timeline/pasada rows | NAVIGATE | plot |
| L3-dispatch | Dispatch | dispatch cards (2 cosmetic) | NAVIGATE | dispatch, crew |
| L3-processing | Processing | batch rows deepen | NAVIGATE/DRILL | lot, batch |
| L3-ferment | Ferment | curve cards (4 cosmetic) | DRILL | batch |
| L3-drying | Drying | station cards (9 cosmetic; keep "Mill" STUB) | NAVIGATE/DRILL | lot, plot |
| L3-inventory | Inventory | green-lot rows (7 cosmetic; keep "Sold out" STUB) | NAVIGATE | lot |
| L3-qc | QC | cup-to-cause plot/worker refs (23 cosmetic) | NAVIGATE | plot, worker |
| L3-scouting | Scouting | threshold "control task" → `/tasks`; spray rows | NAVIGATE/DRILL | plot, spray |
| L3-costing | Costing | KPI tiles (3 cosmetic) | DRILL | lot `#cost-entries` |
| L3-eudr | EUDR | origin-plot rows (11 cosmetic) | NAVIGATE | plot, lot |
| L3-workers-mock | Workers | **the 6 MOCK (`CREWS`)** → live `getCrews()` + crew cards → `EntityLink kind="crew"` | NAVIGATE + mock-kill | crew, worker (US-02) |

≈15 tab-clusters; several tabs (QC 23, Drying 9, EUDR 11) split further into **multiple agents per
tab** (one per section file) to hit 100-wide. The audit's per-tab element tables are the work tickets.

### 6.2 File-disjointness guarantee
- Each agent edits only files under its tab's `src/components/sections/<tab>/*` (+ that tab's
  `page.tsx`). Tabs are disjoint directories → **no two agents touch the same file**.
- All agents **read-only import** the frozen contract (`EntityLink`, `entityHref`, `EditDialog`,
  `SmartForm`, `reactiveRefresh`) — no agent edits a contract file (CLAUDE.md "don't fork").
- The Workers mock-kill (US-02) needs a **`getCrews()` getter**; assign it to the L2-crew/`people.ts`
  author (single `people.ts` author), L3-workers-mock imports it. (Same `people.ts` single-author
  rule as §5.)

### 6.3 Test-first per leaf (no UI exemption — CLAUDE.md)
Every leaf ships, written first: a **render test** that the formerly-COSMETIC row now renders an
`<a href>` to the expected dossier (catches regression to dead UI), and where it's an EDIT/CREATE,
an **action by-shape test** (valid FormData → command called once → `success`; invalid → `error`,
command not called) per facet-03 §5. Bug-class regressions (a re-introduced dead click) are caught
by the **`no-dead-ui` static guard** (§8).

### Rolling REVIEWER-3 (per tab, not per layer):
Per CLAUDE.md audit-loop rule — **as each tab-cluster agent returns, immediately dispatch its
reviewer**; don't wait for all 15. Reviewer checks: every audit row for that tab is now WIRED (no
COSMETIC entity rows remain), no dead pointer cursors, the 3 intentional STUBs are preserved, tests
green. **GATE-3:** all tab-clusters reviewed + the audit re-run shows COSMETIC entity-rows = 0,
MOCK = 0, DEAD = 0.

---

## 7. L4 — Cross-tab guards + thin-tab deepen (~6 agents)

These build on L2 (guards link to the entity they concern) and L3 patterns. File-disjoint by surface.

| Agent | Story | Owns | Source (existing) |
|---|---|---|---|
| L4-phi | US-06 | PHI badge on Map, Satellite, Scouting, `/plots/[id]` | `v_plot_phi_status` (ONE source drives gate + display) |
| L4-qc-hold | US-07 | "no vendible" banner + blocked Reserve on Inventory + Dispatch | `getQcStatus().held` (DB guard remains SSOT) |
| L4-satellite | US-08 | vegetation card → `/plots/[id]#satellite`; PHI chip → spray record; "scout this plot" → Scouting prefilled | `getPlotVegetation`, `getSprayHistory` — **depends on L2-plot** |
| L4-depth-* | R4 depth | deepen any tab still "partial/thin" on the audit to "deep" | per-tab |

**Dependency:** L4-satellite (US-08) **depends on L2-plot** (`/plots/[id]` must exist to link to) —
this is the one cross-layer story dependency the user-stories flag (US-08 → US-03). L4-phi/L4-qc-hold
depend only on L1 (they DRILL/NAVIGATE + `reactiveRefresh("spray"|"qc-hold")`).

### REVIEWER-4 + FINAL audit (closes the phase):
- REVIEWER-4: PHI date displayed == gate boundary on every surface (single source); a held lot is
  blockable everywhere it's sellable; Satellite has 0 cosmetic-only entity controls.
- **FINAL audit re-run** (the north-star metric, `outcome-kpis.md` KPI 1): re-run the wire-up-audit
  element census → **100% wired, 0 mock, 0 dead, 17/17 deep, every dossier reachable, ≥4 links/
  dossier**. Per CLAUDE.md: iterate audit→fix→verify until **two consecutive clean rounds** (0
  CRIT/0 HIGH) before the final merge to `main`.

---

## 8. The standing guards wired into the local gate (CI-free repo)

`npm run test` (ui + db projects) is the gate that replaces CI (CLAUDE.md $0/no-CI). These guards,
authored in L0/L1, run on every PR and hold the KPI guardrails machine-checked so a later slice can't
regress them:

| Guard | File | Asserts (KPI) | Authored in |
|---|---|---|---|
| `no-dead-ui` static guard | `src/lib/__tests__/no-dead-ui.test.ts` | DEAD count = 0 (KPI 3) | F-B (L1) |
| `no-mock-reads` grep guard | `src/lib/__tests__/no-mock-reads.test.ts` | `grep "from '@/lib/data/'"` over non-test `src/` = 0 (KPI 2) | F-B (L1); flips green when US-02 lands |
| `ripple-routes-exist` | `src/lib/__tests__/ripple-routes-exist.test.ts` | every `RIPPLE` route is a real `page.tsx` | F-A (L1) |
| `no-deprecated-read` | static grep test | no getter reads `*__deprecated` (facet-01 §5) | L0 |
| `weigh-ripples-to-two` / `season-derives-from-harvests` / `exactly-once-replay` | `*.db.test.ts` (PGlite) | the reactive spine (facet-01 §5) | L0 |
| per-dossier `notFound()` behavior tests | each dossier `__tests__` | unknown id → 404 (no fabricated story) | L2 |

> **Guardrail discipline (global Rule 5):** a guard that goes dead (e.g. the mock-grep silently
> matching nothing because a path moved) is itself an incident — REVIEWER passes verify each guard
> still *exercises* its target, not just that it's green.

---

## 9. The reviewer-pass checkpoints (every fan-out closes with one)

Per CLAUDE.md "always close with a reviewer pass" + "two consecutive clean rounds":

| Checkpoint | After | Reviewer checks | Gate |
|---|---|---|---|
| **REVIEWER-1** | L1 (3 contract PRs) | `entityHref` single SSOT; `SmartActionState`↔`ActionState` compat; `RIPPLE` keys ↔ L3 actions; no contract fork | GATE-1 |
| **REVIEWER-2** | L2 (7 dossiers) | every dossier 404s; ≥4 cross-links; shell-coherent; 0 mock import | GATE-2 |
| **REVIEWER-3** | each L3 tab-cluster (rolling) | tab's audit rows all WIRED; 0 dead cursors; 3 STUBs preserved | GATE-3 |
| **REVIEWER-4** | L4 (guards + depth) | PHI date == gate; held lot blockable everywhere; Satellite 0 cosmetic | GATE-4 |
| **FINAL** | whole phase | full audit re-run = 100%/0/0/17-deep; 2 consecutive clean rounds | merge to `main` |

Each gate is local: `npm run build` green **and** `npm run test` green (CLAUDE.md), plus the
reviewer sign-off. Nothing merges to `main` over a red gate.

---

## 10. Parallel-width summary (how the fleet is sized)

| Layer | Agents | Notes |
|---|---|---|
| L0 | 1 | serialized — the skeleton gate |
| L1 | 3 authoring + 1 reviewer (+ S-LANE idle) | one author per contract file; reconcile `entityHref` |
| L2 | 7 authoring + rolling reviewers | one per dossier; `people.ts` single-authored |
| L3 | **~100** authoring + rolling reviewers | one per (tab × section/verb) cluster; QC/Drying/EUDR split further |
| L4 | ~6 authoring + 1 reviewer | guards + thin-tab deepen; L4-satellite waits on L2-plot |

**Peak concurrency is L3 (~100-wide)** — exactly where the work is leaf-shaped and file-disjoint, so
maximal parallelism is *safe*. The narrow points (L0=1, L1=3) are narrow **by necessity** (contract
serialization), not by choice. This is the fastest a fleet can ship Phase 5 with the rails
(file-disjointness, one-schema-author, reviewer-per-fan-out, phased gate before `main`) intact.

---

## 11. Critical-path timeline (the longest dependency chain)

```
L0 slice-01 ─► GATE-0 ─► F-B (entityHref+shell deps) ─► L2-plot (/plots/[id]) ─► L4-satellite (US-08)
                                                                              └─► L3 plot-row links
                                                                              └─► REVIEWER-2 ─► GATE-2
```

The **longest chain** is: skeleton → smart-bar/shell foundation → plot dossier → Satellite drill-in
(US-08 depends on US-03). Everything else is shorter and runs in parallel against it. To compress:
**prioritize F-B + F-C and L2-plot** — they unblock the widest downstream fan-out (every plot-row
NAVIGATE in L3 + US-08 in L4). L2-worker/crew/dispatch/payperiod and the non-plot L3 clusters run
fully parallel to the critical path.

---

## 12. Open items flagged for the orchestrator (flag-don't-fix)

1. **`entityHref` location** (§3): I resolved it to `src/lib/dossier/entity-href.ts` as the single
   SSOT (facet-02 §5 location wins over facet-03's inline `entity-link.tsx` definition) because the
   Map imperative click + ⌘K palette need it component-free. The orchestrator should confirm and pin
   F-B to that decision so the two facets don't ship two maps.
2. **`people.ts` single author** (§5/§6.2): `getCrewById` + `getCrews()` + worker getters all touch
   `src/lib/db/people.ts` — assign that file to ONE author (suggest L2-worker), others import. Same
   rule for any shared getter file.
3. **`revalidate.ts` ownership across L0/F-A** (§2): slice-01 creates it with the full `RIPPLE` key
   set; F-A only adds the guard test. Confirm so they don't both write the map.
4. **Dispatch-run + pay-period param types** (facet-02 §11): `v_dispatch_card.id` is numeric, route
   param is string — coerce; confirm `getPayPeriods()` exposes the same id used in the `/pay-period/
   [id]` link. Resolve before L2-dispatch/payperiod start.
5. **Open Questions 1–4 in facet-01 §6** (COGS excluded from weigh ripple; offline lot link;
   `reactiveRefresh` helper; no Realtime) and **Open Questions in feature-delta §"Open Questions"**
   (release sequence, dossier scope, ⌘K, "deep" definition, keep 3 STUBs, stale `HANDOFF.md`) are
   inputs this plan assumes resolved as recommended; surface to Andres at the DESIGN review gate
   before DELIVER dispatches L1.
6. **S-LANE expected empty** (§4): if any agent discovers it needs a migration, it must route through
   the single schema author, not ship one in its own branch — escalate to the orchestrator.
