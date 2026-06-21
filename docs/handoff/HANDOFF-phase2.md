# HANDOFF — Janson Coffee farm-ops, Phase 2 (2026-06-21 ~11:00)

## ⚡ LATEST: ALL OF PHASE 2 IS ON `main` (`d20e033`)
All 10 slices (foundation S0/S1/S3/S4/S6/S8 + dependent S2/S5/S12/S7) merged to `main` + pushed (auto-deploying). 9 phase-2 migrations, 10 routes (/crew /weigh /ferment /drying /qc /plan /dispatch /satellite /scouting /payroll), 1880 tests. Design docs + handoff vaulted in `docs/design/` + `docs/handoff/`. **So the "build + integrate" parts of the queue below are DONE — pick up at: (A) finish the mega-review (verify the 203 findings → fix), (B) push phase-2 schema to prod + smoke test, (C) multi-tenant P4-S0, (D) phase 3.** `unset SUPABASE_ACCESS_TOKEN` before supabase CLI; prod `db push` needs Andres's approval.

---


Continue **exactly** here. This repo is Andres's $0/no-CI practice+portfolio app for his family's
real coffee farm (Janson Coffee, Volcán, Chiriquí, Panamá). Quality bar: world-class liquid-glass UI,
test-first, $0, **max parallelism (Rule #1)**. Brand forest `#00291D`.

Repos/paths:
- Main repo: `/Users/andres/coffee-farm-operations` (origin `github.com/AndresPonce507/coffee-farm-operations`)
- Primary working worktree (on `main`): `/Users/andres/coffee-farm-operations-worktrees/phase1-deliver`
- Agent isolation worktrees: `/Users/andres/coffee-farm-operations/.claude/worktrees/agent-<id>`
- Design docs (reconciled to real schema): `~/janson-coffee-PHASE2-DESIGN.md`, `PHASE3-DESIGN.md`, `PHASE4-DESIGN.md`
- In-repo roadmap: `docs/ROADMAP.md`

---

## CRITICAL GOTCHAS (read first)
1. **`unset SUPABASE_ACCESS_TOKEN` before EVERY `supabase` CLI call** (a stale env token returns Unauthorized; the keychain token from `supabase login` is valid).
2. **Auto-deploy is LIVE**: pushing to `main` auto-deploys to `janson-coffee.vercel.app` via the Vercel↔GitHub app (project `janson-coffee`, GitHub app installation `124559119`). No manual `vercel --prod` needed.
3. **Prod DB migration push is BLOCKED by the auto-mode classifier** — `supabase db push` to prod needs explicit user approval OR a Bash allow-rule. This is intentional right now: phase-2 schema is **held off prod until after the review**.
4. **Schema-truth rule**: the original design docs referenced `farm_id` / `app.apply_farm_rls()` that **DO NOT EXIST** — real phase-1/2 posture is **authenticated-only RLS** (`using(true)` to authenticated, anon revoked globally). The docs are now reconciled. Match the on-disk posture; no `farm_id` until P4-S0.
5. **vitest db project `hookTimeout`=60000** (in `vitest.config.ts`) — needed as migrations stack; keep it.
6. Background agents + workflows are **session-bound** — they die when this session ends. Only **committed branches** survive (see status below).
7. Cron loop `329054e3` (every 5 min) drives the phase-2 work; **CronDelete it** when phase 2 is fully done.
8. git author email in worktrees = `andresponce0001@gmail.com` (works for GitHub push).

---

## DECISIONS LOCKED (by Andres)
- **Multi-tenant: YES** — build the platform multi-tenant to license to neighboring Volcán estates. Lands as **P4-S0 right after phase 2, BEFORE phase 3** (so phase-1+2 tables get tenant-scoped in one pass; no retrofit).
- **Phase 3 start: WAIT for phase 2** (+ multi-tenant). Do NOT start the phase-3 build until then.

---

## STATUS

### ✅ Phase 1 — DONE, on `main`, LIVE on prod
All slices + pipeline-UI + review fixes + prod smoke-test fixes. 8 migrations on prod Supabase. Auto-deploying.

### 🔄 Phase 2 — IN PROGRESS

**Foundation wave (6 slices) — ON `main` (`77ca8a7`), 1,417 tests green. NOT on prod yet.**
Migrations `20260622090000`(S1 crew) `092000`(S3 ferment) `094000`(S4 drying+reposo) `096000`(S6 QC) `100000`(S8 planning); S0 offline = no migration. Routes: /crew /ferment /drying /qc /plan (+ S0 sync pill).

**Dependent wave (4 slices):**
| Slice | Branch | State |
|---|---|---|
| S2 weigh-capture | `worktree-agent-ab9202842473a6af1` (`0db70ec`) | ✅ **committed** (mig `102000`, 1491 tests) |
| S12 satellite/IPM | `worktree-agent-a14242917968d1e20` (`5cfcb19`) | ✅ **committed** (mig `106000`, 1511 tests) |
| S5 morning dispatch | branch **`claude/p2-s5-crew-dispatch`** (`96b24a4`) [worktree `.claude/worktrees/agent-ab3e86a91c9d7dc08`] | ✅ **committed** (mig `104000`) |
| S7 payroll + min-wage guard | `claude/p2-s7-payroll` | ✅ **committed** (mig `108000`; un-bypassable make-whole guard — generated cols + BEFORE-INSERT trigger overwrites floor + CHECK; 1634 tests) |

**ALL 4 DEPENDENT SLICES COMMITTED.** A **dependent-wave integration agent** (`a71edadfe1b17951e`) is merging them onto branch `claude/phase2-dependent-integration` (off `main` `77ca8a7`): merges S2/S5/S12/S7, additive-union of shared `sidebar.tsx`/`types.ts`/`seed.sql`, gates the combined 9-migration replay. **When it reports GREEN → `git checkout main && git merge claude/phase2-dependent-integration && git push origin main`** (auto-deploys). NOTE: `main` advanced to `4d8e7d4` (a docs-only commit vaulting the design docs into `docs/design` + `docs/handoff`), so use a plain `git merge` (NOT `--ff-only`) — docs vs the integration's src/supabase files are disjoint → clean merge commit. If the agent died mid-run, check the branch; if not green, re-run the merge (same 4 branches, additive-union conflicts).

**🔄 Mega-review (100+ agents)** — Workflow `wbv4vm8w9`, run `wf_a1017aa5-fcb`. 42 finders (6 slices × 7 dims: security · invariant-bypass · migration · rpc · ui · feature-gap · test) + adversarial verify (2 skeptics CRIT/HIGH, refute-by-default) → synthesize confirmed by severity.

**✅ SNAPSHOT FROZEN → `~/HANDOFF-phase2-review-snapshot.json`** — the **find phase is 100% COMPLETE** (all 42 finders produced output). The snapshot holds **203 deduped RAW findings** (23 CRIT · 65 HIGH · 84 MED · 30 LOW — UNVERIFIED; expect ~30–40% to be refuted, per phase-1). Verification was only ~7 verdicts in when frozen.
**→ The new session does NOT re-run the finders.** Instead: load the 203 findings from the snapshot JSON, run an ADVERSARIAL VERIFY-ONLY pass (2 skeptics per CRIT/HIGH, 1 per MED, default isReal=FALSE, reproduce against the real code/SQL before confirming), then FIX every confirmed finding test-first. The original review script (for the verify/schema shapes to copy) is at:
`/Users/andres/.claude/projects/-Users-andres-coffee-farm-operations-worktrees-phase1-deliver/1e54f450-de58-44f6-9007-4d4288d82c69/workflows/scripts/phase2-mega-review-wf_a1017aa5-fcb.js`
(`resumeFromRunId` is same-session-only, so it won't resume cross-session — verify-from-snapshot is the path.) NOTE: finder `slice` labels are inconsistent (e.g. "S3" vs "S3 fermentation") — normalize on the leading `S<n>`.

**✅ Phase-3/4 design reconciliation — DONE.** Both docs now schema-accurate + tenant-aware-ready. Key finding: most of phase 3 is phase-1-buildable (only milling needs phase-2 reposo).

---

## PENDING QUEUE — exact next steps (in order)

1. **Recover in-flight work.** Check `git log --oneline -1 worktree-agent-ab3e86a91c9d7dc08` (S5) and `git -C /Users/andres/coffee-farm-operations-worktrees/p2-s7-payroll log --oneline -1` (S7). If a branch advanced past its base → it committed, use it. If NOT → re-dispatch that slice (prompts in the chat transcript / from `~/janson-coffee-PHASE2-DESIGN.md` §P2-S5 / §P2-S7; S7 builds off S2's branch `worktree-agent-ab9202842473a6af1`; the **min-wage make-whole guard must be un-bypassable at the DB**). Same for the mega-review (re-run if it didn't report).

2. **Mega-review → FIX.** When the review reports confirmed findings (CRIT/HIGH/MED), fan out **test-first** fixes (file-disjoint agents, fix-per-finding), re-gate (`npx vitest run` + `tsc --noEmit` + `npm run build`), commit.

3. **Integrate the dependent wave to `main`** (orchestrator owns merges — one serialized integration agent, like the foundation). Merge S2 (`worktree-agent-ab9202842473a6af1`) + S5 + S12 (`worktree-agent-a14242917968d1e20`) + S7 (`claude/p2-s7-payroll`) onto a `claude/phase2-dependent-integration` branch off `main`. Resolve shared-file conflicts as **additive union**: `sidebar.tsx` NAV (each adds /weigh /dispatch /satellite /scouting /payroll), `src/lib/types.ts`, `supabase/seed.sql`, `vitest.config.ts`. Keep ALL migrations (distinct timestamps 102000/104000/106000/108000). **Gate the combined migration replay.** Also wire the flagged cross-slice follow-ups: S12's `v_plot_phi_status` into S8's harvest planner; S12 NDVI → S8 `plot_phenology.ndvi_latest`; add seed rows for S5/S12. Then ff-merge to `main`.

4. **Run the mega-review on the dependent wave too** (S2/S5/S12/S7) — same find→verify→fix treatment (adapt the saved review script's SLICES map).

5. **Land all phase-2 fixes on `main`** (auto-deploys the code).

6. **Push phase-2 schema to PROD** — `unset SUPABASE_ACCESS_TOKEN; supabase db push` (5+ migrations). **NEEDS ANDRES'S APPROVAL** (classifier blocks it). Then **smoke-test every phase-2 surface on prod** (drive `janson-coffee.vercel.app` in Chrome — /crew /weigh /ferment /drying /qc /plan /dispatch /satellite /scouting /payroll + the offline sync pill), note every console error / render bug / stacking issue / a11y, FIX all, re-verify. (Smoke-test lesson from phase 1: the shared `Dialog` was fixed to portal to `<body>` — verify new modals use it, not a roll-their-own overlay.)

7. **Then `CronDelete 329054e3` + PushNotification** "phase 2 fully done".

8. **THEN multi-tenant P4-S0** (task #16 — the RLS rewrite, tenant_id on all ~30 phase-1+2 tables, guard `mv_lot_cost` matview, cross-tenant probe test). **THEN phase 3** (tenant-aware) → phase 4.

---

## KEY INVARIANTS to protect (the review hunts these)
Reposo gate (S4: can't mill until moisture-stable+rested — RPC + trigger backstop) · QC-hold (S6: held lot can't be reserved/shipped) · min-wage make-whole (S7: piece-rate topped up to minimum, DB-enforced) · cert+PHI/REI spray gate (S12) · oversell (phase-1 prevent_oversell) · all ledgers append-only/hash-chained · AD-8 grants (nothing to anon) · injection (dispatch inbound never drives a write).

## Open task list (TaskList): #13 dependent wave · #14 mega-review+fix · #15 prod smoke test · #16 multi-tenant P4-S0.
