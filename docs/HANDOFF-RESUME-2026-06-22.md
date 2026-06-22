# HANDOFF — Resume Point · 2026-06-22
## Janson Coffee farm-ops · P4-S0 multi-tenant + Phase 5 "Connected Estate"

> Written when the prior session committed + pushed everything before a computer reset.
> **Repo:** `github.com/AndresPonce507/coffee-farm-operations`. Everything below is on `origin`.
> **Two streams are IN-FLIGHT** (both WIP, both pushed). To resume: check out the branch, read its WIP
> commit message + this doc, continue. Say **"resume P4-S0"** or **"resume Phase 5"**.

---

## 0. TL;DR
| Stream | Branch @ commit | State | Next action |
|---|---|---|---|
| **DONE** | `main` @ `1f49160` | W1 + W3 + S12 phase-2 fixes — **LIVE on prod** | — |
| **A · P4-S0** | `claude/p4s0-multitenant` @ `0a9b27c` | multi-tenant RLS retrofit; build + most fixes done | finish 8 RPC clamps in M3 → re-verify → re-review → gate → main → **Andres-gated** prod push |
| **B · Phase 5** | `claude/phase5-deliver` @ `e1f892e` | L0 skeleton GREEN; L1 contracts WIP | finish L1 → L2 dossiers → L3 (~100-wide) → L4 → main |

Both branches are off `main` (`1f49160`). Worktrees: `~/coffee-farm-operations-worktrees/{p4s0-multitenant,phase5-deliver}` (re-create with `git worktree add` after a wipe; `npm ci` in each).

---

## 1. DONE — on `main` + prod (context)
Phase-2 review fix-and-land shipped this session: **W1** (dependent-wave CRIT/HIGH: payroll min-wage make-whole floor, disbursement exactly-once, rate_basis, dispatch, payroll write-UI), **W3** (Phase B 36 MED/LOW), **S12** (PHI/REI spray gate + the `20260623110000_phi_planner_gate` migration + cert + device ports). All merged to `main` (`1f49160`), the **11 phase-2 migrations pushed to the prod Supabase DB**, smoke-verified (`/plan` + `/payroll` load real data). ~92.5K LOC, 2,381 tests green.

---

## 2. STREAM A — P4-S0 Multi-Tenant (resume here)

### What it is
The foundational multi-tenant slice: add `tenant_id` to all ~50 phase-1+2 tables in one pass so everything is born tenant-scoped. **Decision locked: PER-TENANT lot codes** (composite `(tenant_id, code)` keys). Plan: `docs/design/P4-S0-multi-tenant-plan.md` (68KB, on main). It's the **highest-stakes migration in the roadmap** — a bug = one farm reads/writes another farm's data.

### State now (branch `claude/p4s0-multitenant` @ `0a9b27c`)
- 3 staged migrations: `supabase/migrations/20260701090000_tenant_add_nullable.sql`, `091000_tenant_backfill.sql`, `092000_tenant_enforce_rls.sql` (**"M3"**).
- Cross-tenant probe test `src/test/db/p4s0_tenant_isolation.db.test.ts` + SSOT `src/test/db/tenantTables.ts` (48 scoped tables) + `asTenant()` in `pgliteHarness.ts`.
- The adversarial 6-lens review found **18 leaks (15 CRIT/HIGH)** — full list in `p4s0-leaks.json` (committed to this branch). Fixes applied: RPC tenant-clamps + `revoke select on mv_lot_cost/_by_rule from authenticated` + ledger rebinds — **in M3** (so they reach prod). 6 RPCs are correctly clamped in M3.
- ⚠️ **phase-2 migrations were reverted to original** (they're already on prod; editing them is inert there and makes tests lie). The schema is now **prod-faithful**.

### 🔴 The OPEN item (do this first)
The prod-faithful db suite (`npx vitest run --project db`) shows **8 failing isolation assertions** — these 8 SECURITY DEFINER write-RPCs were clamped only in the (now-reverted) phase-2 edits, NOT in M3, so they'd **still leak on prod**:
`rehire_worker`, `enroll_crew_member`, `mark_dispatch_sent`, `record_weigh_in`, `assign_drying_station`, `record_moisture_reading`, `compute_pay_period`, `eudr_declare_plot`.

**Fix:** for each, read its original def in its phase-2 migration, add a `create or replace function …` of it **in M3** (`20260701092000`) with the standard clamp: `v_tenant uuid := current_tenant_id(); if v_tenant is null then raise … insufficient_privilege; end if;` then tenant-qualify every existence-SELECT / UPDATE-DELETE predicate / idempotency lookup / cross-table resolve with `and tenant_id = v_tenant`. Match how M3 already clamps `advance_processing_stage`/`approve_pay_line`. **Do NOT edit phase-2 migrations.** (A focused agent was mid-doing this when stopped — `mark_dispatch_sent`'s clamp was reasoned out; redo cleanly.)

### Then (the gate to prod)
1. `npx vitest run --project db` → all 8 GREEN + entire db project green (763 tests) with phase-2 migrations UNEDITED.
2. **Re-run the 6-lens adversarial cross-tenant review** (read/write-RPC/matview-ledger/lotcode/parity/regression). Standing rule: **two consecutive clean rounds (0 CRIT/0 HIGH)** before landing — one isn't enough on an RLS rewrite. The hardened probe must catch each leak class (raw matview read, unclamped RPC, ledger braiding) red→green.
3. Commit, gate (`npm run build` + `npm run test` green), merge to `main`.
4. **PROD PUSH IS ANDRES-GATED.** When approved: verify what's applied on prod first (expect the `supabase migration repair --status applied <ts>` gotcha — see §4), `supabase db push` (password in Keychain "Janson Coffee Supabase DB"), then **immediately smoke** that the app still loads as the single "Janson Coffee" tenant (the §3 single-tenant fallback in `current_tenant_id()` is what keeps it working).

---

## 3. STREAM B — Phase 5 "The Connected Estate" (resume here)

### The mandate (north star — `docs/feature/phase-5-connected-estate/PRINCIPLE.md`)
Make **every existing tab deeper** AND **self-connecting**. **"No dead UI"**: every clickable element is a real CREATE/EDIT surface (modal/form wired to a command-RPC) or drills to its editable source or navigates to a connected dossier — **no mock data, no cosmetic controls, no dead clicks**. Every write flows into the reactive graph; every entity is clickable → its dossier. **Goal: the best coffee-farm software in the world.**
- **Smart bar (resolved):** raw field → edit modal · computed value → drill-to-source · cosmetic → wire/delete.
- **All 7 entity dossiers:** Lot, Plot, Worker, Crew, Batch, Dispatch-run, Pay-period.
- **The audit found** (`discuss/wire-up-audit.md`): ~307 elements → **~88 COSMETIC + 6 MOCK (`CREWS`) + 1 DEAD (Map polygon)** to fix; the deep dossiers `/lots/[code]`, `/ferment/[batch]`, `/qc/cup/[lot]` exist but are orphaned.

### State now (branch `claude/phase5-deliver` @ `e1f892e`)
- **L0 walking skeleton — GREEN + committed (`c9dba54`).** `src/lib/revalidate.ts` (RIPPLE map + reactiveRefresh), `ripple-proof.tsx`, weigh-capture threading, db spine-guards. Build green, 2,322 tests. The reactive spine is proven (one weigh ripples to ≥2 consumers, machine-checked). *Caveat flagged:* surfacing the lot link on the live online capture path needs offline-runtime plumbing (`enqueueCommand`/`outbox`/`sync`/`runtime`) — a follow-up slice.
- **L1 shared contracts — WIP** (committed as `9b2c0a5`, interrupted). F-A/F-B/F-C were mid-build.
- Full spec on the branch: `docs/feature/phase-5-connected-estate/` (DISCUSS feature-delta, wire-up-audit, slices/, DESIGN ARCHITECTURE.md + 5 facets + REVIEW-adversarial.md, PRINCIPLE.md) + `docs/product/` (SSOT jobs+personas).

### The build plan (`design/05-build-plan.md` — follow it exactly)
```
L0 weigh-ripple proof   ✅ GREEN (c9dba54) — gate-0 passed
L1 3 shared contracts    🟡 WIP — F-A revalidate guard · F-B smart-bar primitives + entityHref SSOT · F-C dossier shell → REVIEWER-1
L2 7 dossier routes      ⬜ plot/worker/crew/dispatch/pay-period (NEW) + lot/ferment/cup (wire-in); people.ts = ONE author
L3 ~100-WIDE blitz       ⬜ one agent per (tab × verb); kill ~88 cosmetic + 6 mock + 1 dead; rolling reviewers
L4 cross-tab guards      ⬜ PHI everywhere · QC-hold un-sellable · deepen Satellite → FINAL audit
```
**Hard serialization points:** L0→L1 (skeleton first), L1→L2/L3 (freeze the contract files before 100 agents import them). Key contract decisions already resolved: `entityHref` SSOT = `src/lib/dossier/entity-href.ts`; reactive helper = `src/lib/revalidate.ts`; `SmartActionState` ⊃ existing `ActionState`; `people.ts` single-authored. DESIGN review found 13 gaps (3 CRIT) to fix during build — e.g. `record_disbursement` writes `cost_entry` but never `refresh_lot_cost()` → stale `/costing` matview; a *third* mock importer `src/lib/geo/seed-geometry.ts:11` (the `no-mock-reads` guard must target it too).

### Resume steps
1. Finish L1 (3 contracts, test-first, file-disjoint) → REVIEWER-1 → commit + gate.
2. L2 (7 dossier agents, parallel) → REVIEWER-2 → gate.
3. **L3 — the ~100-wide blitz** (one agent per tab×verb cluster, file-disjoint by `src/components/sections/<tab>/`) → rolling REVIEWER-3.
4. L4 (PHI/QC-hold/Satellite) → REVIEWER-4 → **FINAL audit re-run** = 100% wired / 0 mock / 0 dead / 17 tabs deep / every dossier reachable / ≥4 links per dossier, **2 consecutive clean rounds** → merge `main`.
**KPIs:** clickables wired 80%→100%, mock reads → 0, dead clicks → 0, dossier reachability 0→100%.

---

## 4. Critical gotchas / learnings (don't relearn these the hard way)
1. **Test-green ≠ prod-safe (the prod-faithful trap).** Editing a migration that's ALREADY ON PROD only fixes the PGlite test replay, not prod (the migration won't re-run). All P4-S0 fixes MUST live in the NEW migrations (M3 `create or replace`). To verify: revert phase-2 edits, re-run the suite; if it stays green every fix is in M3. (This caught 8 RPCs that would have leaked on prod.)
2. **`migration repair` gotcha (prod push).** The phase-2 prod push hit `policy already exists` because the security audit shipped objects (`app_members`, `is_member`) to prod **out-of-band via direct SQL, not recorded in `schema_migrations`**. Fix: `supabase migration repair --status applied <ts>` (after verifying the objects exist), then re-push. Expect the same on the P4-S0 push.
3. **API overload kills agents.** Three agents crashed/aborted this session on `ConnectionRefused`/overload. Don't run a big fan-out concurrently with another big fan-out. Schema work is single-author/serial anyway. When the API is flaky, keep concurrency low; a `resumeFromRunId` on a Workflow re-runs only the crashed agent.
4. **User-message interrupts abort background agents.** Interrupting mid-turn cascades an abort to running workflow agents. Fresh messages between turns are fine.
5. **In-place migration edits are correct ONLY for not-yet-on-prod migrations** (the P4-S0 band 20260701xxx). Phase-2 (20260622xxx) and earlier are on prod → use `create or replace` in a new migration.

## 5. Standing rules (how to work — from CLAUDE.md + memory)
- **Always maximize parallelism — 100+ agents** for substantive work, file-disjoint or worktree-isolated, **one schema author** for migrations, a **reviewer pass** closes every fan-out, **phased gate** before landing. (Project RULE #1.)
- **Test-first on every PR, no exemptions** (UI gets a render/smoke test). Bug → regression test same commit.
- **World-class liquid-glass UI inside every slice** (60fps, reduced-motion, WCAG-AA on the cream/animated bg, mobile/glove, es-PA-first). `$0`/offline-safe.
- **No-CI repo:** the gate = `npm run build` + `npm run test` green, run locally, before any merge to `main`.
- **`main` direct-merge is OK** for this solo repo; **P4-S0 prod push is Andres-gated** (auth/permission + schema-breaking → human yes).
- Roadmap order (Phase 5 pulled ahead of commerce): **P4-S0 → Phase 5 → Phase 3 (monetize) → Phase 4 (intelligence + conservation moat)**; Phase 6 (predictive) last.

## 6. Resume commands
```bash
# P4-S0
git -C ~/coffee-farm-operations worktree add ~/coffee-farm-operations-worktrees/p4s0-multitenant claude/p4s0-multitenant 2>/dev/null
cd ~/coffee-farm-operations-worktrees/p4s0-multitenant && npm ci
# → finish the 8 RPC clamps in supabase/migrations/20260701092000_tenant_enforce_rls.sql (see §2 + p4s0-leaks.json)
npx vitest run --project db        # 8 isolation assertions must go green

# Phase 5
git -C ~/coffee-farm-operations worktree add ~/coffee-farm-operations-worktrees/phase5-deliver claude/phase5-deliver 2>/dev/null
cd ~/coffee-farm-operations-worktrees/phase5-deliver && npm ci
# → finish L1 per docs/feature/phase-5-connected-estate/design/05-build-plan.md §3, then L2 → L3 → L4
npm run build && npm run test
```
