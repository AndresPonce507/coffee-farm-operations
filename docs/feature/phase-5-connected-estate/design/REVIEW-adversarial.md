# Phase 5 · DESIGN — Adversarial Review of ARCHITECTURE.md + 5 facets

> Read-only adversarial pass against `PRINCIPLE.md`. Every finding below was verified against the live
> code at `/Users/andres/coffee-farm-operations-worktrees/phase1-deliver` (branch `main`) this session.
> Severity: **CRIT** (would ship a stale number / dead UI / clobber the fleet) · **HIGH** (a slice
> lands wrong or a guard goes dead) · **MED** (coherence drift, fixable cheaply) · **LOW** (nit).

---

## CRIT-1 — `disbursement` writes a `cost_entry` (matview input) but the design never refreshes `mv_lot_cost` → `/costing` shows a STALE cost-per-kg

**This is a real reactive-propagation gap the design codifies instead of catching — it directly violates the architecture's own invariant #2.**

Verified:
- `record_disbursement` (`supabase/migrations/20260622108000_payroll.sql:897`) "Write the COGS
  cost_entry + the disbursement TOGETHER" — a disbursement **inserts a `cost_entry` row**.
- `cost_entry` feeds `mv_lot_cost` / `mv_lot_cost_by_rule` (matviews, `20260621094000_costing.sql`).
- There is **no AFTER-INSERT trigger** on `cost_entry` that refreshes the matview — the only refresh
  is the explicit `refresh_lot_cost()` on the write path (grep over all migrations: the function is
  defined once at `20260621094000_costing.sql:283` and only `costing/actions.ts:180` + inventory call it).
- `record_disbursement` migration does **NOT** call `refresh_lot_cost`. `recordDisbursementAction`
  (`payroll/actions.ts:104`) only does `revalidatePath("/costing")`.

ARCHITECTURE.md §5 sets `RIPPLE["disbursement"] = ["/payroll","/costing"]` — a route list only. By
its **own invariant #2** ("Read `mv_lot_cost*` → the write **must** call `refresh_lot_cost()`"), the
disbursement kind is a contract violation: `/costing` is revalidated (RSC re-renders) but the matview
it reads was never refreshed, so the cost-per-kg-green is stale until some *unrelated* cost write
refreshes it. This is the exact "wrong/missing auto-ripple" failure PRINCIPLE Rule 3 forbids
("updates every downstream number … with zero re-entry").

**Why the design misses it:** facet-01 §2.3 OQ1 correctly excludes COGS from the *weigh* ripple
(cherry weigh moves no green-kg) and that reasoning is sound — but the team then treated "payroll IS
labor COGS" as merely a `revalidatePath("/costing")` concern (facet-03 §4.1 comment "payroll IS labor
COGS") and never carried it to the matview-refresh half. The `reactiveRefresh` SSOT only knows about
routes; it has no concept of "this kind also needs `refresh_lot_cost()`."

**Fix:**
1. `recordDisbursementAction` (and `computePayPeriod`/`approvePayLine` if any of them book/settle a
   `cost_entry` — check each) MUST `await sb.rpc("refresh_lot_cost")` before `revalidateRefresh`,
   mirroring `costing/actions.ts:180`. Lands as an L0/L1 fix, not buried in L3.
2. Make `reactiveRefresh` matview-aware so the contract can't be silently dropped: tag the
   matview-touching kinds (`cost-entry`, `disbursement`, and any green-kg/edge mutator) in the
   `RIPPLE` SSOT (e.g. `RIPPLE_MATVIEW: Set<Kind>`), and have `reactiveRefresh(kind)` refuse/refresh
   accordingly — OR add an F-A guard test `matview-kinds-refresh.test.ts` asserting every action whose
   kind is in `RIPPLE_MATVIEW` calls `refresh_lot_cost`. Today nothing prevents the next money-path
   author from repeating this omission. (This is also a bug-fix → it needs a regression test that
   FAILS on the current `record_disbursement` path per the global "bug → regression test same commit".)
3. Flag to Andres: this is a **pre-existing** prod hole, not introduced by Phase 5 — but Phase 5 is
   the wave that promises "everything connects," so it must be closed here, not flagged-and-left.

---

## CRIT-2 — The `no-mock-reads` guard's stated target is FACTUALLY WRONG; a third live `@/lib/data` import means the guard stays RED after US-02 (or is written to silently miss it)

ARCHITECTURE.md line 23 asserts: "**the mock leak is exactly `sections/workers/{worker-form,crew-board}.tsx`**" and §10.3 / facet-05 §8 say the `no-mock-reads` grep "flips green when US-02 lands."

Verified false. `grep -rn "@/lib/data/" src --include=*.ts --include=*.tsx` (excluding tests + the
`src/lib/data/` dir itself) returns **three** production importers:
- `src/components/sections/workers/crew-board.tsx:13` — `CREWS` (US-02 covers this)
- `src/components/sections/workers/worker-form.tsx:7` — `CREWS` (US-02 covers this)
- **`src/lib/geo/seed-geometry.ts:11`** — `import { plots as PLOTS } from "@/lib/data/plots"` (US-02
  does NOT cover this).

Consequence — a fork in the road, both bad:
- If `no-mock-reads` is the literal grep the design specifies (`from '@/lib/data/'` over non-test
  `src/`), it will **stay RED after US-02 lands** because of `seed-geometry.ts`, blocking GATE-3 with
  no assigned owner to fix it.
- If an author "fixes" the red by narrowing the grep to `sections/`, the guard goes **dead for the
  rest of `src/`** — a future RSC that imports `@/lib/data/plots` slips through. That is exactly the
  "a dead guard is itself an incident" failure (global Rule 5, cited in §10.3's own guardrail note).

**Nuance:** `seed-geometry.ts` is a *build/seed-time* module (feeds `scripts/gen-seed.ts` and a
migration data fix-up — header lines 1-9), not a runtime RSC read, so it is arguably a legitimate
mock read, not a "production read path" leak. **But the design must say so explicitly and the guard
must encode the carve-out**, not pretend the file doesn't exist.

**Fix:** (a) Correct line 23 + facet-05 §8 to name all three importers. (b) Specify the
`no-mock-reads` guard as: zero `@/lib/data/` imports under `src/app/**`, `src/components/**`, and
`src/lib/db/**` (the runtime read surfaces), with `src/lib/geo/seed-geometry.ts` an **explicitly
allow-listed** seed-time exception (one named entry, asserted to still exist so the exception can't
rot). (c) Add a positive assertion that the guard actually *matches something* if the allowlist entry
is removed, so it can't go dead.

---

## CRIT-3 — `src/lib/revalidate.ts` marked `"use server"` cannot export a non-async `const RIPPLE` object or a synchronous `reactiveRefresh` — the contract file will fail to compile/run as written

facet-03 §4.1 writes the SSOT file with a top-of-file `"use server";` directive, then exports
`export const RIPPLE: Record<string, readonly string[]> = {…}` (a plain object) and a **synchronous**
`export function reactiveRefresh(kind) {…}`. Next.js's `"use server"` module contract requires **all
exports to be async functions** — a `"use server"` file may not export a plain object/const, and its
functions must be async. This is the single most-imported contract file in the phase (every L3
EDIT/CREATE action + L0). If F-A/slice-01 author it verbatim, it either throws at build or every
importer breaks.

ARCHITECTURE.md §5's code block (lines 202-216) **drops** the `"use server"` directive — so the two
authoritative documents disagree on the one detail that determines whether the file works, and §5
never calls out the conflict.

**Fix:** Pin the decision in ARCHITECTURE.md: `src/lib/revalidate.ts` is a **plain module** (NO
`"use server"`), exporting `RIPPLE` (const) + `reactiveRefresh` (sync, calls `revalidatePath` which is
itself callable from a Server Action's synchronous body). `revalidatePath` is imported from
`next/cache` and used inside server actions — it does not require the helper module to be a server-
action module. Add a one-line REVIEWER-1 check: "`revalidate.ts` has no `"use server"` directive."
(Verified the existing precedent: `weigh/actions.ts` is `"use server"` and imports `revalidatePath`
directly — the helper need not be.)

---

## HIGH-1 — `/pay-period/[id]` dossier route has NO matching board/index and the param-id source is unconfirmed → high risk of an unreachable dossier or a 404-on-valid-id

Verified: there is **no `/pay-period` route** under `src/app/(app)/` (the pay surface is `/payroll`).
The five facets + ARCHITECTURE.md §3.1 route the Pay-period dossier at `/pay-period/[id]`, and
`entityHref.payPeriod` / `RIPPLE` reference it. Two problems:

1. **Reachability (PRINCIPLE Rule 3 "every entity → reachable dossier"):** nothing in L3 is assigned
   to emit `EntityLink kind="pay-period"` from the `/payroll` board — the L3 table (facet-05 §6.1) has
   **no payroll row at all**. The Worker dossier's "Por-obra pay" section links to it (facet-02 §5),
   but if the worker dossier is the *only* inbound link, the pay-period dossier is reachable only via a
   worker, and the `/payroll` board's own period rows (the obvious entry point) stay dead-end COSMETIC.
   That is a dossier "with no reachable link" from its home tab.
2. **Param id (C8 is unresolved, not resolved):** ARCHITECTURE.md C8 says "confirm `getPayPeriods()`
   exposes the same id used in the `/pay-period/[id]` link" — and then lists C8 as a *resolution*. It
   is not resolved; it is a deferred TODO ("Resolve before L2-dispatch/payperiod start"). A dossier
   whose anchor getter (`getPayPeriodById(id)`) keys on an id the board doesn't surface will `notFound()`
   on every real click.

**Fix:** (a) Add an L3 `payroll` cluster row: each `/payroll` period row → `EntityLink
kind="pay-period" id={period.id}`. (b) Before L2-payperiod starts, pin the id: confirm
`getPayPeriods()` row key === `getWorkerPayForPeriod(id)` param === the `/pay-period/[id]` segment
(one verified value, cited in the design, not a "confirm later"). Same check for dispatch (C8 first
half) — `v_dispatch_card.id` numeric vs string param.

---

## HIGH-2 — PHI badge "drill to the spray that set it" has no real anchor target → a smart-bar DRILL that falls through (PRINCIPLE acceptance test = defect)

facet-02 §5 (Plot dossier, Satellite/PHI row) and facet-04 §4.1 specify the PHI chip links
"the originating **spray** (`/scouting#spray-<id>`)" / "PHI chip links the spray that set it
(`/scouting`)". Verified: `src/components/sections/scouting/*` has **no `id="spray-<id>"` anchors**
and the design provides no mechanism to render per-spray anchors on `/scouting`. So the DRILL target
`/scouting#spray-<id>` resolves to `/scouting` with a dead hash — the user clicks "PHI until
2026-07-02 →" and lands on the scouting tab with no scroll, no highlighted record. Under the
PRINCIPLE acceptance test ("what happens when I click this, and where does that data go?") the honest
answer is "nothing specific" → defect.

facet-04 also hedges between `/scouting#spray-<id>` (§4.1) and a bare `/scouting` (the same table) —
the two facets don't agree on whether the anchor is real.

**Fix:** EITHER (a) make it real — L3-scouting adds `id={`spray-${id}`}` + `scroll-mt` to each spray
row (cheap, one cluster) and `v_plot_phi_status` must expose the originating spray id so the badge can
build the anchor; OR (b) downgrade the DRILL to NAVIGATE-to-tab `/scouting` and drop the `#spray-<id>`
claim everywhere. Pick one and pin it; don't ship a `#anchor` that doesn't exist.

---

## HIGH-3 — `entityHref` shape conflict (C1) is "resolved" in prose but the two facets still ship two DIFFERENT, incompatible signatures — a 100-agent footgun if not pinned harder

C1 resolves the *location* (`src/lib/dossier/entity-href.ts`, not inline in `entity-link.tsx`). But
the two facets define `entityHref` with **different types and behavior**, and ARCHITECTURE.md never
reconciles which one wins:

- facet-02 §5: `entityHref = { lot: (code) => `/lots/${code}`, …, dispatch: (id: string|number) => …,
  payPeriod: (id) => … }` — **camelCase keys** (`payPeriod`), `dispatch` accepts `number`, **no
  `encodeURIComponent`**.
- facet-03 §1.3: `entityHref: Record<EntityKind, (id: string) => string>` — **kebab key**
  (`"pay-period"`), all params `string`, **wraps every id in `encodeURIComponent`**.

These are not the same object. A dossier author importing facet-02's shape writes
`entityHref.payPeriod(id)`; an L3 author following facet-03 writes `entityHref["pay-period"](id)` — one
of them throws `undefined is not a function` at runtime, and the no-dead-ui guard won't catch a
*wrong-key* link. The `dispatch: string|number` divergence also means the numeric `v_dispatch_card.id`
coercion (C8) lands or doesn't depending on which shape F-B picks.

**Fix:** ARCHITECTURE.md must publish the **one canonical signature** (verbatim TS) F-B builds — keys,
param types, and whether `encodeURIComponent` is applied (recommend: kebab keys to match `EntityKind`
+ `DossierKind`, all params `string`, `dispatch`/`payPeriod` coerce at call site, **encode ids**
because lot codes contain `/`-safe but worker/crew ids may not). REVIEWER-1 must diff the merged file
against this block, not just assert "one file exists."

---

## HIGH-4 — `getCrews()` (the US-02 mock-kill target) is unbuilt AND its owner is double-assigned; the people.ts single-author rule (C5) doesn't actually cover it

Verified `getCrews` does **not** exist in `src/lib/db/` (only `getCrewRoster` does). US-02 (kill the
`CREWS` mock) depends on it. ARCHITECTURE.md C5 assigns `people.ts` to "L2-worker (hosts worker
getters + `getCrewById` + `getCrews()`)". But:
- The US-02 work lives in **L3-workers-mock** (facet-05 §6.1, last row), which runs in L3 — *after*
  L2. So L3-workers-mock imports `getCrews()` from a file authored by an L2 agent. Fine in principle,
  but facet-05 §6.2 says "assign it to the L2-crew/`people.ts` author" while C5 says **L2-worker** owns
  `people.ts`. **The two documents name different owners** (L2-crew vs L2-worker) for the same file.
  A 100-agent fleet with two docs naming two owners for `people.ts` = the exact clobber C5 exists to
  prevent.

**Fix:** ARCHITECTURE.md C5 already says L2-worker; delete the contradicting "L2-crew" assignment in
facet-05 §6.2, and explicitly list `getCrews()` (not just `getCrewById`) in L2-worker's deliverables
so it exists before L3-workers-mock dispatches. Add the L2→L3 dependency edge (L3-workers-mock waits
on L2-worker's `people.ts`, same as plot-row links wait on L2-plot).

---

## MED-1 — The `/scouting` "disabled applicator (cert gate)" STUB is a 4th intentional STUB, but the design repeatedly says "3 STUBs" and only enumerates Drying/Inventory/Processing

The audit (`wire-up-audit.md:58`) lists **three** intentional STUBs: Drying "Mill — locked",
Inventory "Sold out" reserve, **and** "the disabled-applicator option in Scouting (cert gate)."
ARCHITECTURE.md §6.3 / §10.2 / facet-04 §3.3 / facet-05 §6 enumerate the three as Drying + Inventory
"Sold out"/"no vendible" + **Processing advance** — i.e. they **substitute "Processing advance" for
"Scouting applicator"** and call the reposo/Processing one a STUB even though §4.3 treats the
Processing "Advance to mill" as a *live `<GuardBlock>` migration target*, not a preserved STUB.

Net: the "preserve exactly 3 STUBs" reviewer check (REVIEWER-3, GATE-3) is mis-specified — it will
either (a) wrongly flag the Scouting cert-gate STUB as an un-wired COSMETIC and a fix-agent will
"wire" a courtesy control that has no `<GuardBlock>` guard kind (there is no cert guard in the
GuardKind union — it's `"phi"|"qc-hold"|"reposo"` only), or (b) leave the Processing advance as a
hardcoded STUB when §4.3 wants it converted to a live `<GuardBlock>`.

**Fix:** Enumerate the **real** 3 STUBs from the audit (Drying-Mill, Inventory-SoldOut,
Scouting-applicator-cert) as the preserved set; classify the Processing "Advance to mill" as a
**convert-to-`<GuardBlock action="advance-to-mill">`** item (not a preserved STUB). Note that the
Scouting cert STUB has **no GuardKind** — either add a `"cert"` guard kind + mapper or explicitly
document it stays a hardcoded courtesy STUB (flag-don't-fix), so a fix-agent doesn't try to wire it.

---

## MED-2 — Existing orphan dossiers `/ferment/[batch]` and `/qc/cup/[lot]` have NO test files; the design's "wire-in only" treatment skips the per-dossier `notFound()` guard for them

Verified: `/lots/[code]/__tests__/page.test.tsx` exists, but `/ferment/[batch]` and `/qc/cup/[lot]`
have **no `__tests__`**. ARCHITECTURE.md §10.3 lists "per-dossier `notFound()`" as an L2 guard
"authored in L2", but L2 only builds the *5 new* dossiers; the 3 existing ones are "wire-in only"
(§3.1) and get no test assignment. So three of the seven dossiers never get the 404-on-unknown-id
regression test the KPI demands, and the FINAL audit's "every dossier 404s" claim is unverified for
half the existing ones. Also violates the repo's "every PR ships a test" rule if any of the wire-in
PRs touch them.

**Fix:** Add an L2 (or L2-orphan-wire) task: author `notFound()` behavior tests for `/ferment/[batch]`
and `/qc/cup/[lot]` (mirroring `lots/[code]/__tests__/page.test.tsx`) when they're wired in, so all 7
dossiers carry the guard. Cheap, file-disjoint.

---

## MED-3 — Two `RIPPLE["weigh-in"]` route sets in the doc set; the `/crew` inclusion is unexplained against invariant #5

C3 resolves the COGS half (drop `/costing`,`/inventory`), landing on
`["/weigh","/","/harvests","/crew"]` = the live `weigh/actions.ts:85-88` set (verified exact). Good.
But facet-03 §4.1 still shows the OLD set `["/weigh","/","/harvests","/costing","/inventory"]` in its
code block, unannotated — a reader who opens facet-03 first copies the wrong set. And `/crew` is in
the set with no stated consumer: invariant #5 says "revalidate every tab whose RSC reads a view the
write moved" — what does a weigh-in move on `/crew`? (Plausibly the crew roster's per-picker kg, but
the design never names the view, so an over-broad revalidate can't be distinguished from a correct
one, and the `ripple-routes-exist` guard only checks the route *exists*, not that it reads a moved
view.)

**Fix:** (a) Annotate/strike the stale set in facet-03 §4.1 to point at C3. (b) Document the `/crew`
consumer view (the crew-board getter that reads `v_weigh_today_by_*`) so the inclusion is justified,
or drop it. Consider strengthening `ripple-routes-exist` toward "every route reads a named view from
the kind's consumer list" (harder; at least document the mapping).

---

## MED-4 — `<GuardBlock>` is specced as a Server Component family but must intercept a submit (client) — facet-04 is internally inconsistent about its render boundary

facet-04 §3 opens "All Server Components (no hooks) except `<GuardBlock>`'s disabled-submit variant",
then §3.3 says `<GuardBlock>` "clones [the child] with disabled + aria-describedby" and "the submit is
intercepted (no-op + focus the badge)" — intercepting a submit and managing focus requires a client
component + an event handler, but the prop contract shows no `"use client"` and the family is imported
into Server-Component dossiers (§6.1 "render `<GuardBanner>` at top"). Mixing a client `<GuardBlock>`
into an RSC dossier is fine, but the contract must say which file is `"use client"`, or F-D ships a
Server Component that can't intercept and the "courtesy block" silently does nothing (the DB gate
still catches it, so it's not a security hole — but it IS a dead courtesy affordance: the button looks
enabled, the user clicks, nothing visible happens until the server round-trips the gate error → a
worse UX than the honest disabled state the STUBs give today). That's a PRINCIPLE Rule 1 "feels dead"
regression for the 3 STUBs being "upgraded."

**Fix:** Pin `<GuardBlock>` as `"use client"` (it owns interception/focus), keep `<GuardBadge>` /
`<GuardBanner>` as Server Components, and state it in §6.1 + the F-D deliverable list. Add a render
test asserting a blocked `<GuardBlock>` actually disables the child AND prevents the submit handler
from firing (not just renders `disabled`).

---

## LOW-1 — `command-palette` orphan-jump for batch/cup uses pattern-matching but cup/ferment ids are UUIDs the owner cannot type; the "⌘K reaches all orphans" claim is overstated

facet-02 §6 / §3.4 lean on ⌘K as one of two orphan-reachability mechanisms, extending `results` to
emit batch (UUID input) + cup destinations. But `/ferment/[batch]` keys on a UUID and `/qc/cup/[lot]`
on a green-lot code; a human will type a lot code, never a ferment UUID. So in practice ⌘K reaches
*lots and cups* but not *batches* by human input — the batch orphan is reachable only via inline
row-links (the §3.4 mechanism #2). That's fine, but the design should not count ⌘K as a real
batch-reachability path (it satisfies the KPI only via row-links). Minor: state that batch
reachability is row-link-only; ⌘K covers lot + cup.

---

## LOW-2 — `getPlotById` keys on `plots_view.id`; L3 plot-row NAVIGATE must pass `plot.id`, not `plot.name`/block — one wrong field = mass 404

Verified `getPlotById` does `.eq("id", id)` (`plots.ts:57`) and `Plot` has both `id` and `name`. Many
plot surfaces display the *name* ("Tizingal-Alto"). If an L3 author writes `EntityLink kind="plot"
id={plot.name}`, every plot dossier 404s. The design never states the id discipline for the ~30+
plot-row NAVIGATE sites (Dashboard, Plots, Map, Plan, QC, EUDR all link to plot). With 100 agents this
WILL be gotten wrong somewhere and the no-dead-ui guard won't catch a 404-on-valid-looking-link.

**Fix:** One line in §4 / facet-03 §3.3: `EntityLink kind="plot"` ALWAYS receives `plot.id` (the
`plots_view.id`), never name/block. Add it to the REVIEWER-3 per-tab checklist for every plot cluster,
and consider a behavior test in L2-plot that `getPlotById(name)` returns undefined (proving id≠name).

---

## What I checked and found SOUND (no gap)

- **DEAD/MOCK/STUB census (1/6/3):** the raw grep over the audit shows inflated counts (7 DEAD, 8
  STUB) but those are legend + per-tab-header rows; the audit's authoritative totals line
  (`wire-up-audit.md:47`) reads "DEAD 1 · MOCK-DATA 6 (1 source: CREWS) · STUB 3" — ARCHITECTURE.md is
  consistent with it. **Not a gap.** (The STUB *identity* mismatch is MED-1, separate.)
- **`force-dynamic`** at `layout.tsx:7` ✓; **weigh revalidate block** `weigh/actions.ts:85-88` ✓
  (exactly `/weigh,/harvests,/crew,/`); **`ActionState` shape** `plots.ts:9` ✓ (`SmartActionState` IS
  a strict superset — C4 holds); **3 orphan dossier routes exist** ✓; **`entity-href.ts` does NOT yet
  exist** ✓ (no migration of imports). All as ARCHITECTURE.md claims.
- **All cited getters exist** except the correctly-NEW-marked ones (`getCrews` excepted — HIGH-4):
  `getPlotById/getHarvests/getPlotCost/getWorkers/getCrewRoster/getDispatchToday/getPayPeriods/
  getWorkerPayForPeriod/getPlotPhiStatus/getQcStatus/getReposoStatuses/getWeighTodayByPicker/
  getDisbursementsForPeriod` ✓, and the worker-dossier getters `getWorkerAttendanceTimeline/
  getWorkerPorObraHistory/getWorkerCertsValid` already exist ✓.
- **Route collisions:** `/crew/[id]` and `/dispatch/[id]` are safe new dynamic children of existing
  index pages (Next.js allows `page.tsx` + `[id]/page.tsx` siblings) — no clobber. ✓
- **Schema lane:** Phase 5 is genuinely schema-free for the dossier/wiring work; the new getters are
  read-only `src/lib/db/*` filters over existing views. S-LANE idle is correct. ✓ **Caveat:** the
  CRIT-1 fix is an *action-layer* `rpc("refresh_lot_cost")` call, not a migration, so it does NOT break
  the single-schema-author guarantee. (If anyone instead "fixes" CRIT-1 by adding an AFTER-INSERT
  trigger on `cost_entry` in a migration, that MUST go through S-LANE, single author, timestamp >
  applied max — flag this so a fix-agent doesn't ship a migration in its own branch.)
- **$0 / offline / no-Realtime / one-write-door** invariants are respected throughout. ✓

---

## Severity roll-up

| # | Sev | One-line | Fix owner |
|---|---|---|---|
| CRIT-1 | CRIT | disbursement books `cost_entry` but never `refresh_lot_cost()` → stale `/costing` | L0/L1 action fix + F-A matview-aware guard + regression test |
| CRIT-2 | CRIT | `no-mock-reads` target wrong (3rd importer `seed-geometry.ts`) → guard stays red or goes dead | F-B (guard spec + allowlist) |
| CRIT-3 | CRIT | `revalidate.ts` `"use server"` can't export const/sync → contract file breaks | F-A + ARCHITECTURE.md pin |
| HIGH-1 | HIGH | `/pay-period/[id]` has no board link + unconfirmed param id → unreachable / 404-on-valid | add L3 payroll cluster + pin id before L2-payperiod |
| HIGH-2 | HIGH | PHI `#spray-<id>` DRILL anchor doesn't exist → fall-through click | L3-scouting anchors OR downgrade to NAVIGATE |
| HIGH-3 | HIGH | two incompatible `entityHref` signatures (camel vs kebab, encode vs not) | ARCHITECTURE.md publishes one canonical TS block; REVIEWER-1 diffs it |
| HIGH-4 | HIGH | `getCrews()` unbuilt + double-owned (`people.ts` L2-worker vs L2-crew) | pin L2-worker owns `people.ts` incl. `getCrews()`; add L2→L3 edge |
| MED-1 | MED | "3 STUBs" enumerated wrong (swaps Scouting-cert for Processing); no cert GuardKind | re-enumerate real STUBs; classify Processing as convert-to-GuardBlock |
| MED-2 | MED | `/ferment/[batch]` + `/qc/cup/[lot]` have no `notFound()` tests | add wire-in behavior tests |
| MED-3 | MED | stale `weigh-in` route set in facet-03 §4.1; `/crew` consumer undocumented | annotate to C3; name the `/crew` view |
| MED-4 | MED | `<GuardBlock>` Server/Client boundary undefined → dead courtesy block | pin `"use client"` + interception render test |
| LOW-1 | LOW | ⌘K can't reach batch orphans (UUID) — claim overstated | scope ⌘K to lot+cup; batch is row-link-only |
| LOW-2 | LOW | plot NAVIGATE must use `plot.id` not name → mass-404 risk | one-line id discipline + REVIEWER-3 check |

**Two CRIT items (CRIT-1 stale-COGS, CRIT-3 broken-contract-file) and CRIT-2 (dead/red guard) block a
clean L1 freeze and must be fixed in the ARCHITECTURE.md/L1 contract before the 100-wide fan-out
imports them.** The rest land as L1/L2/L3 ticket corrections.
