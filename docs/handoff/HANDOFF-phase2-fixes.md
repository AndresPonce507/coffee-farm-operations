# HANDOFF — Janson Coffee, Phase-2 mega-review FIXES (2026-06-22, ~01:00)

Continue **exactly** here. This is the fix-and-land phase of the phase-2 mega-review. Foundation
CRIT+HIGH fixes are **on `main`**; the rest (dependent-wave fixes, foundation MED/LOW, S12 re-review,
prod) is queued and fully prepped. Quality bar unchanged: world-class, test-first, $0, max parallelism
**but throttle when the API is unstable** (see GOTCHAS).

## ⚡ ONE-LINE STATE
Foundation **Phase A (6 CRIT + 33 HIGH) is fixed, gated green, MERGED to `main` (`d767dcf`), auto-deploying.**
Remaining: dependent-wave fixes (86 confirmed, 17 CRIT — incl. min-wage + PHI gate), foundation Phase B
(MED/LOW), a proper **S12 re-review** (only 2 findings captured — infra kept killing it), a reviewer pass,
then prod push + smoke.

---

## PATHS
- **Repo / branches**: `github.com/AndresPonce507/coffee-farm-operations`. `main` = `d767dcf`.
- **Fix worktree** (do fix work here): `/Users/andres/coffee-farm-operations-worktrees/phase2-review-fix`
  on branch `claude/phase2-review-fix` (now == `main` after the merge; `node_modules` INSTALLED here).
- **Stable main read-ref** (review/probe agents read code here): `/Users/andres/coffee-farm-operations-worktrees/phase1-deliver`
  (on `main`). ⚠️ its local `main` is stale at `de91540` from a premature ff — run `git fetch && git reset --hard origin/main` there before using (NOTE: a hard reset needs a Bash allow; ask Andres).
- **Scratch (ALL review/fix artifacts, machine-local)**: `/Users/andres/phase2-review-scratch/`
- **Design docs (on main)**: `docs/design/P4-S0-multi-tenant-plan.md` (execute-ready), `docs/design/PHASE3*`, `~/janson-coffee-PHASE2-DESIGN.md`.

---

## ✅ DONE
1. **Verify phase (foundation S0/S1/S3/S4/S6/S8)** — 173 findings adjudicated, **156 confirmed**
   (6 CRIT · 33 HIGH · 65 MED · 52 LOW). Re-verification rescued **60 real defects** the rate-limited
   first pass had wrongly buried (incl. all reposo CRITs). Confirmed list: `scratch/fix-worklist.json`.
2. **Foundation Phase A fixes (6 CRIT + 33 HIGH)** — test-first across 16 file-disjoint owners.
   Gate: tsc clean · vitest **2023 pass** (after merging security PR #7) · build OK. **On `main` (`d767dcf`).**
   Headline: reposo gate now gates the milling **boundary** (drying→parchment→milled & drying→green
   bypasses closed, both layers); fermentation phantom-batch + cut-point task; verify_chain/por-obra/
   idempotency (S1); QC cupping scoresheet save-path + CVA math; `/plan` write UI.
3. **P4-S0 multi-tenant plan** — execute-ready, adversarially reviewed, on `main` (`docs/design/P4-S0-multi-tenant-plan.md`).
4. **Dependent-wave review (S2/S5/S7)** — `scratch/dependent-confirmed-merged.json` = **86 confirmed**
   (17 CRIT · 30 HIGH · 32 MED · 7 LOW): S2:22, S5:24, **S7:38**, S12:2.

---

## 🔜 REMAINING WORK (in order)

### 1. Dependent-wave FIX wave (S2/S5/S7) — PREPPED, ready to fire
- Owners grouped file-disjoint: **22 owners** in `scratch/depowners/owner-D*.json`; index `scratch/depowners-index.json`.
  14 have CRIT/HIGH.
- ⚠️ **`owner-D02` (payroll migration `20260622108000_payroll.sql`) is a 31-finding monster** (10 CRIT + 12 HIGH).
  Those CRIT/HIGH are ~4–5 ROOT issues with duplicate findings from two review runs:
  (a) **min-wage make-whole floor = $0 for piece-rate pickers** (floor derived from PAIRED clock-in/out hours;
  pickers never clock out → hours=0 → floor=0). Fix = derive floor from worked-DAYS (any weigh OR clock-in),
  `greatest(hours, worked_days × standard_workday_hours) × min_wage_hourly`. (b) **`record_disbursement`
  exactly-once has NO backing UNIQUE / no amount-vs-net reconciliation / drops `p_ref`.** (c) **`v_worker_piece_rate`
  ignores `rate_basis`** (pays per-lata/per-tarea as per-kg). (d) no reversal RPC / pay_period never reaches 'approved'.
  → **SPLIT D02 into sequential sub-agents by root cluster** (same file = serial, no collision), or one agent
  with that explicit checklist. Full corrected fixes are in the finding objects' `correctedFix`.
- **How to run**: copy `scratch/fix-wave-A.js` → a `fix-wave-dependent.js`; point `OWNERS` at `scratch/depowners`,
  set SCHEMA=`['D00','D02','D05']` (serial), APP=the D-app owners. **Use the pooled width-2 pattern from
  `dependent-wave-review.js` if the API is unstable** (see GOTCHAS). Migrations edited IN PLACE (phase-2 not on prod).

### 2. S12 re-review — only 2 findings captured (infra killed it 3×)
- S12 (satellite/IPM, cert+PHI/REI spray gate) is **under-reviewed**. Re-run: `scratch/dependent-wave-review.js`
  is already scoped to `ONLY_SLICES=['S12']`, `WIDTH=6`. Just `Workflow({scriptPath: that})`. Drop to WIDTH=2 if 529s.
- Known S12 CRIT already confirmed: **harvest planner schedules a pick INSIDE an active PHI window**
  (`schedule_pasada`/`replan_pasada` never read `v_plot_phi_status`) — fix in a NEW migration > `20260622108000`
  that create-or-replaces both planner fns with a fail-closed PHI gate (`v.phi_active and ready_date < v.phi_clears_on`).
  Also flagged: `log_spray` checks REI but NOT PHI at log time.
- Then group its confirmed (extend `group-dependent-owners.js`, remove the `!== 'S12'` filter) and fix.

### 3. Foundation Phase B (MED + LOW) — PREPPED
- **36 MED/LOW-only owners** in `scratch/owners/owner-*.json` (the ones with `hasHi=false` in `scratch/owners-index.json`;
  list also in `scratch/phaseB-files.json`). PLUS the MED/LOW **deferred** by Phase-A owners (see each Phase-A agent's
  `findingsDeferred` in the fix-wave-A result `/private/tmp/.../tasks/w67yt212m.output`).
- Same fix-wave pattern (schema serial, app parallel/pooled). Edits migrations in place.

### 4. Reviewer pass — the Phase-A reviewer agent DIED on a 529; re-run it
- Re-run a coherence/invariant reviewer over the whole branch diff before final merge (esp. reposo, min-wage,
  PHI, the hash-chained ledgers). Pattern: the `Review` phase in `scratch/fix-wave-A.js`.

### 5. Gate + land everything on `main`
- In the fix worktree: `npx vitest run` + `npx tsc --noEmit` + `npm run build` all green, then push branch→main
  (ff). Iterate per finding-fix on any red.

### 6. Prod push phase-2 schema + smoke test — **NEEDS ANDRES'S APPROVAL**
- `unset SUPABASE_ACCESS_TOKEN; supabase db push` (the classifier/Andres gates this). Then drive
  `janson-coffee.vercel.app` in Chrome across every phase-2 surface (/crew /weigh /ferment /drying /qc /plan
  /dispatch /satellite /scouting /payroll + offline sync pill); fix console/render/a11y; re-verify.
  "Smoke test" = always prod.

### 7. THEN P4-S0 multi-tenant (execute the plan) → THEN phase 3
- Locked order (Andres re-confirmed this session): finish phase 2 → **P4-S0 before phase 3** (no tenant retrofit).
  P4-S0 plan is execute-ready pending two business calls (per-tenant vs global `JC-NNN` codes; ledger canonical-bytes).

---

## 🚨 GOTCHAS / LESSONS (read before launching agents)
1. **API was unstable all night (2026-06-21 eve)**: an oscillating **529 Overload** + two **session-usage-cap**
   hits (resets ~5h) + **agent stalls**. Mitigations that WORKED:
   - **Low-concurrency `pooled(width)` workflows** (see `dependent-wave-review.js`): ≤2 concurrent agents survive
     an oscillation that kills 8-wide bursts. Run full-concurrency only when a **heavy** probe (a multi-call,
     ~30s agent — not a trivial ping) comes back clean. Trivial pings are NOT predictive of workflow load.
   - **`grep 529 transcripts` counts RETRIES, not deaths** — judge a run only by its final `<failures>` list.
   - On a session-cap hit, just wait for the reset time it prints (local TZ) — throttling won't help.
2. **`node_modules` is per-worktree** — `npm install` in any new worktree before tests, or every agent's vitest fails.
3. **Fix SQL by editing the phase-2 migration files IN PLACE** (they are NOT on prod yet; the PGlite harness replays
   from scratch). Do NOT add forward repair-migrations for phase-2 fixes. (P4-S0 + the PHI-gate fix are the
   exceptions — new migrations, because they sort above the dependent slices / land later.)
4. **Schema lane is serial** (one migration author at a time → no PGlite-replay race); **app lane parallel/pooled**.
   Owners are grouped file-disjoint via union-find (`group-*.js`) — never let two agents touch one file.
5. **Review/probe agents leave junk in the read-ref worktree** (`phase1-deliver`): a mutation-test edit to
   `harvest_planning.sql` + `zz_*.db.test.ts` repro files. I cleaned them; check `git status` there before any merge.
6. **`git reset --hard` is permission-gated** in this harness; merges/`--force-with-lease` are the safe lanes.
7. **Auto-deploy is live**: push to `main` → `janson-coffee.vercel.app` (no manual `vercel --prod`).
8. Confirmed-finding objects carry `correctedFix` (the adversarially-verified fix) — prefer it over the raw `fix`.

## KEY INVARIANTS (what the review hunts; protect on every fix)
Reposo gate (S4 — FIXED) · QC-hold (S6) · **min-wage make-whole (S7 — BROKEN, $0 for pickers)** ·
**cert+PHI/REI spray gate (S12 — PHI not enforced at spray OR planner)** · dispatch inbound never drives a write
(S5) · oversell · append-only hash-chained ledgers · AD-8 grants (nothing to anon).

## ARTIFACT INDEX (scratch/)
- `dependent-confirmed-merged.json` (86 dependent confirmed) · `depowners/` (22 fix bundles) · `depowners-index.json`
- `fix-worklist.json` (156 foundation confirmed) · `owners/` (52 foundation bundles) · `owners-index.json` · `phaseB-files.json`
- Scripts: `fix-wave-A.js` (fix-wave template), `dependent-wave-review.js` (pooled review template),
  `group-owners.js` / `group-dependent-owners.js` (union-find grouping), `merge-and-prep-fixes.js`,
  `phase2-review-verify-disk.js` (verify-from-disk template).
- Workflow result JSONs: `/private/tmp/claude-501/-Users-andres/<session>/tasks/*.output`
