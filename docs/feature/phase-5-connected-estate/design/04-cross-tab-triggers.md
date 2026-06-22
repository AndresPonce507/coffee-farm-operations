# Design · Facet 04 — Cross-Tab Auto-Trigger Architecture (the GUARD SURFACE pattern, J3)

> How one state change auto-blocks AND auto-flags affected actions EVERYWHERE, with one
> source of truth per guard. Grounded in the real code at
> `/Users/andres/coffee-farm-operations-worktrees/phase1-deliver` (branch `main`). Cites actual
> migrations / views / RPCs / triggers / getters / components.
>
> Hands off FROM facet-01 (`01-reactive-graph.md` §2 "PHI / QC facet handoff", §7): a guard's gate
> AND its display read **ONE source** (propagation invariant #1) — no duplicate cache. This facet
> turns that one-liner into the concrete, reusable contract.

---

## 0. TL;DR — the guard surface in one paragraph

Three load-bearing safety invariants **already exist in the database**, each as a *derived status*
+ a *fail-closed enforcement trigger*: **PHI** (`v_plot_phi_status` + the `schedule_pasada` /
`replan_pasada` gate), **QC-hold** (`v_qc_status` + `_prevent_held_lot_commit` on
`lot_reservations`/`lot_shipments`), and **reposo/moisture** (`v_reposo_status` +
`advance_processing_stage` precondition + the `lots_enforce_reposo_gate` backstop trigger). Today
each surfaces with a *bespoke* UI widget (`PhiChips`, `QcHoldBanner`, `ReposoGateChip`) on its home
tab only, and each Server Action maps the block error with its own hand-rolled `friendlyError`. The
gap the mandate targets is **not enforcement** (the teeth are real and complete) — it is
**reach**: a PHI window is invisible on Map/Satellite/Plan-readiness/Plot-dossier; a QC-hold is
invisible on Dispatch and the lot dossier; a moisture-not-stable lot shows no flag on the Drying
board's other surfaces. Phase 5 **generalizes** the three into ONE *guard contract*: per guard, (a)
a single **derived status view** (already exists — reuse, do not duplicate), (b) one **shared
`<GuardBadge>` / `<GuardBanner>` / `<GuardBlock>` component family** keyed by a small `GuardStatus`
type, surfaced on **every** tab the entity appears, and (c) one **shared `guardError()` mapper** so
every blocked action returns the same human sentence. **No new enforcement, no new infra, no
Realtime** — the gate stays in the DB; this facet makes the same single source *visible and
honest everywhere*.

---

## 1. The three existing guards — the SSOT inventory (reuse, never re-derive)

| Guard | Derived status view (SSOT) | Migration | Enforcement (data layer) | Entity key |
|---|---|---|---|---|
| **PHI / REI** (pre-harvest + re-entry interval) | `v_plot_phi_status` (`phi_active`, `rei_active`, `phi_clears_on`, `rei_clears_at`, `product`) | `20260622106000_remote_sensing_ipm.sql` L287-302 | `schedule_pasada` + `replan_pasada` fail-closed PHI gate (`20260623110000_phi_planner_gate.sql` L87-98, L200-211), errcode `check_violation` | `plot_id` |
| **QC-hold** (quarantine → un-sellable) | `v_qc_status` (`held`, `hold_reason`) | `20260622096000_qc_cupping.sql` L312-346 | `_prevent_held_lot_commit` BEFORE INSERT/UPDATE on `lot_reservations` + `lot_shipments` (L199-238), errcode `check_violation` | `green_lot_code` |
| **Reposo / moisture** (rest-stability before milling) | `v_reposo_status` / `reposo_status(lot_code)` (`ready`, `moisture_stable`, `rest_met`, `latest_moisture`, `reason`) | `20260622094000_drying_reposo.sql` L183-290 | `advance_processing_stage` precondition (L485-511) + `lots_enforce_reposo_gate` BEFORE UPDATE backstop on `lots` (L533-566), errcode `check_violation` | `lot_code` |

**The three are structurally identical** — this is what makes the pattern generalizable:

1. **An append-only evidence ledger** drives a **`security_invoker` derived view** that computes a
   boolean "blocked?" + a human `reason`/window. (`spray_application`→`v_plot_phi_status`;
   `qc_holds`→`v_qc_status`; `moisture_readings`+`lot_event`→`v_reposo_status`.)
2. **The exact same view/predicate is consulted by a fail-closed trigger or RPC precondition** at
   the write door, raising `check_violation` so the block is a *database fact*, not a UI courtesy.
3. The boolean is **reactive-on-read** (facet-01 §1.2): a new evidence row (a spray, a hold, a wet
   moisture reading) flips the status for the *next* read on *every* tab with **zero refresh** —
   under `force-dynamic` (`src/app/(app)/layout.tsx:7`) every RSC render reads live.

**Propagation invariant #1 (facet-01 §3) is the law here: the gate and every display read the SAME
view.** A guard badge must NEVER recompute "is it blocked" client-side from raw evidence — it reads
the view's boolean. Otherwise the chip and the database can disagree (the exact failure the QC-hold
migration header warns against: "the disabled UI button is courtesy; the gate is in the database").

---

## 2. The GUARD CONTRACT — one shared type + getter shape

A guard is fully described by a small, uniform domain type. NEW file
`src/lib/guards/types.ts`:

```ts
/** Which safety invariant a guard status describes. */
export type GuardKind = "phi" | "qc-hold" | "reposo";

/** The entity a guard binds to (drives the dossier link + the keying). */
export type GuardEntity =
  | { kind: "plot"; id: string }        // PHI  → /plots/[id]
  | { kind: "green-lot"; code: string } // QC   → /lots/[code]
  | { kind: "lot"; code: string };      // reposo → /lots/[code]

/**
 * The normalized, UI-ready verdict for ONE guard on ONE entity. Every guard view
 * maps into this shape so ONE <GuardBadge> family renders all three. `blocked` is
 * the SINGLE source boolean read straight off the derived view (never recomputed).
 */
export interface GuardStatus {
  kind: GuardKind;
  entity: GuardEntity;
  /** true ⇒ a real DB gate will fail-close an affected action. Read off the view. */
  blocked: boolean;
  /** short human reason the DB will give, SQL-free (e.g. "PHI until 2026-07-02"). */
  reason: string;
  /** the affected actions this guard blocks, for the badge tooltip / a11y label. */
  blocks: readonly GuardAction[];
  /** machine detail for the chip body (clears-on dates, moisture %, etc.). */
  detail?: Record<string, string | number | null>;
}

/** A cross-tab action a guard can block — drives the "what this stops" copy. */
export type GuardAction =
  | "schedule-pasada" | "replan-pasada"   // PHI
  | "reserve-lot" | "ship-lot"            // QC-hold
  | "advance-to-mill";                    // reposo
```

### 2.1 The guard read-port — NEW `src/lib/guards/status.ts`

Thin mappers over the **existing** getters (no new view, no new query). Each maps the live view row
into `GuardStatus`. **All three already have getters** (`getPlotPhiStatus`, `getQcStatus`, and the
reposo board getter in `src/lib/db/drying.ts`) — `status.ts` only normalizes:

```ts
import { getPlotPhiStatus } from "@/lib/db/remote-sensing";
import { getQcStatus }      from "@/lib/db/qc";
import { getReposoStatuses } from "@/lib/db/drying";  // existing v_reposo_status getter

export const getPhiGuards = cache(async (): Promise<GuardStatus[]> =>
  (await getPlotPhiStatus())
    .filter(p => p.phiActive || p.reiActive)
    .map(mapPhiToGuard));        // pure, unit-tested

export const getQcGuards = cache(async (): Promise<GuardStatus[]> =>
  (await getQcStatus())
    .filter(q => q.held)
    .map(mapQcToGuard));

export const getReposoGuards = cache(async (): Promise<GuardStatus[]> =>
  (await getReposoStatuses())
    .filter(r => !r.ready)
    .map(mapReposoToGuard));

/** Lookup helpers a dossier/row uses to ask "is THIS entity guarded?" */
export const phiGuardForPlot   = (g: GuardStatus[], plotId: string) => g.find(x => x.entity.kind === "plot"      && x.entity.id   === plotId)   ?? null;
export const qcGuardForLot     = (g: GuardStatus[], code: string)   => g.find(x => x.entity.kind === "green-lot" && x.entity.code === code)     ?? null;
export const reposoGuardForLot = (g: GuardStatus[], code: string)   => g.find(x => x.entity.kind === "lot"       && x.entity.code === code)     ?? null;
```

Pure mappers (the test-first unit surface — each guard's `mapXToGuard` is one logic file):

```ts
// PHI: blocked = phiActive (pick-blocking) OR reiActive (entry-blocking).
function mapPhiToGuard(p: PlotPhiStatus): GuardStatus {
  return {
    kind: "phi",
    entity: { kind: "plot", id: p.plotId },
    blocked: p.phiActive || p.reiActive,
    reason: p.phiActive ? `PHI hasta ${p.phiClearsOn}` : "REI activo — no entrar",
    blocks: p.phiActive ? ["schedule-pasada", "replan-pasada"] : [],
    detail: { product: p.product, phiClearsOn: p.phiClearsOn, reiClearsAt: p.reiClearsAt },
  };
}
// QC-hold: blocked = held; blocks reserve + ship.
function mapQcToGuard(q: QcStatus): GuardStatus {
  return {
    kind: "qc-hold",
    entity: { kind: "green-lot", code: q.greenLotCode },
    blocked: q.held,
    reason: q.holdReason ?? "En cuarentena QC",
    blocks: ["reserve-lot", "ship-lot"],
    detail: { primaryDefects: q.primaryDefects, secondaryDefects: q.secondaryDefects },
  };
}
// reposo: blocked = !ready; blocks the mill advance.
function mapReposoToGuard(r: ReposoStatus): GuardStatus {
  return {
    kind: "reposo",
    entity: { kind: "lot", code: r.lotCode },
    blocked: !r.ready,
    reason: r.reason,        // the DB-authored reason ("resting 4/5 days", "moisture 11.8% not yet stable")
    blocks: ["advance-to-mill"],
    detail: { latestMoisture: r.latestMoisture, restDaysElapsed: r.restDaysElapsed },
  };
}
```

**Why normalize at all (vs. three bespoke widgets)?** So that a NEW surface (Map polygon, Plan
readiness row, plot dossier, dispatch card) takes ONE `GuardStatus[]` prop and renders the right
badge regardless of guard kind — and so a future 4th guard (e.g. a cert-expiry block on `log_spray`)
adds one mapper + one row to the badge token table, nothing else.

---

## 3. The shared component family — `<GuardBadge>` / `<GuardBanner>` / `<GuardBlock>`

Three render levels for the same `GuardStatus`, replacing the three bespoke widgets. NEW dir
`src/components/guards/`. All Server Components (no hooks) except `<GuardBlock>`'s disabled-submit
variant. Reduced-motion-safe, WCAG-AA on the real aurora background (reuse the
`ReposoGateChip` darkened-text precedent: `text-[#8f3522]` on `bg-cherry-100` = 6.0:1).

### 3.1 `<GuardBadge>` — the inline chip (replaces `PhiChips`' per-plot pill + reposo chip)

```ts
// src/components/guards/guard-badge.tsx  (NEW, Server Component)
export interface GuardBadgeProps {
  status: GuardStatus;
  /** "compact" = icon + short reason (rows/cards); "full" = + the entity name. */
  variant?: "compact" | "full";
}
```

- **Tone by kind/severity:** PHI-active / QC-held / reposo-not-stable → `tone="danger"` (cherry);
  REI-only → `tone="warn"` (honey). Maps onto the existing `Badge` `BadgeTone` (`badge.tsx`).
- **Icon by kind:** PHI `Clock`, QC `ShieldAlert`, reposo `Lock`/`Droplets` (lucide, decorative —
  `aria-hidden`; the text carries meaning, per `ReposoGateChip`'s a11y note).
- **a11y label:** `role="status"`, `aria-label` = `${entityName} — ${reason} (bloquea: ${blocks})`.
- **Clickable → dossier** (PRINCIPLE Rule 3): the badge is wrapped in `<Link href>` to the entity
  dossier (`/plots/[id]`, `/lots/[code]`) so a guard chip is itself a drill-in, never dead UI.

### 3.2 `<GuardBanner>` — the prominent alert (generalizes `QcHoldBanner`)

```ts
// src/components/guards/guard-banner.tsx  (NEW, Server Component)
export interface GuardBannerProps {
  status: GuardStatus;
  /** optional CTA: the resolve action (e.g. "Release hold" link to /qc). */
  resolveHref?: string;
  resolveLabel?: string;
}
```

`role="alert"`, full-width red glass (the `QcHoldBanner` styling, lifted verbatim and parameterized
over `kind`). Shown at the TOP of a dossier / a board section when the entity is blocked. The QC
variant gets `resolveHref="/qc#holds"`; PHI gets `resolveHref="/scouting"` (the spray that set it);
reposo gets `resolveHref="/drying"`.

### 3.3 `<GuardBlock>` — the disabled-affordance wrapper (the "auto-block" surface)

This is the *cross-tab block* primitive. It wraps any action control (a "Reserve" button, a
"Schedule pick" CTA, a "Advance to mill" button) and, when a matching `GuardStatus.blocked` is true,
renders it **disabled + courtesy-explained**, with the DB gate as the real backstop behind it.

```ts
// src/components/guards/guard-block.tsx  (NEW; client only if it wraps an interactive submit)
export interface GuardBlockProps {
  /** the guard(s) relevant to THIS action; if any is blocked, the child is disabled. */
  guards: GuardStatus[];
  /** which action this control performs — matched against each guard's `blocks`. */
  action: GuardAction;
  children: React.ReactNode;   // the real button/CTA, cloned with disabled + aria-describedby
}
```

Behavior: if `guards.some(g => g.blocked && g.blocks.includes(action))`, the child is rendered
`disabled`, `aria-disabled`, with a `<GuardBadge variant="compact">` tooltip explaining why, and the
submit is intercepted (no-op + focus the badge). **This is courtesy** — exactly like the existing
"Sold out" / "Mill — locked" STUBs the wire-up audit flags as *intentional* (keep). The actual
enforcement is the DB trigger; `<GuardBlock>` only mirrors it so the owner sees the block *before*
clicking. The DISCUSS Open Question 5 (keep the 3 courtesy STUBs) is satisfied: those three become
`<GuardBlock>` instances reading the live guard, not hardcoded disabled buttons.

**Invariant:** `<GuardBlock>` must NEVER be the only thing stopping a write. Every action it wraps
must already have a DB gate (the table in §1). A reviewer-pass guard test asserts this (§6).

---

## 4. The enforcement-vs-surface MATRIX — where each guard lives at the data layer vs. the UI

This is the deliverable the task asks for: *for each guard, where is it ENFORCED at the data layer
vs. SURFACED in UI.* Enforcement rows already exist (do not touch the teeth); surface rows are the
Phase-5 work (each is a file-disjoint DELIVER slice).

### 4.1 PHI / REI guard

| Where | Layer | Mechanism | Status |
|---|---|---|---|
| Harvest planner (schedule + re-plan) | **ENFORCE** | `schedule_pasada`/`replan_pasada` PHI gate, `check_violation` | EXISTS (`20260623110000`) |
| Scouting tab (home) | SURFACE | `PhiChips` → migrate to `<GuardBadge>` strip | exists → generalize |
| **Plan tab — readiness rows** | SURFACE + BLOCK | `<GuardBadge>` on each plot readiness row; the "Schedule pasada" CTA wrapped in `<GuardBlock action="schedule-pasada">` | NEW (slice: cross-tab-PHI) |
| **Map — plot polygon / popup** | SURFACE | plot popup shows `<GuardBadge>` when `phiGuardForPlot` hits; the (newly-wired) polygon click → `/plots/[id]` carries the guard | NEW (depends on Map dead-click fix, facet-02/03) |
| **Satellite — vegetation card** | SURFACE | `<GuardBadge>` on each plot card; PHI chip links the spray that set it (`/scouting`) | NEW (US-08 deepen-satellite) |
| **`/plots/[id]` dossier** | SURFACE | `<GuardBanner>` at top when PHI/REI active + a PHI/REI section | NEW (facet-02 dossier; this facet supplies the badge) |

### 4.2 QC-hold guard

| Where | Layer | Mechanism | Status |
|---|---|---|---|
| Reserve a green lot | **ENFORCE** | `_prevent_held_lot_commit` BEFORE INSERT on `lot_reservations`, `check_violation` | EXISTS (`20260622096000`) |
| Ship a green lot | **ENFORCE** | same trigger on `lot_shipments` | EXISTS |
| QC tab (home) | SURFACE | `QcHoldBanner` + `qc-status-table` → banner becomes `<GuardBanner>` | exists → generalize |
| **Inventory — green-lot rows + reserve drawer** | SURFACE + BLOCK | `<GuardBadge>` on each held lot row; the reserve submit in `reservation-drawer.tsx` wrapped in `<GuardBlock action="reserve-lot">` ("no vendible" banner) | NEW (US-07) |
| **Dispatch — dispatch cards / lot picker** | SURFACE + BLOCK | held lots show `<GuardBadge>`; cannot be added to a dispatch run (`<GuardBlock action="ship-lot">`) | NEW (US-07) |
| **`/lots/[code]` dossier** | SURFACE | `<GuardBanner>` when held + the open-hold reason | NEW (facet-02 dossier) |

### 4.3 Reposo / moisture guard

| Where | Layer | Mechanism | Status |
|---|---|---|---|
| Advance a lot into milled/green | **ENFORCE** | `advance_processing_stage` precondition + `lots_enforce_reposo_gate` trigger, `check_violation` | EXISTS (`20260622094000`) |
| Drying tab — station cards / lot chips | SURFACE | `ReposoGateChip` → migrate to `<GuardBadge>` | exists → generalize |
| **Processing tab — "Advance to mill" CTA** | SURFACE + BLOCK | the advance button wrapped in `<GuardBlock action="advance-to-mill">` reading `reposoGuardForLot` (today the "Mill — locked" STUB the audit flags) | exists STUB → live guard |
| **Drying — moisture-threshold flag on lot rows** | SURFACE | a moisture-out-of-band lot shows a `<GuardBadge>` "moisture 11.8% — not stable" wherever the lot appears on the board | NEW (the J3 "moisture threshold → Drying flag" cross-tab ask) |
| **`/lots/[code]` dossier (drying section)** | SURFACE | `<GuardBadge>` + the `reposo_status.reason` in the lot's drying timeline | NEW (facet-02 dossier) |

---

## 5. The shared BLOCK-ERROR mapper — one human sentence everywhere

Today each Server Action hand-rolls `friendlyError` (`plan/actions.ts:75`) and the reserve command
has its own `isOversell` (`reserveGreenLot.ts:87`); **neither recognizes the PHI/QC/reposo gate
messages** — a fail-closed block currently leaks the raw `pasada gate: …` / `qc-hold: …` /
`reposo gate: …` SQL string or falls to the generic "We couldn't save that." This facet adds ONE
shared mapper so every blocked action returns the same SQL-free, es-PA sentence that AGREES with the
badge.

NEW `src/lib/guards/guardError.ts`:

```ts
/** Recognize a fail-closed guard rejection by its DB signature (errcode 23514 +
 *  the gate's message prefix) and return the human sentence — the SAME copy the
 *  matching <GuardBadge> shows, so the action error and the chip never disagree. */
export function guardError(error: { message: string; code?: string }): string | null {
  const m = error.message.toLowerCase();
  if (/pasada gate|active phi window|pre-harvest interval/.test(m))
    return "Ese lote está en ventana PHI — no se puede programar la pasada hasta que cierre el intervalo pre-cosecha.";
  if (/qc-hold|under an open qc-hold|qc-hold:/.test(m))
    return "Ese lote está en cuarentena QC (no vendible) — libera la retención en QC antes de reservar o despachar.";
  if (/reposo gate|not rest-stable/.test(m))
    return "Ese lote aún no está estable en reposo — necesita más días de descanso o humedad en banda antes de moler.";
  return null;   // not a guard block — let the caller's own mapper handle it
}
```

Each guard-affected action calls `guardError(error)` FIRST; on `null` it falls through to its
existing mapper. This keeps the **gate copy in one place** and makes the badge-reason and the
action-error provably consistent (a unit test asserts each gate's raised message maps to the same
string family as its `mapXToGuard.reason`).

**Why a regex on the message and not the errcode alone:** all three raise `check_violation`
(23514), as do the oversell + range guards — the message prefix (`pasada gate:` / `qc-hold:` /
`reposo gate:`, all stable strings authored in the migrations) is the discriminator. Those prefixes
are now a **contract**: a guard test (§6) asserts each migration still raises with its prefix, so a
future migration edit can't silently break the friendly mapping.

---

## 6. Guards wired into `npm run test` (CI-free repo — facet-01 §5 pattern)

Test-first, PGlite db-tests + jsdom render tests. File-disjoint per guard so the DELIVER fleet fans
out wide.

| Guard test | Asserts | Layer |
|---|---|---|
| `phi-blocks-pasada` (db) | a spray that opens a PHI window makes `schedule_pasada`/`replan_pasada` raise `check_violation` for a pick before `phi_clears_on`; clears after | PGlite db-test (EXISTS — extend) |
| `qc-hold-blocks-commerce` (db) | an open `qc_holds` row makes a `lot_reservations` AND `lot_shipments` insert raise; `release_qc_hold` re-opens both | PGlite db-test (EXISTS — extend) |
| `reposo-blocks-mill` (db) | a not-rest-stable lot makes `advance_processing_stage` to milled/green raise on BOTH the RPC and a direct `update lots set stage` (backstop) | PGlite db-test (EXISTS — extend) |
| `guard-status-mappers` (unit) | each `mapXToGuard` sets `blocked` strictly from the view boolean and produces the es-PA `reason` | unit |
| `guard-error-agrees-with-badge` (unit) | for each guard, the migration's raised gate message → `guardError()` → the same copy family as the badge `reason` | unit (string-contract) |
| `guard-message-prefix-stable` (static/db) | each gate still raises with its `pasada gate:` / `qc-hold:` / `reposo gate:` prefix (the friendly-mapping contract) | static grep over migrations + a db raise-capture |
| `<GuardBadge>`/`<GuardBanner>` render | given a `blocked` status, renders the danger tone, the reason text, an `aria-label` naming the blocked action, and a dossier `<a href>` | jsdom render |
| `<GuardBlock>` courtesy-only | wrapping a control with a blocked guard disables it AND a same-test asserts the DB gate exists for that action (no UI-only block) | jsdom + a static map check |

---

## 7. Invariants every DELIVER slice in this facet obeys

1. **One source per guard.** A badge/banner/block reads the guard's derived VIEW boolean, never
   recomputes "blocked" from raw evidence. (facet-01 invariant #1.)
2. **The DB gate is the real teeth; the UI block is courtesy.** Never ship a `<GuardBlock>` whose
   wrapped action lacks a fail-closed DB gate. Never weaken a gate to make a UI flow pass.
3. **Reactive-on-read, $0.** A new spray/hold/moisture row flips the badge on the next RSC render
   under `force-dynamic`. No Realtime, no polling, no refresh (these are plain `security_invoker`
   views, not matviews — facet-01 invariant #2). The write action's `revalidatePath` set MUST cover
   every tab the guard appears on (PHI: `/scouting,/plan,/map,/satellite,/plots/[id]`; QC:
   `/qc,/inventory,/dispatch,/lots/[code]`; reposo: `/drying,/processing,/lots/[code]`).
4. **One copy, two places.** The badge `reason` and the `guardError()` sentence for the same guard
   come from the same family (the §6 string-contract test enforces it).
5. **Fail-closed reach, never over-block.** A guard view that INNER-joins evidence (e.g.
   `v_plot_phi_status` only has rows for sprayed plots) never flags an un-sprayed plot — the badge
   simply doesn't render. Preserve that: `getXGuards()` filters to `blocked` only.
6. **Every guard chip is a drill-in.** A `<GuardBadge>` is wrapped in a dossier `<Link>` — a guard
   surface is itself connective (PRINCIPLE Rule 3), never dead UI.
7. **es-PA-first, glove-friendly, AA-on-aurora.** Reuse `ReposoGateChip`'s darkened-text contrast
   fix for the danger tone on the translucent background.

---

## 8. What this facet consumes from / hands to other facets

- **From facet-01 (reactive graph):** the propagation contract — guards are reactive-on-read views;
  the per-event `revalidatePath` sets for `log_spray`, `place_qc_hold`/`release_qc_hold`,
  `record_moisture_reading`/`advance_processing_stage`. This facet does NOT add any matview/refresh
  edge.
- **To facet-02 (dossiers):** `<GuardBanner>` + `<GuardBadge>` and the `getXGuards()` +
  `xGuardForY()` lookups, so `/plots/[id]` (PHI), `/lots/[code]` (QC + reposo) render their guard
  state at the top of the dossier from one prop. Dossiers pass the lookups into their entity rows.
- **To facet-03 (smart-bar wiring):** the `<GuardBlock>` primitive for any "Reserve" / "Schedule" /
  "Advance to mill" CTA the smart-bar wires — the courtesy-disabled state that mirrors the gate.
- **To the Map dead-click fix:** once the polygon links `/plots/[id]`, the plot popup carries
  `phiGuardForPlot(...)` so PHI is visible at the geometry level too.

---

## 9. Open questions for Andres (DESIGN must resolve before DELIVER)

1. **Migrate the 3 bespoke widgets, or wrap them?** Recommended: **migrate** `PhiChips` /
   `QcHoldBanner` / `ReposoGateChip` to thin re-exports over the new `<GuardBadge>`/`<GuardBanner>`
   family (one shared component, three guard kinds) — keeps their tests, removes drift. Their home
   tabs render unchanged; the new tabs reuse the same component.
2. **`<GuardBlock>` scope.** Confirm the 3 existing courtesy STUBs (Drying "Mill", Inventory "Sold
   out" / "no vendible", Processing advance) become live `<GuardBlock>`s reading the guard view
   (vs. staying hardcoded-disabled). Recommended: yes — it makes the disabled state *honest*
   (driven by the live guard), satisfying DISCUSS OQ-5 without changing the teeth.
3. **Moisture-threshold flag granularity.** The J3 ask is "moisture threshold → Drying flag." Read
   it off `v_reposo_status.moisture_stable` (the band check the gate already uses) rather than a new
   per-reading threshold view? Recommended: yes — reuse the gate's own band, one source.
4. **Guard message prefixes as a contract.** Confirm we lock the `pasada gate:` / `qc-hold:` /
   `reposo gate:` raised-message prefixes as a tested contract (so `guardError()` stays correct
   across future migration edits). Recommended: yes — the §6 `guard-message-prefix-stable` test.
5. **Where does the reposo getter live?** The PHI + QC getters are in `remote-sensing.ts` /
   `qc.ts`; confirm the reposo guard reads the existing `getReposoStatuses` (`v_reposo_status`) in
   `src/lib/db/drying.ts` (vs. adding a new one). Recommended: reuse `drying.ts` — no new getter.
