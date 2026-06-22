# Phase 5 — "The Connected Estate" · THE NORTH STAR

> Canonical product principle for Phase 5. Every wave (DISCUSS → DESIGN → DELIVER) and every
> slice, story, and PR obeys this. Set by Andres, 2026-06-22. If any artifact or build contradicts
> it, the artifact is wrong.

## The mission
**Build the best coffee-farm-operations software in the world.** Not a demo, not a portfolio piece
that "looks" like an app — a real operating system for a working specialty-coffee estate.

## The five rules (non-negotiable)

1. **No dead UI. Nothing is "for show."**
   Every clickable / interactive element on every one of the 17 tabs is a real, working surface.
   If you can click it, it does something real.

2. **Every clickable is a real CREATE or EDIT surface.**
   Clicking opens an actual way to write or change data — a modal, a form, or an inline editor —
   wired to the SECURITY DEFINER command-RPC write door. **No mock data. No placeholders. No
   TODO. No cosmetic-only controls.** Reading is the floor; *editing and creating real records is
   the expectation.*

3. **Everything connects.**
   Every write flows into the reactive graph and updates every downstream number, view, and dossier
   with **zero re-entry**. Every entity (lot, plot, worker, crew, batch, pay-period, spray,
   drying-station, lot-code…) is itself clickable → its full connected dossier across every tab.

4. **Every tab gets materially deeper.**
   No tab stays a thin/demo view. Each becomes a genuine operating surface with the depth a real
   farm manager needs day to day.

5. **World-class craft on every surface.**
   Apple-grade liquid-glass, 60fps, reduced-motion-aware, WCAG-AA on the real background,
   mobile-first/glove-friendly, sensible loading/empty/error states — *inside every slice*, not a
   later polish pass. Plus the standing rails: test-first, $0/offline-safe, es-PA-first.

## The acceptance test (apply to every element on every screen)
For any control on any screen, answer: **"What happens when I click this, and where does that data
go?"**
- A good answer is concrete: *opens an edit/create modal that writes table X via RPC Y → which
  updates dashboard/COGS/dossier Z.*
- If the answer is **"nothing"**, **"it's just visual"**, or **"it shows mock data"** → that's a
  **defect** to fix in Phase 5, not acceptable behavior.

## Resolved interpretation (Andres, 2026-06-22 — applies Rule 2 in practice)
- **Smart bar for "every clickable is a create/edit surface":**
  - **Raw entity / editable field** → clicking opens a real **create/edit modal** (the default).
  - **Computed / derived value** (a sum, a COGS, a cup score, a chart) → you can't edit a derived
    number; clicking **drills to the editable source records** that produce it (you reach what you
    CAN edit). This still satisfies "no dead UI — everything leads to real editable data."
  - **Truly cosmetic** → wire it to one of the above, or delete it. Never leave it inert.
- **Dossiers for ALL entities:** Lot, Plot, Worker, Crew, Batch **and** Dispatch-run **and**
  Pay-period each get a full connected dossier page, reachable from anywhere the entity appears.

## How it governs the work
- The **wire-up audit** (`discuss/wire-up-audit.md`) catalogs every clickable element across all 17
  tabs and flags each `WIRED | STUB | MOCK-DATA | COSMETIC | DEAD`. Every non-`WIRED` row is a
  Phase-5 work item.
- **Every user story** ships a real create/edit capability + its wiring + a test proving the write
  lands AND the downstream connection updates.
- **Connectedness KPIs:** 100% of clickable elements wired to a real create/edit/navigate/trigger
  action; **0 mock-data reads** on production paths; every entity has a reachable dossier.
