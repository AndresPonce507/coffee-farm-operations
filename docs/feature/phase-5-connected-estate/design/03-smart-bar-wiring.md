# Phase 5 · DESIGN — Facet 03: The Smart-Bar Wiring Contract

> The reusable, app-wide pattern that makes **every clickable element on all 17 tabs** conform to
> PRINCIPLE.md Rule 2: a raw entity/field opens a real **create/edit modal**; a computed value
> **drills to its editable source records**; an entity reference **navigates to its dossier**; a
> cosmetic control is **wired or deleted**. This facet defines the shared primitives, the per-element
> classification procedure an implementer applies straight off `wire-up-audit.md`, and the
> success → reactive-refresh contract. It is the connective tissue every slice (01–08) reuses.
>
> **Grounding:** built on the existing, finalized idioms — `src/components/ui/dialog.tsx` (portal-fixed
> glass modal), `useActionState` form islands (`start-ferment-form.tsx`, `qc-hold-control.tsx`,
> `disbursement-form.client.tsx`), the `(_prev, FormData) => ActionState` Server Action shape
> (`src/lib/actions/plots.ts`, `src/app/(app)/ferment/actions.ts`), the SECURITY DEFINER command-RPC
> write door (`src/lib/db/commands/*`), and `revalidatePath`-driven reactive refresh. **Nothing here
> introduces a new mechanism** — it standardizes the ones already in the repo so a file-disjoint
> DELIVER fleet can apply them uniformly.

---

## 0. The four smart-bar verbs (the decision the implementer makes per element)

Every interactive element resolves to **exactly one** of these. The verb is a property of the element,
decided from the audit row, not invented per slice.

| Verb | When | Mechanism | Reference idiom |
|------|------|-----------|-----------------|
| **EDIT** | element renders a **raw, owner-editable field/entity** (a plot's shade %, a worker's daily rate, a recipe choice) | open a `Dialog` hosting a `useActionState` form bound to a command-RPC / Server Action | `record-intake-button.tsx` → `CherryIntakeForm` |
| **CREATE** | element is an **add affordance** (new plot, new spray, new disbursement) | same as EDIT, form starts empty + mints a record | `start-ferment-button.tsx` → `StartFermentForm` |
| **DRILL** | element renders a **computed/derived value** — a sum, COGS, cup score, chart, KPI tile, MATVIEW-backed number (you can't edit a derived number) | `<Link>` to the **editable source records** that produce it (a filtered list / dossier anchor) | Costing → `/lots/[code]#cost-entries` (existing) |
| **NAVIGATE** | element **names a connected entity** (a lot/plot/worker/crew/batch/dispatch-run/pay-period row or card) | `<Link>` to that entity's **dossier** | `/lots/[code]` (existing), the 7 new dossiers (facet 02) |

Cosmetic-only controls are **not** a fifth verb — they are resolved INTO one of the four (or deleted).
A genuine display-only chrome element (a status chip that mirrors DB truth, a filter toggle that is
real client state) is acceptable **only** when it names no entity and gates no data; otherwise it is a
defect per PRINCIPLE.md §"The acceptance test".

---

## 1. Shared primitives (new files this facet owns)

These are the **contract files** — single-author, file-disjoint from every slice's element work.
Slices import them; they do not fork them (CLAUDE.md "Contract — don't fork these").

### 1.1 `src/components/ui/edit-dialog.tsx` — the EDIT/CREATE host

A thin, reusable wrapper over the existing `Dialog` (`src/components/ui/dialog.tsx`) that owns the
open/close state and the trigger, so every create/edit affordance is one component instead of the
hand-rolled `useState(open)` + `<Dialog>` + `<Form onDone>` triplet repeated in
`record-intake-button.tsx`, `start-ferment-button.tsx`, etc. **Does not replace** those existing
buttons (leave them — flag-don't-fix); it is the standard for all *new* Phase-5 wiring.

```tsx
"use client";
import { type ReactNode, useState, cloneElement, isValidElement } from "react";
import { Dialog } from "@/components/ui/dialog";

export interface EditDialogRenderProps {
  /** Form calls this on success to close the host. */
  onDone: () => void;
}

export function EditDialog({
  title,
  trigger,                 // the clickable element; receives onClick to open
  children,                // (p: EditDialogRenderProps) => ReactNode — the bound form
  closeOnSuccess = true,   // false when the form shows its own success state w/ a follow-through link
}: {
  title: string;
  trigger: (open: () => void) => ReactNode;
  children: (p: EditDialogRenderProps) => ReactNode;
  closeOnSuccess?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {trigger(() => setOpen(true))}
      <Dialog open={open} onClose={() => setOpen(false)} title={title}>
        {children({ onDone: () => (closeOnSuccess ? setOpen(false) : undefined) })}
      </Dialog>
    </>
  );
}
```

Rationale for the render-prop trigger: a smart-bar EDIT element is frequently **an existing row/card
that already has its own markup** (a plot card, a KPI tile). `trigger(open)` lets the slice keep that
markup and just attach `onClick={open}` + `role="button"` + keyboard handlers, rather than nesting a
`<Button>`. For a pure new "＋ New X" affordance, `trigger` returns a `<Button onClick={open}>`.

### 1.2 `src/components/ui/smart-form.tsx` — the bound-form contract

The shared shape every EDIT/CREATE form conforms to, factoring the success-pane + error-surface +
`useActionState` boilerplate that `start-ferment-form.tsx`, the payroll forms, and `cherry-intake-form`
each re-implement. A slice's form supplies only its fields.

```tsx
"use client";
import { useActionState, useState, type ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The canonical action state EVERY smart-bar form's action returns.
 *  Identical in shape to ferment/payroll/plots ActionState — unified here. */
export type SmartActionState =
  | { status: "idle" }
  | { status: "success"; message: string; href?: string } // href => optional follow-through link
  | { status: "error"; message?: string; errors?: Record<string, string> };

export const SMART_IDLE: SmartActionState = { status: "idle" };

/** The reducer shape useActionState drives. Matches the repo's
 *  `(prev, FormData) => Promise<ActionState>` Server Action signature exactly,
 *  so a form can pass a route action straight in (no adapter), OR the by-shape
 *  prop idiom from disbursement-form.client.tsx for render-testability. */
export type SmartReducer = (
  prev: SmartActionState,
  fd: FormData,
) => Promise<SmartActionState> | SmartActionState;

export function SmartForm({
  action,
  idempotent = false,    // mints a hidden idempotencyKey when true (write/genesis events)
  submitLabel,
  pendingLabel,
  onDone,
  children,              // (helpers) => fields
}: {
  action: SmartReducer;
  idempotent?: boolean;
  submitLabel: string;
  pendingLabel: string;
  onDone?: () => void;
  children: (h: {
    pending: boolean;
    fieldError: (k: string) => string | undefined;
  }) => ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, SMART_IDLE);
  const [idemKey] = useState(() => crypto.randomUUID());
  const fieldError = (k: string) =>
    state.status === "error" ? state.errors?.[k] : undefined;

  if (state.status === "success") {
    return (
      <div role="status" className="flex flex-col items-center gap-3 py-4 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-forest-50 text-forest ring-1 ring-forest-100">
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        </span>
        <p className="text-sm text-muted-fg">{state.message}</p>
        {state.href && (
          <a href={state.href} className="text-sm font-medium text-forest underline">
            Ver →
          </a>
        )}
        {onDone && (
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>Done</Button>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {idempotent && <input type="hidden" name="idempotencyKey" value={idemKey} />}
      {children({ pending, fieldError })}
      {state.status === "error" && state.message && (
        <p role="alert" className="text-xs font-medium text-cherry">{state.message}</p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        {onDone && <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>}
        <Button type="submit" disabled={pending}>{pending ? pendingLabel : submitLabel}</Button>
      </div>
    </form>
  );
}
```

This is **behavior-identical** to the three existing forms (same success pane, same `role="alert"`
error line, same idempotency-key idiom from `start-ferment-form.tsx`), just hoisted so every Phase-5
form is ~30 lines of `<select>`/`<input>` instead of re-deriving the scaffold. Existing forms are NOT
migrated (flag-don't-fix); new slices build on `SmartForm`.

Shared field classnames (`FIELD`, `LABEL`) are promoted to `src/components/ui/form-field.tsx` so the
glass input styling (`h-11 rounded-xl border-line bg-white/70 …` — verbatim from the three idioms) has
one source. Each form imports them rather than re-declaring the literal.

### 1.3 `src/components/ui/entity-link.tsx` — the NAVIGATE/DRILL primitive

The single component that turns any entity-naming or computed element into a real link, so "make this
COSMETIC row a dossier link" is a one-line wrap across the audit's ~88 cosmetic rows.

```tsx
import Link from "next/link";
import { type ReactNode } from "react";

export type EntityKind =
  | "lot" | "plot" | "worker" | "crew" | "batch" | "dispatch" | "pay-period";

/** SSOT for entity → dossier href. The ONLY place a dossier route shape lives,
 *  so a route rename touches one file. Matches facet-02 dossier routes. */
export const entityHref: Record<EntityKind, (id: string) => string> = {
  lot: (c) => `/lots/${encodeURIComponent(c)}`,
  plot: (id) => `/plots/${encodeURIComponent(id)}`,
  worker: (id) => `/workers/${encodeURIComponent(id)}`,
  crew: (id) => `/crew/${encodeURIComponent(id)}`,
  batch: (id) => `/ferment/${encodeURIComponent(id)}`,
  dispatch: (id) => `/dispatch/${encodeURIComponent(id)}`,
  "pay-period": (id) => `/pay-period/${encodeURIComponent(id)}`,
};

/** NAVIGATE: wrap entity-naming markup → its dossier. Preserves child markup
 *  (the existing card/row), adds the link affordance + a11y. */
export function EntityLink({
  kind, id, children, className, anchor,
}: {
  kind: EntityKind;
  id: string;
  children: ReactNode;
  className?: string;
  anchor?: string;   // DRILL: deep-link to a source section, e.g. "cost-entries"
}) {
  const href = entityHref[kind](id) + (anchor ? `#${anchor}` : "");
  return (
    <Link
      href={href}
      className={className}
      aria-label={`Abrir ${kind} ${id}`}
      prefetch={false}
    >
      {children}
    </Link>
  );
}
```

DRILL is the same component with an `anchor` (e.g. a Costing KPI tile → `EntityLink kind="lot"
anchor="cost-entries"`), or — when the computed value summarizes *many* records — a `<Link>` to a
**pre-filtered list route** (e.g. a Dashboard "closest to green" count → `/inventory?status=resting`).
The implementer picks the destination from the audit's "Connects to" column.

---

## 2. The classification procedure (apply per audit row, mechanically)

For every element in `wire-up-audit.md` (and the four cluster tables behind it), the implementer runs
this decision tree. Output: the verb + the concrete binding. This is the per-element spec a DELIVER
agent executes.

```
START: read the element's audit row (State | Should tie to | Click should do | Connects to)

Q1. Does the element render an OWNER-EDITABLE raw field or an "add" affordance?
    ├─ YES, edits an existing record  → EDIT  → §3.1 (EditDialog + SmartForm + command-RPC)
    └─ YES, creates a new record      → CREATE→ §3.1 (same, empty form, idempotent=true if genesis event)

Q2. Else: does it render a COMPUTED / DERIVED value
         (sum, COGS, mv_lot_cost, cup score, count, chart, KPI tile, season total)?
    └─ YES → DRILL → §3.2 (EntityLink with #anchor to source records, OR Link to filtered list)

Q3. Else: does it NAME a connected entity (lot/plot/worker/crew/batch/dispatch/pay-period)?
    └─ YES → NAVIGATE → §3.3 (EntityLink kind=… id=…)

Q4. Else: is it real, display-only chrome (a DB-mirrored status chip, a real client-state filter,
         a courtesy-disabled DB-guard STUB)?
    ├─ YES → KEEP as-is (document why; the 3 intentional STUBs + true filters live here)
    └─ NO  → DEAD/COSMETIC-with-no-target → DELETE the affordance (no pointer cursor, no handler)
```

**Tie-breaks (the audit's hard cases):**
- A row that is **both** an entity reference **and** has an inline edit (e.g. a roster row that names a
  worker *and* has an "edit rate" pencil): the **row body** is NAVIGATE (→ dossier); the **pencil** is
  EDIT. Two targets, never one swallowing the other. Pattern: `EntityLink` wrapping the body + a
  sibling `EditDialog` trigger button (stop-propagation on the pencil so the row link doesn't fire).
- A **KPI tile** backed by a MATVIEW/VIEW is always **DRILL**, never EDIT — you cannot edit
  `mv_lot_cost`. It links to the editable inputs (`/lots/[code]#cost-entries`).
- A **chart datapoint** is DRILL to the underlying record set; if the datapoint maps 1:1 to an entity
  (a bar = a plot), it is NAVIGATE to that entity's dossier.
- A genuine **filter chip / segmented control** (Plots variety filter, grid/list toggle) is real client
  state → KEEP (Q4 YES). It is not "cosmetic" in the defect sense.

---

## 3. The three binding templates (what a slice writes)

### 3.1 EDIT / CREATE binding

**Element → trigger → `EditDialog` → `SmartForm` → Server Action → command → SECURITY DEFINER RPC →
`revalidatePath`.** The full chain already exists for ferment/intake/qc/payroll; the template makes it
uniform.

```tsx
// e.g. an editable plot field on the /plots/[id] dossier
<EditDialog
  title="Editar lote"
  trigger={(open) => (
    <button type="button" onClick={open} className="…glass row…" aria-haspopup="dialog">
      {/* existing card/field markup */}
    </button>
  )}
>
  {({ onDone }) => (
    <SmartForm
      action={updatePlot}            // (prev, FormData) => ActionState — src/lib/actions/plots.ts
      submitLabel="Guardar"
      pendingLabel="Guardando…"
      onDone={onDone}
    >
      {({ pending, fieldError }) => (
        <>
          <input type="hidden" name="id" value={plot.id} />
          <FormField label="Sombra %" name="shadePct" defaultValue={plot.shadePct}
                     disabled={pending} error={fieldError("shadePct")} />
          {/* …other fields… */}
        </>
      )}
    </SmartForm>
  )}
</EditDialog>
```

**Server Action contract (the write door every EDIT/CREATE binds to):**

```ts
"use server";
export async function <verb>(
  _prev: SmartActionState,
  formData: FormData,
): Promise<SmartActionState> {
  const parsed = validate<X>(formToRecord(formData));      // pure validator, friendly field errors
  if (!parsed.ok) return { status: "error", errors: parsed.errors };

  const store = await getSupabase();                        // or the command's Store seam
  const res = await <command>(store, withEnvelope(parsed.data));  // command → single RPC write door
  if (!res.ok) return { status: "error", message: res.message, errors: res.errors };

  reactiveRefresh(<affectedRoutes>);                        // §4
  return { status: "success", message: "<es-PA confirmation>", href: res.href };
}
```

Genesis/event writes (anything that appends a `lot_event`) MUST go through an existing
`src/lib/db/commands/*` command (which owns the offline envelope + idempotency + `friendlyRpcError`),
never a raw `sb.from().insert()`. Plain dimension edits (a `plots` row) may use the direct-table action
idiom already in `src/lib/actions/plots.ts`. The audit's "Connects to" column names the RPC/table.

### 3.2 DRILL binding (computed value → editable source)

```tsx
// a Costing KPI tile showing a derived cost/kg
<EntityLink kind="lot" id={lot.code} anchor="cost-entries"
            className="block …kpi-tile…">
  <span className="…">{usd(costPerKg)}/kg</span>      {/* mv_lot_cost — not editable */}
</EntityLink>
// → /lots/JC-712#cost-entries : the editable cost_entry rows that PRODUCE the number
```

When the computed value aggregates many entities, DRILL targets a filtered list route instead:
`<Link href="/inventory?status=resting">`. The list page reads the filter from `searchParams` and each
of ITS rows is then NAVIGATE (§3.3) — the drill terminates at editable records, satisfying "everything
leads to real editable data."

### 3.3 NAVIGATE binding (entity row/card → dossier)

```tsx
// Dashboard PlotHealth row / Plots card / Map polygon / Harvests picker row / etc.
<EntityLink kind="plot" id={plot.id} className="block …existing card classes…">
  {/* unchanged card markup */}
</EntityLink>
```

The **Map polygon DEAD click** (the audit's one true DEAD element,
`src/components/islands/FarmMap.client.tsx`) resolves here: the MapLibre `click` handler reads the
feature's `plot_id` property and does `router.push(entityHref.plot(plotId))` — the imperative form of
`EntityLink` (same `entityHref` SSOT, since a canvas polygon can't be a JSX `<Link>`).

The **`CREWS` MOCK-DATA leak** (`worker-form.tsx`, `crew-board.tsx`) is not a smart-bar element but is
fixed by the same principle: the crew `<select>` reads live `crews` via a getter (facet 02 / slice-02),
and each crew card becomes `EntityLink kind="crew"`.

---

## 4. Success → reactive refresh contract (the "everything connects" half)

A write is not done when the row lands — it is done when **every downstream view updates with zero
re-entry** (PRINCIPLE.md Rule 3). This is already how the repo propagates: writes append to the
`lot_event` spine / dimension tables, derived numbers live in VIEWs/MATVIEWs (`season_summary_view`,
`v_weigh_today_by_picker`, `mv_lot_cost`, `v_plot_phi_status`), and the Server Action calls
`revalidatePath` so Server Components re-fetch. The smart-bar standardizes the **invalidation surface**
so no slice forgets a downstream consumer.

### 4.1 `src/lib/revalidate.ts` — the reactive-refresh SSOT

```ts
"use server";  // (co-located helper, imported by actions)
import { revalidatePath } from "next/cache";

/** Map an entity/event kind → the full set of routes whose VIEWs read it.
 *  ONE place the cross-tab ripple is declared, so a write can't silently
 *  leave a downstream tab stale (the "wrong auto-ripple I won't notice" fear, J1). */
export const RIPPLE: Record<string, readonly string[]> = {
  "weigh-in":   ["/weigh", "/", "/harvests", "/costing", "/inventory"], // tally+Dashboard+COGS
  "qc-hold":    ["/qc", "/inventory", "/dispatch"],                     // un-sellable everywhere
  "spray":      ["/scouting", "/map", "/plan", "/satellite"],           // PHI surfaced
  "plot":       ["/plots", "/", "/map"],
  "disbursement":["/payroll", "/costing"],                              // payroll IS labor COGS
  // … one row per write kind, derived from the audit's "Connects to" graph
};

export function reactiveRefresh(kind: keyof typeof RIPPLE) {
  for (const route of RIPPLE[kind]) revalidatePath(route);
}
```

Every Server Action calls `reactiveRefresh("<kind>")` instead of ad-hoc `revalidatePath` lists (today
`plots.ts` hand-writes `["/plots","/"]`). The `RIPPLE` map is the machine-readable form of the audit's
cross-tab connectivity graph and the testable artifact behind the J1/D4 "cross-tab reactive proof."

### 4.2 Optimistic + reactive layering

`useActionState` already gives the pending → success transition (the EDIT/CREATE form's own optimistic
UI). The **server** revalidation is the source of truth that lands the ripple in sibling tabs on next
navigation. Where a same-page optimistic update is wanted (the Weigh tally, US-01 walking skeleton),
the existing local-optimistic tally stays AND the page re-reads `v_weigh_today_by_picker` on
revalidation — the slice surfaces the reconciliation as the "ripple landing" proof panel (D4). No new
realtime/websocket mechanism is introduced ($0 / offline-safe rail holds).

---

## 5. Test-first contract (every smart-bar PR ships a test, written first)

Per CLAUDE.md (no UI exemption), each binding ships its test before the wiring. The shared primitives
make the tests uniform:

| Primitive / binding | Test layer | Asserts (red first) |
|---|---|---|
| `EditDialog` | render/smoke (jsdom + RTL) | trigger opens Dialog; `onDone` closes; ESC closes (reuses `dialog.test.tsx` harness) |
| `SmartForm` | render + reducer | renders fields; on `{status:"success"}` shows success pane + `href` link; on `{status:"error"}` surfaces field + `role="alert"` message; idempotency hidden input present when `idempotent` |
| `EntityLink` / `entityHref` | unit | `entityHref.plot("p1") === "/plots/p1"`; encodes ids; `anchor` appends `#…`; renders `<a href>` with `aria-label` |
| EDIT/CREATE binding | action unit (by-shape, no route import — `disbursement-form.client.test.tsx` idiom) | valid FormData → command called once with snake_case envelope → `{status:"success"}`; invalid → `{status:"error", errors}` and command NOT called |
| `reactiveRefresh` / `RIPPLE` | unit (mock `revalidatePath`) | `reactiveRefresh("weigh-in")` invalidates exactly the J1 route set; **a guard test asserts every `RIPPLE` route is a real `src/app/(app)/…/page.tsx`** so a renamed tab can't silently drop a downstream consumer |
| NAVIGATE/DRILL element | render | the (formerly COSMETIC) row renders an `<a href=…>` to the expected dossier (catches regressions to dead UI) |

A cross-cutting **"no dead UI" guard test** (one static script, `src/lib/__tests__/no-dead-ui.test.ts`)
greps the rendered element inventory for the smart-bar markers and asserts the DEAD count stays 0 and
the `@/lib/data/*` import count stays 0 — the machine enforcement of the north-star KPIs
(`outcome-kpis.md` guardrails), so a future slice can't reintroduce a dead click or a mock read.

---

## 6. Slice mapping (which slice owns which primitive)

So the DELIVER fleet stays file-disjoint:

- **slice-01 (US-01, walking skeleton)** introduces `reactiveRefresh`/`RIPPLE` (weigh-in kind) and the
  cross-tab proof panel — proves the success→refresh half end-to-end on the live spine.
- **The smart-bar primitives** (`edit-dialog.tsx`, `smart-form.tsx`, `entity-link.tsx`,
  `form-field.tsx`, `revalidate.ts`) are a **single contract PR landed before the per-tab slices**
  (they are the shared files; one author, then the row-wiring slices fan out wide against them). This
  mirrors CLAUDE.md "one author for shared/contract files, reviewer pass to close."
- **slices 02–08** each apply §2's procedure to their tab's audit rows, importing the primitives:
  - 02 → `EntityLink kind="crew"` + live crews (kills MOCK leak)
  - 03 → `EntityLink kind="plot"` everywhere + Map imperative `router.push(entityHref.plot)` (kills DEAD click)
  - 04 → `EntityLink kind="worker"`
  - 05 → ⌘K jump reuses `entityHref` SSOT
  - 06/07 → DRILL/NAVIGATE on PHI + QC-hold surfaces, `reactiveRefresh("spray"|"qc-hold")`
  - 08 → Satellite COSMETIC cards → `EntityLink kind="plot"` (depends on 03's dossier)

---

## 7. Acceptance (this facet is done when)

1. Five contract files exist with passing tests written first; existing forms untouched (flag-don't-fix).
2. Every non-`WIRED`, non-intentional-STUB row in `wire-up-audit.md` has an assigned verb (EDIT /
   CREATE / DRILL / NAVIGATE) and a concrete binding citing a real RPC/table/route.
3. `entityHref` is the sole source of dossier route shapes; `RIPPLE` is the sole source of
   cross-tab invalidation; `FIELD`/`LABEL` glass styling has one home.
4. The "no dead UI" guard test holds DEAD=0 and `@/lib/data/*` reads=0 on production paths.
5. World-class craft inherited for free: every EDIT/CREATE uses the finalized portal-fixed glass
   `Dialog` (focus trap, ESC, reduced-motion, WCAG-AA already solved); every NAVIGATE/DRILL is a real
   `<a href>` (keyboard + screen-reader reachable, prefetch-controlled).
