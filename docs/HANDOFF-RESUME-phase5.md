# RESUME — Phase 5 (Connected Estate) · updated 2026-06-23

Authoritative resume doc. Branch `claude/phase5-deliver`. Read this + `docs/feature/phase-5-connected-estate/PRINCIPLE.md` + `docs/feature/phase-5-connected-estate/design/05-build-plan.md`.

## ▶︎ Where we are (one paragraph)
Phase 5 "Connected Estate" is **functionally complete** — all of L3 (wire every entity-bearing row to its dossier across all 17 tabs) and L4 (cross-tab guards) are built; the wire-up census is **0 cosmetic / 0 mock / 0 dead** with the 3 intentional STUBs preserved, and the `worker_id` view bug is fixed (migration + view-level PGlite test). It went through a full adversarial **nw-review** (rounds 1–4: data-path, security/tenant, correctness, a11y, craft, tests). A final **confirmation pass** (toward "2 consecutive clean rounds") was **interrupted mid-fix to commit on request**, so the **branch tip is currently RED**. The remaining work is small and mechanical: get the tip back to green, finish the 2-clean-rounds gate, push, and open the PR. **Phase 5 is NOT "done-done" yet** (tip red, review not closed to clean, no browser smoke, no PR, not merged).

## Status scorecard
| Layer | State |
|---|---|
| L0 skeleton / L1 contracts / L2 dossiers | ✅ done (pre-session) |
| L3 wiring (all 17 tabs + 7 dossiers) | ✅ done — 0 cosmetic / 0 mock / 0 dead |
| L4 cross-tab guards (phi / qc-hold / depth) | ✅ done |
| `worker_id` view fix (HIGH bug) | ✅ migration `20260701093000` + PGlite view test |
| nw-review rounds 1–4 + remediation | ✅ committed (`33aa585`) — was build+test GREEN (331 files / 2769 tests) |
| Confirmation pass (centralized a11y + reactiveRefresh-in-actions) | 🟡 committed RED WIP (`1fdfd9e`) — interrupted mid-gate |
| 2-consecutive-clean-rounds bar | ❌ not yet met |
| Browser smoke | ⛔ not run (needs Supabase creds — see below) |
| Pushed to origin / PR opened | branch push: see note; **no PR yet**; **never self-merge to main** |

## Commit state on `claude/phase5-deliver` (newest first)
- `1fdfd9e` **wip(phase5): confirmation-pass fixes — centralized a11y + reactiveRefresh in actions** ← **TIP, RED**
- `33aa585` fix(phase5): nw-review remediation — data-path, a11y, DRILL-anchor fixes ← **last VERIFIED-GREEN**
- `ade306e` fix(schema): track worker_id view migration + PGlite proof test
- `7dfdd6b` feat(phase5): finish L3+L4 connected-estate wiring — 0 cosmetic/0 mock/0 dead
- `a441fbc` Merge origin/main (brings in P4-S0 multi-tenant + the rule-removal) into the branch

## 🔴 The current RED (exactly what to fix to get back to green)
Interrupted confirmation pass left these (`npm run build` then `npm run test`):

1. **Build (type error):** `src/components/sections/pay-period/pay-period-lines-section.tsx:52` — `Type 'string | null' is not assignable to 'string | undefined'`. A fixer passed a nullable value into `EntityLink`'s `name?: string` prop. Fix: `?? undefined` (or guard). Sweep other `name={…}` sites the confirmation pass touched for the same pattern.
2. **19 failing tests across 11 files** — component↔test drift from (a) the EntityLink `name`/aria-label a11y change and (b) the `reactiveRefresh` rewrites in the Server Actions:
   - `pay-period/__tests__/pay-period-lines-section.test.tsx` (3)
   - `ipm/__tests__/spray-history.test.tsx` (4)
   - `dispatch/__tests__/dispatch-assignments-section.test.tsx` (2)
   - `plots/__tests__/plots-explorer.test.tsx` (2)
   - `app/(app)/eudr/__tests__/actions.test.ts` (2)  ← reactiveRefresh wiring changed the action; update expected calls
   - `crew/__tests__/crew-rehire-strip.test.tsx` (1)
   - `plots/__tests__/plots-table.test.tsx` (1)
   - `workers/__tests__/worker-productivity-section.test.tsx` (1)
   - `workers/__tests__/worker-attendance-section.test.tsx` (1)
   - `pay-period/__tests__/pay-period-disbursements-section.test.tsx` (1)
   - `pay-period/__tests__/pay-period-make-whole-section.test.tsx` (1)
   - Consistent root cause: a test asserts a link's accessible name / specific `aria-label`, or an action's `reactiveRefresh(kind)` call set. Reconcile each test with the (correct) new behavior — **do not revert the a11y/reactive fixes**; fix the test expectations (or the nullable). Test-first where a real behavior changed.

> Two clean resume options:
> - **(A, recommended) Fix forward** from `1fdfd9e` — the confirmation work is valuable (it caught that Server Actions weren't triggering the reactive graph for worker/task/processing-batch). Fix the ~20 reds → green.
> - **(B) Green fallback:** `git reset --hard 33aa585` returns to a verified-green tip but discards the actions-reactiveRefresh + centralized-a11y work (you'd redo it).

## What the confirmation pass added (preserve — it's real)
- **EntityLink** (`src/components/ui/entity-link.tsx`): optional `name` prop → `aria-label="Abrir <kind-es> <name>"`; when omitted, visible text is the accessible name (WCAG 2.5.3). Centralized focus-visible lives here (one fix vs ~16 sites).
- **`src/lib/revalidate.ts`**: `RIPPLE` extended with `worker` / `task` / `processing-batch` kinds + routes.
- **Server Actions** (`src/app/(app)/{harvests,qc,crew,dispatch,drying,eudr,ferment,inventory,payroll,plan,processing,weigh,costing}/actions.ts`): call `reactiveRefresh(kind)` so writes propagate (enforced by the `ripple-actions-wired` guard).

## To FINISH Phase 5 (resume checklist)
1. **Env:** repo at `~/Developer/coffee-farm-operations` on this Mac. Fresh machine: `gh repo clone AndresPonce507/coffee-farm-operations && cd coffee-farm-operations && npm install`; `git checkout claude/phase5-deliver`.
2. **Get green:** fix the build type error + the 19 tests above. `npm run build` exit 0 **and** `npm run test` all green, 0 unexpected skips. Guards `no-dead-ui` + `no-mock-reads` must stay active.
3. **2 consecutive clean rounds:** re-run adversarial review (per-tab + lenses: data-path, security/tenant, correctness, principle, a11y, craft, tests) → verify each finding → fix → re-gate, until two rounds in a row find 0 CRIT/HIGH/MED. (This session ran rounds 1–4; confirmation pass = round 5, unfinished.)
4. **Browser smoke (ideal):** app uses a REAL Supabase (`createServerClient`) and throws without `NEXT_PUBLIC_SUPABASE_URL` + `…ANON_KEY`. Either `.env.local` → local stack (`supabase start`, needs Docker/colima; Mac disk tight) or validate on the **Vercel preview** (repo auto-deploys `main`→ janson-coffee.vercel.app; a PR gets a preview). Click each dossier link + the Map polygon→plot; confirm no `/workers/undefined`.
5. **PR:** push `claude/phase5-deliver`, open PR → `main`. **Do NOT self-merge — Andres merges.** Merging `main` auto-deploys to Vercel. No DB to push (practice repo); migrations are repo-only.

## Guardrails (do not break)
- **$0 / no-CI / no paid services.** No GitHub Actions. Gate = local build + test.
- **Standing rule:** Claude never applies migrations to a prod DB — authoring the file is fine, a human applies. (Moot here — no prod DB; db tests replay migrations in PGlite.)
- **Contract files — import, don't fork:** `src/lib/dossier/entity-href.ts`, `src/components/dossier/*`, `src/app/globals.css`, `src/lib/data/*` (never import on a render path). `EntityLink` + `revalidate.ts` got deliberate additive changes this session — keep that discipline.
- **One schema author** for `supabase/migrations/*`; new timestamp must exceed `20260701093000`.

## Reference
- North star: `docs/feature/phase-5-connected-estate/PRINCIPLE.md`
- Build plan / layers: `docs/feature/phase-5-connected-estate/design/05-build-plan.md`
- Wire-up audit (work tickets): `docs/feature/phase-5-connected-estate/discuss/wire-up-audit.md`
- Repo: https://github.com/AndresPonce507/coffee-farm-operations · prod: https://janson-coffee.vercel.app
