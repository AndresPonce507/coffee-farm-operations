# Phase 5 · DESIGN — Facet J2: The Entity-Dossier Architecture

> Architecture section for the **dossier** facet. Defines the page model + data-loading pattern for
> **all 7 dossier types** (Lot, Plot, Worker, Crew, Batch, Dispatch-run, Pay-period), a **reusable
> dossier shell**, a **section-loader contract**, and the **cross-entity link map**. Grounded by
> reading the live code at `/Users/andres/coffee-farm-operations-worktrees/phase1-deliver` (branch
> `main`). Every path / RPC / view / getter named below is real unless explicitly marked **(NEW)**.
>
> Companion facets: `01-*` (smart-bar / wiring), this file `02-dossiers.md`, downstream slices in
> `discuss/slices/`. The walking skeleton is slice-01 (weigh ripple). Sister slices for this facet:
> **slice-03** (`/plots/[id]` + Map click), **slice-04** (`/workers/[id]`), **slice-05** (⌘K jump),
> **slice-08** (Satellite drill-in).

---

## 0. North-Star alignment (what a dossier MUST satisfy)

From `PRINCIPLE.md` + `feature-delta.md`:

- **No dead UI.** Every entity mention (a row, a card, a chip naming a Lot/Plot/Worker/Crew/Batch/
  Dispatch-run/Pay-period) becomes a **`<Link>` to that entity's dossier**.
- **Smart-bar rule inside a dossier:** a **raw/editable** field → opens a create/edit modal wired to
  a command-RPC; a **computed/derived** value (a sum, cost/kg, cup score, attendance total) →
  **drills to the editable source records** that produce it (often a *section* of the dossier, or the
  source tab deep-linked with `#anchor`). Never inert.
- **Unknown entity → `notFound()` (404).** No fabricated dossier. This mirrors the existing
  `/lots/[code]` (empty graph → 404) and `/ferment/[batch]` (no batch → 404) behavior.
- **Server Components only** for the page + sections; the only client JS is an existing island
  (genealogy pan/zoom, ferment log-reader, Map click, ⌘K palette).
- **es-PA-first copy**, WCAG-AA on the living aurora background, reduced-motion-aware, $0/offline-safe.

**Scope decision (resolves Open Question 2 in `feature-delta.md`):** all 7 dossiers are in Phase 5.
`/plots/[id]`, `/workers/[id]`, `/crew/[id]` are R2 (slices 03–04 + crew). `/dispatch/[id]` and
`/pay-period/[id]` are **thin dossiers over already-live getters** (no new data) and land in R4 depth
work. `/lots/[code]`, `/ferment/[batch]`, `/qc/cup/[lot]` already exist and are only *wired in*
(slice-05 + row-link slices).

---

## 1. The two reachability problems & their fixes

### 1a. Reach EXISTING orphan dossiers (`/lots/[code]`, `/ferment/[batch]`, `/qc/cup/[lot]`)

These render deep but are linked from almost nowhere. Two complementary mechanisms — **both already
have working primitives in the repo**:

1. **⌘K entity jump** — `src/components/layout/command-palette.tsx` ALREADY resolves a digit-run to
   `/lots/JC-NNN`. **Extend** (slice-05) its `results` memo to also emit batch + cup destinations.
   No new component, no new route — just more `Result` kinds. (See §6.)
2. **Inline entity links** — every entity-bearing row across the 17 tabs becomes a `<Link>`. This is
   the bulk D2 work; the dossier facet OWNS the link **targets** + the `entityHref()` helper (§5) and
   the per-dossier **back-link** convention; the per-tab row edits are slice-local.

### 1b. Build the 5 MISSING dossiers

`/plots/[id]`, `/workers/[id]`, `/crew/[id]`, `/dispatch/[id]`, `/pay-period/[id]`. All five reuse
the **dossier shell** (§3) + the **section-loader contract** (§4) so a parallel DELIVER fleet builds
them **file-disjoint** (one route folder + one section-set per agent).

---

## 2. Page model — the canonical dossier route shape

Every dossier is a **Server Component page** at `src/app/(app)/<entity>/[param]/page.tsx`, following
the proven shape of `lots/[code]/page.tsx` and `ferment/[batch]/page.tsx`:

```tsx
// src/app/(app)/plots/[id]/page.tsx  (NEW — exemplar; the other four mirror it)
import { notFound } from "next/navigation";
import { DossierShell } from "@/components/dossier/dossier-shell";              // NEW (§3)
import { PlotIdentitySection } from "@/components/sections/plots/plot-identity-section"; // NEW
import { PlotHarvestsSection } from "@/components/sections/plots/plot-harvests-section";  // NEW
// …one import per section

export default async function PlotDossierPage({
  params,
}: {
  params: Promise<{ id: string }>;        // Next 15 async params (matches lots/ferment)
}) {
  const { id } = await params;

  // 1. Resolve the ANCHOR entity first (the existence gate). One cheap getter.
  const plot = await getPlotById(id);     // src/lib/db/plots.ts — already exists
  if (!plot) notFound();                  // unknown id → 404, no fabricated story

  // 2. Fan the SECTION reads out in parallel (all React-cache()'d getters).
  const [harvests, phi, vegetation, cost, originStatus] = await Promise.all([
    getHarvestsForPlot(id),               // (NEW thin getter, §7) — filters getHarvests
    getPlotPhiStatus(),                   // remote-sensing.ts (filter to id in section)
    getPlotVegetation(),                  // remote-sensing.ts
    getPlotCost(id),                      // cogs.ts — getPlotCost(id) EXISTS
    getPlotOriginStatus(id),              // (NEW, §7) — wraps eudr origin for this plot
  ]);

  return (
    <DossierShell
      kind="plot"
      title={plot.name}
      eyebrow="Lote"
      subtitle={`${plot.variety} · ${plot.areaHa} ha · ${plot.altitudeMasl} msnm`}
      backHref="/plots"
      backLabel="Todos los lotes"
    >
      <PlotIdentitySection plot={plot} />
      <PlotHarvestsSection harvests={harvests} />
      <PlotSatelliteSection vegetation={vegetation} phi={phi} plotId={id} />
      <PlotCostSection cost={cost} plotId={id} />
      <PlotEudrSection status={originStatus} plotId={id} />
    </DossierShell>
  );
}
```

**Invariants every dossier page obeys (the contract):**

| # | Invariant | Why |
|---|-----------|-----|
| P1 | `async` Server Component; `params: Promise<{…}>` | Next 15 App Router; matches `lots`/`ferment`. |
| P2 | Resolve the **anchor entity** with ONE getter, `notFound()` if absent — *before* any section fetch | "no fabricated dossier"; cheapest 404. |
| P3 | All section reads via `Promise.all` of `cache()`'d getters | parallel, no waterfall; getters dedupe. |
| P4 | Render through `<DossierShell>` + N `<…Section>` Server Components | one shell, file-disjoint sections. |
| P5 | NO `src/lib/data/*` import | mock-leak guardrail (0 mock reads). |
| P6 | Every entity name inside a section is a `<Link href={entityHref(...)}>` | cross-entity connectivity (§5). |
| P7 | Loading via route-level `loading.tsx` (skeleton) + per-section empty/error states | world-class craft. |

---

## 3. The reusable dossier shell — `<DossierShell>` (NEW)

New file: `src/components/dossier/dossier-shell.tsx` — a **Server Component** (no hooks). It is the
single source of dossier chrome so all 7 dossiers feel identical and a future restyle is one edit.
Built from existing primitives (`PageHeader` pattern, `Card`, glass classes, `lucide-react`,
`next/link`). It does NOT fetch — it only lays out.

```tsx
// src/components/dossier/dossier-shell.tsx  (NEW — Server Component)
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export type DossierKind =
  | "lot" | "plot" | "worker" | "crew" | "batch" | "dispatch" | "pay-period";

export interface DossierShellProps {
  kind: DossierKind;
  title: string;                 // entity display name, e.g. "Tizingal-Alto" / "Lupita González"
  eyebrow: string;               // localized kind label, e.g. "Lote" / "Trabajador" / "Cuadrilla"
  subtitle?: string;             // one-line identity summary
  backHref: string;              // list route this entity belongs to
  backLabel: string;             // es-PA back link, e.g. "Todos los lotes"
  actions?: React.ReactNode;     // optional header-right create/edit affordances (smart-bar)
  children: React.ReactNode;     // the ordered <…Section> server components
}

export function DossierShell({
  kind, title, eyebrow, subtitle, backHref, backLabel, actions, children,
}: DossierShellProps) {
  return (
    <div className="space-y-6" data-dossier={kind} data-testid={`dossier-${kind}`}>
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-fg transition hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {backLabel}
      </Link>

      {/* Reuses the PageHeader visual language (eyebrow added for entity kind). */}
      <header className="animate-rise relative mb-2 pb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-forest/70">{eyebrow}</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-muted-fg">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent" />
      </header>

      <div className="space-y-6">{children}</div>
    </div>
  );
}
```

The `backHref`/`backLabel` convention keeps the lot/ferment back-link pattern (`/ferment` page
already does `<ArrowLeft/> All ferments`). **Existing `/lots/[code]` + `/ferment/[batch]` are
optionally retrofitted onto `<DossierShell>`** in a follow-up so all 7 share chrome — not required
for the new five to ship (kept out of the R2 critical path to stay file-disjoint).

---

## 4. The section-loader contract — `DossierSection` (NEW)

Each dossier is a vertical stack of **sections**. A section is a **pure presentational Server
Component** that receives already-fetched, already-mapped domain data as props (page does the
fetching, per P3). This keeps sections file-disjoint and unit-testable with fixture props (no DB in
the render test), exactly like `<GenealogyGraph graph={…}>` and `<FermentTracker …>` today.

**Section contract (every `<…Section>` obeys):**

```tsx
// Shared wrapper so all sections share heading + empty-state + anchor behavior.
// src/components/dossier/dossier-section.tsx  (NEW — Server Component)
export interface DossierSectionProps {
  id: string;                    // hash anchor, e.g. "satellite" → deep-linkable #satellite
  title: string;                 // localized section heading
  count?: number;                // optional badge (e.g. "8 cosechas")
  empty?: boolean;               // render the empty state instead of children
  emptyLabel?: string;           // es-PA empty copy
  children: React.ReactNode;
}

export function DossierSection({ id, title, count, empty, emptyLabel, children }: DossierSectionProps) {
  return (
    <section id={id} className="scroll-mt-24" data-testid={`section-${id}`}>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
        {typeof count === "number" && (
          <span className="rounded-full bg-forest-100 px-2 py-0.5 text-xs font-medium text-forest">{count}</span>
        )}
      </div>
      {empty
        ? <EmptyState label={emptyLabel ?? "Sin registros todavía"} />   // reuses ui/empty-state.tsx
        : children}
    </section>
  );
}
```

Rules a concrete `<XSection data={…}>`:
1. **Takes domain props, never fetches.** (Page owns `Promise.all`.)
2. **Wraps its body in `<DossierSection id=… />`** so every section is `#anchor`-deep-linkable
   (enables `/plots/[id]#satellite`, `/lots/[code]#eudr` — `lots` already uses `id="eudr"`).
3. **Renders entity names as `<Link href={entityHref(...)}>`** (P6) — this is *the* connectivity
   mechanism inside a dossier (e.g. the plot dossier's harvest rows link to `/workers/[id]`).
4. **Computed values drill** — a cost-total or attendance-sum links to the source section/tab
   (`#cost-entries`, the weigh tab, the pay period) per the smart-bar rule.
5. **Owns empty/error copy** in es-PA.

---

## 5. The cross-entity link map (which dossier links to which)

This is the connectivity graph the mandate demands. **Each dossier surfaces ≥4 cross-entity links**
(`outcome-kpis.md` target: avg ≥4 links/dossier). Source data already exists via the named getters.

| Dossier | Section | Source getter (existing unless NEW) | Links OUT to |
|---|---|---|---|
| **Plot** `/plots/[id]` | Identity | `getPlotById` (plots.ts) | — |
| | Harvests | `getHarvestsForPlot` (NEW §7, filters `getHarvests`) | each row → **Worker** `/workers/[picker]`, **Lot** `/lots/[lotCode]` |
| | Satellite/PHI | `getPlotVegetation`, `getPlotPhiStatus` (remote-sensing.ts) | PHI chip → originating **spray** (`/scouting#spray-<id>`) |
| | Cost | `getPlotCost(id)` (cogs.ts) | total → `#cost-entries`; reachable green → **Lot** `/lots/[code]` |
| | EUDR origin | `getPlotOriginStatus` (NEW §7, wraps eudr) | → **Lot** dossiers it feeds `/lots/[code]#eudr` |
| **Worker** `/workers/[id]` | Identity | `getWorkers`→find / `getCrewRoster` (people.ts) | **Crew** `/crew/[crewId]` |
| | Attendance | `getWorkerAttendanceTimeline(id)` (people.ts) | each event's plot → **Plot** `/plots/[plotId]` |
| | Kg / weigh | `getWeighTodayByPicker` (weigh.ts, filter) | weigh rows → **Plot** + **Lot** |
| | Por-obra pay | `getWorkerPorObraHistory(id)` (people.ts) | → **Pay-period** `/pay-period/[id]` |
| | Certs | `getWorkerCertsValid(id)` (people.ts) | (cert → Scouting eligibility) |
| **Crew** `/crew/[id]` | Identity | `getCrewRoster` (people.ts, filter crewId) | — |
| | Members | `getCrewRoster` rows for crewId | each member → **Worker** `/workers/[id]` |
| | Today's dispatch | `getDispatchToday` (dispatch.ts, filter crewId) | → **Dispatch-run** `/dispatch/[id]` |
| | Pay rollup | `getPayPeriods` + `getWorkerPayForPeriod` (payroll.ts) | → **Pay-period** `/pay-period/[id]` |
| **Lot** `/lots/[code]` *(exists)* | Lineage / EUDR | `getLotGenealogy`, `getLotEudrDossier` | genealogy nodes → **Plot** origins; cost → `/lots#cost-entries` |
| **Batch** `/ferment/[batch]` *(exists)* | Curve / water | `getFermentCurve`, `getFermentCutpoint`, `getWaterPerKg` | batch.lotCode → **Lot** `/lots/[code]` |
| **Cup** `/qc/cup/[lot]` *(exists)* | Score / drift | `getCupFinalScores`, `getCupperDrift`, `getGreenDefects` | cup-to-cause → **Plot**/**Worker** |
| **Dispatch-run** `/dispatch/[id]` (NEW) | Card / plots | `getDispatchToday` (dispatch.ts) → find by `id` | **Crew** `/crew/[crewId]`; each plot line → **Plot** `/plots/[id]` |
| **Pay-period** `/pay-period/[id]` (NEW) | Summary / lines | `getPayPeriods`, `getWorkerPayForPeriod(id)`, `getDisbursementsForPeriod(id)` | each pay line → **Worker** `/workers/[id]`; payslip → `/...` |

**`entityHref()` helper (NEW, owned by this facet)** — single source of truth for dossier URLs, so
every row-link slice imports it instead of hand-building paths (prevents drift):

```ts
// src/lib/dossier/entity-href.ts  (NEW)
export const entityHref = {
  lot:      (code: string) => `/lots/${code}`,
  plot:     (id: string)   => `/plots/${id}`,
  worker:   (id: string)   => `/workers/${id}`,
  crew:     (id: string)   => `/crew/${id}`,
  batch:    (id: string)   => `/ferment/${id}`,
  cup:      (lot: string)  => `/qc/cup/${lot}`,
  dispatch: (id: string | number) => `/dispatch/${id}`,
  payPeriod:(id: string)   => `/pay-period/${id}`,
} as const;
```

---

## 6. ⌘K entity jump — extend the existing palette (slice-05)

`command-palette.tsx` already resolves digit-runs → `/lots/JC-NNN`. **Extend `results` only**:

- Keep `lotCodeFrom` (digit-run → lot). Add **batch** (UUID-shaped input → `/ferment/<uuid>`) and a
  **green-lot cup** hint (a JC-code that is green → also offer `/qc/cup/<code>`). Resolution stays
  client-side pattern-matching — **the route's own `notFound()` is the authority** (typing a bad code
  routes then 404s; the palette shows "Sin resultados" only when no pattern matches at all). This
  matches slice-05 AC ("unknown → no result; direct nav still 404s").
- No new component; add `Result.kind` values `"batch" | "cup"`. Update the trigger copy to
  "Busca lotes, parcelas, trabajadores…" (already close).

> Resolves Open Question 3: ⌘K is the right orphan-reachability mechanism **and** it already exists —
> we extend, not introduce. Row-links (§5) are the complementary path.

---

## 7. NEW getters required (thin, additive, schema-lane-free)

All are `cache()`'d read getters that **filter/compose EXISTING views** — no migrations, no new
tables (honors the $0/no-schema-churn posture; none touch the command-RPC write door). One author
should own `src/lib/db/*` additions to avoid a getter-file merge collision, OR each lands in its own
new file:

| Getter (NEW) | File | Implementation |
|---|---|---|
| `getHarvestsForPlot(plotId)` | `src/lib/db/harvests.ts` | `harvests_view` `.eq("plot_id", id)` (or filter `getHarvests()` in-memory) |
| `getPlotOriginStatus(plotId)` | `src/lib/db/eudr.ts` | derive from `getEudrSummary()` / origin-plots for this plot |
| `getCrewById(crewId)` | `src/lib/db/people.ts` | `getCrewRoster()` filtered to `crew_id` (header + members) |
| `getDispatchRunById(id)` | `src/lib/db/dispatch.ts` | `getDispatchToday()`-style read of `v_dispatch_card` `.eq("id", id)` (drop the date pin) + its `v_dispatch_card_plots` |
| `getPayPeriodById(id)` | `src/lib/db/payroll.ts` | `getPayPeriods()` filtered to id (summary anchor) |
| `getWorkerWeighSummary(workerId)` | `src/lib/db/weigh.ts` | filter `getWeighTodayByPicker()` to the worker |

**Anchor-getter existence gates (P2) per dossier:**
- Plot → `getPlotById(id)` (exists). Worker → `getWorkers()` find / dedicated getter.
- Crew → `getCrewById(crewId)` rows non-empty. Dispatch → `getDispatchRunById(id)` truthy.
- Pay-period → `getPayPeriodById(id)` truthy. All → `notFound()` when absent.

---

## 8. Loading / empty / error (world-class craft, per shell)

- **`loading.tsx` per new route** (`src/app/(app)/plots/[id]/loading.tsx`, etc.): a `<DossierShell>`
  skeleton (eyebrow + title shimmer + N `<DossierSection>` placeholders) so navigation is instant.
- **Empty section** → `<DossierSection empty emptyLabel="…">` (reuses `ui/empty-state.tsx`).
- **Error** → Next `error.tsx` boundary per route (getter throw surfaces a retry card, not a white
  screen). Anchor-not-found is `notFound()`, not error.
- **Reduced-motion** inherited from `globals.css` (`animate-rise` already respects it).

---

## 9. Test plan (test-first, every PR — no exemption)

Each dossier slice ships, written **before** the code:

1. **Shell render test** (`dossier-shell.test.tsx`, `dossier-section.test.tsx`) — mounts with fixture
   props, asserts title/eyebrow/back-link/anchor render, no throw. (jsdom + RTL — already a repo
   prereq.)
2. **Section render tests** — each `<…Section>` with fixture domain props asserts entity names render
   as links to the correct `entityHref(...)` (the connectivity AC).
3. **Page behavior tests** (mirror `lots/[code]/__tests__/page.test.tsx`):
   - known id renders sections from live getters (mocked);
   - **unknown id → `notFound()`** (the 404 AC, every dossier);
   - row → dossier route assertions (Map click → `/plots/[id]`; picker row → `/workers/[id]`).
4. **`entityHref` unit test** — pure mapping table.
5. **Palette test** (slice-05) — known lot/batch/cup code routes; unknown → "Sin resultados".

---

## 10. Slice → file ownership map (file-disjoint DELIVER fan-out)

| Slice | New routes/files (writer-owned, disjoint) | Shared (one author / pre-built first) |
|---|---|---|
| **(shell)** *land first* | `components/dossier/dossier-shell.tsx`, `dossier-section.tsx`, `lib/dossier/entity-href.ts` | these 3 are the **contract** — built + merged before the 5 dossier slices fan out |
| **slice-03** Plot | `app/(app)/plots/[id]/{page,loading,error}.tsx`, `components/sections/plots/plot-*-section.tsx`, `db.getHarvestsForPlot`, `db.getPlotOriginStatus`; Map `onClick`→`entityHref.plot` | shell, `entityHref` |
| **slice-04** Worker | `app/(app)/workers/[id]/*`, `components/sections/workers/worker-*-section.tsx`, `db.getWorkerWeighSummary` | shell, `entityHref` |
| **crew** | `app/(app)/crew/[id]/*`, `components/sections/crew/crew-*-section.tsx`, `db.getCrewById` | shell, `entityHref` |
| **dispatch-run** (R4) | `app/(app)/dispatch/[id]/*`, `db.getDispatchRunById` | shell, `entityHref` |
| **pay-period** (R4) | `app/(app)/pay-period/[id]/*`, `db.getPayPeriodById` | shell, `entityHref` |
| **slice-05** ⌘K | `command-palette.tsx` (extend results only) | `entityHref` |
| **row-link slices (D2)** | per-tab section edits adding `<Link href={entityHref…}>` | `entityHref` (read-only import) |

**Sequencing:** build + merge the **3 contract files** (shell, section, `entityHref`) as the first
PR (its own render test). Then the 5 dossier routes fan out file-disjoint, each importing the frozen
contract. A reviewer pass checks cross-dossier coherence (every entity name is a link; every dossier
404s on unknown id; ≥4 cross-links each) before R2 lands.

---

## 11. Open items flagged for the orchestrator (flag-don't-fix)

- **Dispatch-run param type:** `v_dispatch_card.id` is numeric (`Number(cardRow.id)`); the route param
  is a string — `getDispatchRunById` must coerce. Confirm the run id is the stable public handle the
  Dispatch board should link with (vs `idempotency_key`).
- **Pay-period id format:** `getWorkerPayForPeriod(payPeriodId: string)` takes a string id — confirm
  `getPayPeriods()` exposes that same id as the row key for the `/pay-period/[id]` link.
- **Retrofitting `/lots/[code]` + `/ferment/[batch]` onto `<DossierShell>`** is deferred (kept off the
  R2 critical path); flagged as a coherence follow-up so all 7 dossiers share chrome.
</content>
</invoke>
