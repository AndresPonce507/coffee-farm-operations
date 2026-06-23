# Design · Facet 01 — The Reactive-Propagation Architecture (J1 spine)

> How one field event auto-ripples to EVERY downstream consumer with ZERO re-entry.
> Grounded in the real code at `/Users/andres/coffee-farm-operations-worktrees/phase1-deliver`
> (branch `main`). Cites actual migrations / RPCs / views / getters / Server Actions.
> Walking skeleton = slice-01 (`discuss/slices/slice-01-weigh-ripple-proof.md`).

---

## 0. TL;DR — the propagation contract in one paragraph

The reactive graph **already exists and is correct**. A write goes through ONE
SECURITY-DEFINER command RPC (`record_weigh_in`, `record_cherry_intake`, `bookCostEntry`'s
`cost_entry` insert, …). That single append fans out **inside the database** via two
mechanisms: (a) **`security_invoker` views** that re-derive on every read from the append-only
truth (`weigh_event`, `harvests`, `cost_entry`, `spray_application`, `qc_hold`) — these are
*reactive-on-read*, nothing to refresh; and (b) **two earned materialized views** (`mv_lot_cost`,
`mv_lot_cost_by_rule`) that must be explicitly refreshed via `refresh_lot_cost()` **on the write
path**. The UI layer is `dynamic = "force-dynamic"` (`src/app/(app)/layout.tsx:7`), so **every RSC
page render reads live** — propagation to a Server Component is automatic on navigation/refresh.
The only client-side seam is `revalidatePath()` in the Server Action, which busts the Next.js
**client router cache** so a navigation after a write shows fresh data without a hard reload.
Phase 5 adds **nothing** to this spine for the walking skeleton — it adds a *visible proof panel*
that names the consumers a capture just updated and links each. The J1 work is **surfacing** the
existing ripple, not building new propagation.

---

## 1. The existing mechanism — what is reactive, and how

### 1.1 The truth layer (append-only, hash-chained)

| Truth table | Migration | Written by | Immutability |
|---|---|---|---|
| `weigh_event` | `20260622102000_weigh_capture.sql` | `record_weigh_in` | BEFORE UPDATE/DELETE block trigger + force-RLS + no write grant |
| `harvests` | phase-1 + grown by `record_weigh_in` / `record_cherry_intake` | minter | CHECK `cherries_kg > 0` |
| `lots` (`origin_kg`/`current_kg`) | phase-1 | `record_weigh_in` UPDATE | stage machine |
| `cost_entry` | `20260621094000_costing.sql` | `bookCostEntry` insert | `cost_entry_immutable()` BEFORE UPDATE/DELETE |
| `spray_application` | `20260622106000_remote_sensing_ipm.sql` | `log_spray` | — |
| `qc_hold` | `20260622096000_qc_cupping.sql` | `place_qc_hold`/`release_qc_hold` | — |

These rows are the SSOT. Every number anywhere in the app is a *projection* of them. This is why
"enter once" works: there is exactly one place the kg lives (`weigh_event.kg`), and every consumer
is a `SELECT` over it.

### 1.2 Reactive-on-READ — `security_invoker` views (the majority case)

These **never need a refresh**. They are plain views; the planner re-runs the aggregate every time
a getter selects from them, under the caller's RLS. A new truth row is visible to the next read,
full stop. The J1-relevant set:

| View | Migration | Derives | Read by getter |
|---|---|---|---|
| `v_weigh_today_by_picker` | `20260622102000` | per-picker today kg + lata count | `getWeighTodayByPicker` (`src/lib/db/weigh.ts`) |
| `v_weigh_today_by_plot` | `20260622102000` | per-plot today kg | `getWeighTodayByPlot` |
| `v_weigh_by_lot` | `20260622102000` | Σ kg per lot (mill-intake) | `getWeighByLot` |
| `v_lot_weigh_reconciliation` | `20260622102000` | Σ weigh kg == `lots.origin_kg` | (reconcile signal) |
| `season_summary_view` | `20260621093000_derived_metrics.sql` | `target_kg` from `farm_season_config` + `harvested_kg`/`today_kg` Σ'd from `harvests` | `getSeason` (`src/lib/db/trends.ts:76`) |
| `daily_cherries_view`, `weekly_harvest_view`, `variety_shares_view` | `20260620170000` + `…093000` | trend/variety aggregates from `harvests` | `getDailyCherries`/`getWeeklyHarvest`/`getVarietyShares` |
| `v_plot_phi_status` | `20260622106000` | PHI clears-on per plot from `spray_application` | (Facet: PHI) |

**Key correctness fact (registry checkpoint #2):** `season_summary_view` sums `today_kg` from
`harvests WHERE date = max(date)`. `record_weigh_in` writes a `harvests` row for every weigh-in
(the minter writes the origin harvest; subsequent weigh-ins of the same plot/day INSERT a
per-picker `harvests` row — `20260622102000` lines 320-334). **Therefore a weigh-in raises both
`v_weigh_today_by_picker.kg_today` AND `season_summary_view.today_kg` from the SAME append** — no
second write, no re-entry. This is the entire walking-skeleton ripple, and it is already wired.

The deprecated hand-authored aggregates (`daily_cherries__deprecated`, `season_summary__deprecated`,
…) were renamed aside in `…093000` precisely so a getter that pointed at a stale aggregate fails
loud instead of silently disagreeing. **Propagation contract rule: no consumer may read a
`*__deprecated` relation.**

### 1.3 Reactive-on-REFRESH — the two earned materialized views

`mv_lot_cost` and `mv_lot_cost_by_rule` (`20260621094000_costing.sql`) cache a recursive walk DOWN
`lot_edges` apportioning each `cost_entry` over green-kg. A matview does **not** re-derive on read —
it must be refreshed. The seam is `refresh_lot_cost()` (SECURITY DEFINER, plain `REFRESH` — NOT
`CONCURRENTLY`, because PostgREST wraps each RPC in a txn and concurrent-refresh is illegal in a
txn; `…094000.sql` header + lines 283-291).

**Who must call it:** every write that changes a cost-relevant input. Today the canonical caller is
`bookCostEntry` (`src/app/(app)/costing/actions.ts:180`) and `inventory/actions.ts`. **This is the
one fragile edge of the graph** (registry `lot_cost_per_kg`, integration_risk MEDIUM): if a future
write path that changes green-kg or cost forgets to refresh, the dossier shows a stale cost.

### 1.4 The UI freshness layer — `force-dynamic` + `revalidatePath`

- `src/app/(app)/layout.tsx:7` → `export const dynamic = "force-dynamic"`. Every page under
  `(app)/` is rendered per request; RSC getters (`cache()`'d only for **request-scoped**
  dedup via `react`'s `cache`) read live each navigation. **There is no ISR / fetch-cache to
  invalidate** — so propagation to any *other tab* is automatic the moment the owner navigates there.
- `revalidatePath(...)` inside a Server Action (`weigh/actions.ts:85-88` revalidates `/weigh`,
  `/harvests`, `/crew`, `/`) busts the **client router cache** for those routes, so a same-session
  navigation right after a write skips the stale cached RSC payload. With `force-dynamic` this is a
  *belt-and-braces* freshness guarantee for the post-write navigation, not the propagation mechanism
  itself.

**Design consequence:** Phase 5 does **not** need Supabase Realtime, websockets, polling, or any new
infra to make tab B reflect a write made on tab A. Navigation re-renders read live. Realtime is
explicitly **out of scope** ($0/offline-safe; a single-owner farm cockpit has no concurrent-viewer
pressure). The *only* place "live without navigation" matters is the **originating screen's own
optimistic tally** (already handled client-side in `weigh-capture.tsx` via `localBumps`) and the
**proof panel** this slice adds.

### 1.5 The write door + offline replay (exactly-once)

Every write is one SECURITY-DEFINER RPC, idempotent on a client-minted `idempotency_key`, accepting
`device_id`/`device_seq` for causal ordering. `record_weigh_in` additionally takes
`pg_advisory_xact_lock(hashtext('weigh:'||key))` to serialize same-key replays so an offline-outbox
retry racing the original applies the mass/today_kg delta **once** (`…102000.sql` lines 219-237,
390-392). The offline path: `weigh-capture.tsx` → `getEnqueueCommand()` (`src/lib/offline/runtime.ts`)
→ IndexedDB outbox → on reconnect `sync.ts` drains → `recordWeighInHandler` rebuilds the FormData →
`recordWeighInAction` → RPC. **Exactly-once is a DB property, not a UI property** — so the proof
panel can optimistically count a queued capture and the eventual server ripple will agree.

---

## 2. The canonical PROPAGATION CONTRACT (per event type)

For each genesis event: the downstream consumers, the refresh mechanism for each, and the UI
revalidation. **DELIVER agents implement against this table.** "view" = reactive-on-read (no
refresh). "matview→`refresh_lot_cost()`" = must refresh on the write path. "revalidate" = the
`revalidatePath` set the Server Action must bust.

### EVENT: `record_weigh_in` (THE walking-skeleton genesis — slice-01)

| Downstream consumer | Source | Refresh mechanism | Who triggers |
|---|---|---|---|
| Weigh per-picker tally | `v_weigh_today_by_picker` | view (read) | next read / optimistic `localBumps` now |
| Weigh per-plot tally | `v_weigh_today_by_plot` | view (read) | next read |
| Dashboard "Today"/season headline | `season_summary_view.today_kg` (Σ `harvests`) | view (read) | next read |
| Dashboard yield trend / variety mix | `daily_cherries_view` / `variety_shares_view` | view (read) | next read |
| Lot mill-intake (Σ kg) | `v_weigh_by_lot` + `lots.origin_kg` | view (read) | next read |
| Lot dossier `/lots/[code]` | lot getters + `v_weigh_by_lot` | view (read) | next read |
| Payroll accrual | `weigh_event.kg` × por-obra rate | view (read) | next read |
| Attendance | `attendance_event` (stamped by RPC) | view (read) | next read |
| **COGS / `mv_lot_cost`** | green-kg denominator can shift as the lot grows | **matview** | **see ⚠ below** |
| Client router cache | — | `revalidatePath("/weigh","/harvests","/crew","/")` | `recordWeighInAction` (exists) |

⚠ **`mv_lot_cost` and the weigh path — the one gap to decide.** `record_weigh_in` grows a *cherry*
lot's `origin_kg`/`current_kg`. `mv_lot_cost`'s green-kg denominator reads the **green** lot node
(or degrades to `processing_batches.current_kg WHERE stage='green'`). A cherry-stage weigh-in does
**not** change any green-kg, so `mv_lot_cost` for a green lot is **not** stale after a weigh-in →
**`record_weigh_in` correctly does NOT call `refresh_lot_cost()`** today, and the slice-01 contract
must **not** add one. (Costing only moves when the lot reaches green and `bookCostEntry`/processing
advance fires — those paths already refresh.) **DELIVER must NOT "wire COGS into the weigh ripple"**
— it would be a no-op refresh on the hot field path. The slice-01 proof panel names Dashboard + lot
dossier (the two real, immediate consumers), **not** COGS. This is captured as Open Question 1.

**Slice-01 proof-panel contract (the only new code in the walking skeleton):**

```ts
// src/components/sections/weigh/ripple-proof.tsx  (NEW, client island)
export interface RippleConsumer {
  label: string;          // "Dashboard · hoy", "Lote JC-712"
  href: string;           // "/", "/lots/JC-712"
  delta: string;          // "+18.4 kg"
}
export interface RippleProofProps {
  lotCode: string | null;        // the lot the last capture bound to (from WeighInResult.lotCode)
  lastDeltaKg: number | null;    // the kg just captured
  consumers: RippleConsumer[];   // derived purely client-side from the capture result + farm totals
}
```

- **No new getter, no new RPC, no new view.** The panel is fed entirely by the existing capture
  result: `WeighInResult.lotCode` (already returned by `recordWeighIn`, `recordWeighIn.ts:262`) +
  the `kgNum` the island already has. It RENDERS the propagation contract — it does not re-fetch it.
- Each consumer is a real `<Link href>`: `/` (Dashboard), `/lots/${lotCode}` (lot dossier — exists),
  optionally `/harvests`. Satisfies PRINCIPLE Rule 3 (entity → dossier) and Rule 1 (no dead UI):
  every line in the panel navigates to the live surface that the capture just moved.
- `weigh-capture.tsx` already holds `lotCode` after a successful `submit` — currently it is dropped.
  The slice surfaces it: thread `res`'s lot code (online path returns it; offline `queued` path mints
  it client-side optimistically from the same `record_cherry_intake` plot/day rule is NOT available
  offline, so for a *queued* capture the panel links `/lots` index + names the future lot generically
  until drain — see §4 offline AC).

### EVENT: `record_cherry_intake` (harvest intake — same family)

Same consumer set as weigh minus the per-picker weigh tally; mints the lot + origin `harvests` row →
`season_summary_view`, `daily_cherries_view`, lot dossier all reactive-on-read.
`revalidatePath` set: `/harvests`, `/`, `/lots/[code]` (via `revalidatePath`).

### EVENT: `bookCostEntry` → `cost_entry` insert (costing)

| Consumer | Source | Refresh | Trigger |
|---|---|---|---|
| Costing cost-per-kg-green headline | `mv_lot_cost` | **matview** | `refresh_lot_cost()` **in the action** (exists, `costing/actions.ts:180`) |
| Per-rule build-up | `mv_lot_cost_by_rule` | **matview** | same `refresh_lot_cost()` |
| Lot dossier `#cost-entries` | `cogs_per_lot()` / `cogs_breakdown_per_lot()` (read `mv_lot_cost*`) | matview | same |
| Inventory unit economics | `mv_lot_cost` | matview | same |
| Client cache | — | `revalidatePath("/costing")` | action |

**Contract:** ANY new write path that mutates `cost_entry`, green-kg (`lots.current_kg` at green
stage, `processing_batches.current_kg`), or `lot_edges` MUST call `refresh_lot_cost()` before
returning, then `revalidatePath` the affected route(s). The `reaches_green` fail-closed guard
(`costing/actions.ts:159`) stays — a cost that can't reach a green terminal is refused, not silently
dropped from the matview.

### EVENT: `log_spray` → `spray_application` (PHI — Facet handoff)

`v_plot_phi_status` is a view (reactive-on-read). Consumers: Plan gate (`schedule_pasada`
fail-closed against it, `20260623110000_phi_planner_gate.sql`), Map, Satellite, `/plots/[id]`.
**Propagation contract: ONE source (`v_plot_phi_status`) drives BOTH the gate AND every display** —
no separate PHI cache. `revalidatePath`: `/scouting`, `/plan`, `/map`, `/satellite`, `/plots/[id]`.

### EVENT: `place_qc_hold` / `release_qc_hold` → `qc_hold` (QC — Facet handoff)

`getQcStatus` reads `qc_hold` (view-ish read). Consumers: QC, Inventory (un-sellable), Dispatch,
`/lots/[code]`, `/qc/cup/[lot]`. Reactive-on-read; the *enforcement* (reserve refusal) is a DB guard
on the reserve RPC, not a UI flag. `revalidatePath`: `/qc`, `/inventory`, `/dispatch`, `/lots/[code]`.

---

## 3. Propagation invariants (the rules every DELIVER slice obeys)

1. **One write door.** Every state change goes through a SECURITY-DEFINER command RPC. No UI `.insert`
   on a truth table except the documented append-only grants (`cost_entry` INSERT-only).
2. **Views are free; matviews cost a refresh.** If the consumer reads a plain `security_invoker`
   view, the write needs **no** refresh — just `revalidatePath`. If it reads `mv_lot_cost*`, the
   write **must** `refresh_lot_cost()` on the write path.
3. **Refresh ordering.** `refresh_lot_cost()` refreshes `mv_lot_cost` then `mv_lot_cost_by_rule`
   (`…094000.sql:289-290`); the by-rule rows Σ to the headline by construction, so refreshing both in
   one txn keeps them coherent. Never refresh one without the other.
4. **No deprecated reads.** No getter/view may read a `*__deprecated` relation (would silently
   disagree with the harvests truth). Enforced by a static guard test (§5).
5. **Revalidate every affected route.** A Server Action's `revalidatePath` set must cover **every**
   tab whose RSC reads a view the write moved — not just the originating tab. (Weigh already covers
   `/weigh,/harvests,/crew,/`; the contract table above is the authoritative per-event set.)
6. **Exactly-once survives offline.** Optimistic UI counts a capture once; the DB advisory-lock +
   idempotency-key dedup guarantees the eventual server ripple equals the optimistic delta. No
   double-count on replay.
7. **$0 / offline-safe.** No Realtime, no polling, no cron, no paid infra. Propagation to other tabs
   is navigation-time RSC re-render under `force-dynamic`. Same-screen liveness is optimistic local
   state.

---

## 4. Walking-skeleton (slice-01) — concrete mechanism

**Thinnest vertical:** ONE `record_weigh_in` → TWO reactive consumers shown
(`v_weigh_today_by_picker` tally + `season_summary_view` Dashboard headline) → minted lot one click
from `/lots/[code]`. **Reuses 100% of the existing spine; adds only the proof panel + the lot link +
the Dashboard stale-comment fix.**

**Files touched (file-disjoint from other Phase-5 slices):**

| File | Change | Test (test-first) |
|---|---|---|
| `src/components/sections/weigh/ripple-proof.tsx` | NEW client island (props in §2) | render test: panel names ≥2 consumers, each is a real `<a href>`; `+18.4 kg` shown |
| `src/components/sections/weigh/weigh-capture.tsx` | thread `res.lotCode`/`kgNum` into `<RippleProof>`; render below `<WeighTally>` | behavior test: after a stubbed successful `submit`, panel lists Dashboard + `/lots/<code>` |
| `src/app/(app)/page.tsx` line 18 | delete the false "reads from canonical mock data" comment | n/a (comment) — covered by an existing/added "Dashboard headline derives from harvests" db-test |
| (verify only) `getSeason` → `season_summary_view` | assert no `__deprecated` read | static guard test §5 |

**The ripple, mechanically, end to end (online):**

1. Owner taps Capture → `weigh-capture.tsx#capture` → `submit(envelope)` →
   (online fallback or outbox) → `recordWeighInAction` → `recordWeighIn` command → `record_weigh_in`
   RPC.
2. RPC appends `weigh_event` + grows/mint lot + writes `harvests` row + stamps attendance, returns
   `lot_code`.
3. `recordWeighInAction` runs `revalidatePath("/weigh","/harvests","/crew","/")` → client router cache
   for those routes busted.
4. Client island bumps `localBumps`/`localFarmKg` (optimistic) AND renders `<RippleProof
   lotCode={res.lotCode} lastDeltaKg={kgNum} consumers={[Dashboard +Δ, Lot JC-NNN]}>`.
5. Owner clicks "Dashboard · hoy +18.4 kg" → navigates `/` → RSC re-renders (force-dynamic) →
   `getSeason()` reads `season_summary_view` → `today_kg` is up by 18.4 (the `harvests` row from
   step 2). **Zero re-entry, numbers agree.**

**Offline variant (AC #3 — exactly-one ripple after replay):**

- `submit` returns `{outcome:"queued"}`. The lot code is NOT yet known (the plot/day find-or-mint
  runs server-side on drain). The proof panel therefore renders in a **"safe on device · will
  confirm lot when synced"** state: it names Dashboard + "Tu lote" (generic) and links `/lots`
  (index) until drain. `localBumps` still climbs so the picker sees the tally rise offline.
- On reconnect, `sync.ts` drains exactly once (advisory-lock + idempotency dedup); the next Dashboard
  render shows the same +18.4 (not +36.8). Behavior test asserts a double-drain of the same entry
  yields a single delta.

---

## 5. Reactive-graph guards wired into `npm run test` (CI-free repo)

Per `wave-decisions.md` decision 5 — guards run in the local gate, not GitHub Actions:

| Guard | Asserts (propagation invariant) | Layer |
|---|---|---|
| `no-deprecated-read` static guard | no `src/lib/db/*` getter selects from a `*__deprecated` relation name | static grep test |
| `season-derives-from-harvests` db-test | inserting a `harvests` row raises `season_summary_view.today_kg` by the same kg (proves the view is reactive, invariant #4 + registry checkpoint #2) | PGlite db-test |
| `weigh-ripples-to-two-consumers` db-test | one `record_weigh_in` raises BOTH `v_weigh_today_by_picker.kg_today` AND `season_summary_view.today_kg` by the kg | PGlite db-test |
| `mv-refresh-on-cost-write` db-test | `cost_entry` insert + `refresh_lot_cost()` moves `mv_lot_cost.cost_per_kg_green`; without refresh it is stale (proves invariant #2) | PGlite db-test |
| `exactly-once-replay` test | draining the same outbox entry twice applies the kg delta once | unit/db-test |
| ripple-proof render test | panel names ≥2 consumers, each a real link, with the captured Δ | jsdom render test |

PGlite supports matviews + recursive CTEs (`…094000.sql` header AD-9), so these run $0 and offline.

---

## 6. Open questions for Andres (DESIGN must resolve before DELIVER)

1. **COGS in the weigh ripple?** Confirm the slice-01 proof panel names **Dashboard + lot dossier
   only**, and `record_weigh_in` does **NOT** call `refresh_lot_cost()` (a cherry-stage weigh-in
   moves no green-kg; refreshing the matview on every weigh would be a wasted REFRESH on the hottest
   field path). Recommended: yes, exclude COGS from the weigh ripple.
2. **Offline lot link.** For a *queued* (offline) capture the bound lot code is unknown until drain.
   Confirm the proof panel showing a generic "Tu lote · se confirma al sincronizar" + `/lots` index
   link (rather than blocking the panel until online) is acceptable. Recommended: yes.
3. **`revalidatePath` completeness.** Should we add a single shared `revalidateRipple(event)` helper
   that owns the per-event route set (the §2 contract table), so a new write path can't forget a tab?
   Lightweight, keeps the contract in code. Recommended: yes — `src/lib/reactive/revalidateRipple.ts`,
   one map from event → routes, called by every command action.
4. **No Realtime — confirm.** Confirm we explicitly decline Supabase Realtime / polling for Phase 5
   (navigation-time RSC re-render under `force-dynamic` is the cross-tab propagation; $0/offline).
   Recommended: yes.

---

## 7. What this facet hands to the other DESIGN facets

- **Dossier facets** (`/plots/[id]`, `/workers/[id]`, `/lots/[code]`): every dossier is a pure RSC
  reading `security_invoker` views — automatically reactive-on-read, no per-dossier cache. They only
  need to appear in the relevant Server Action's `revalidatePath` set (the §2 contract table).
- **PHI / QC facets:** their gate AND their display read ONE source (`v_plot_phi_status`,
  `qc_hold`) — propagation invariant #1; no duplicate cache.
- **Costing facet:** owns the only refresh edge (`refresh_lot_cost()`); every cost/green-kg/edge
  write must call it (invariant #2/#3).
- **Offline facet:** the proof panel honors `queued` vs `sent` (§4 offline variant); exactly-once is
  a DB property the UI may trust.
