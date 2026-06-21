# P4-S0 — Multi-Tenant Slice: Execute-Ready Plan

**Status:** PLAN ONLY — no migrations, no schema edits in this document. Synthesized from five
facet investigations (inventory · rls · matview-ledger · auth-backfill · probe-test-seq) read
against the real shipped code in `/Users/andres/coffee-farm-operations-worktrees/phase1-deliver`
(read-only). Every table name, function name, file path, and line citation below was verified on
disk. Implementation is a **single serialized schema-author lane** behind the phased gate
(investigation → task list → implement) per the global rule.

---

## Review status

This plan was **adversarially reviewed** against the on-disk code (`/Users/andres/phase2-review-scratch/p4s0-review.md`)
and every CRIT/HIGH/MED finding has been folded in below. Each changed decision is tagged inline
**[review-hardened]** with a one-line note of what changed and why, so the revision is traceable.
The review confirmed the core isolation design is sound — it independently re-verified the matview
leak, the DEFINER-aggregator scans, the ledger head-select corruption risk, the global-sequence
collision, and the lot-graph fault line on disk — but flagged two day-one blockers and several gaps:

- **CRIT-1** — `auth.uid()` is defined nowhere in this codebase (only in harness *comments*); under
  PGlite it does not exist, so any migration that calls it fails to replay. **Resolved §3:**
  `current_tenant_id()` now reads `sub`/`role` straight from `current_setting('request.jwt.claims',
  true)::jsonb` and never calls `auth.uid()`. *(Verified: `grep -rn 'auth.uid'` over the 24
  migrations + harness returns only two comment lines in `pgliteHarness.ts:15,100`; the harness
  stamps `request.jwt.claims` with `sub` (line 101) and `role` (line 99).)*
- **CRIT-2** — every existing db test calls the SECURITY DEFINER RPCs as the bare `postgres` owner
  with **no JWT claims** (~86 `h.query('select <rpc>(…)')` call sites across ~20 files; verified by
  grep). A naive fail-closed `if v_tenant is null then raise` reds the entire existing suite.
  **Resolved §3/§5:** `current_tenant_id()` falls back to `_default_tenant_id()` when the claim is
  absent **and exactly one tenant row exists**, still failing closed once >1 tenant exists. The plan's
  false "all existing tests replay green untouched" claim is **deleted/corrected** (§7).
- **HIGH-1** — the ~25 idempotency early-return SELECTs run **before** the insert keyed on
  `idempotency_key` only → cross-tenant short-circuit. **Resolved §5:** every idempotency lookup
  (early-return AND post-`on conflict` re-read) gets `and tenant_id = v_tenant`; probe asserts same-key
  two-tenant isolation.
- **HIGH-2** — the existing `foreach` array lists only **12** phase-1 names (several now dead); real
  count is **23** `using(true)`/`with check(true)` clauses across **17** files (verified — the plan's
  "22" was wrong, an off-by-one from single-line grep). **Resolved §4/§8:** `TENANT_TABLES` is built
  explicitly+exhaustively from §2.A+§2.B; the static guard drives off `pg_class` against an `EXEMPT`
  allowlist, not a hand literal.
- **HIGH-3** — a wrong non-hashed `tenant_id` chains correctly but mis-buckets under RLS, invisible
  to `verify_chain`. **Resolved §6.4:** a BEFORE-INSERT assertion `if new.tenant_id is distinct from
  current_tenant_id() then raise` on every ledger table (belt-and-suspenders with the RPC stamp).
- **MED-1** — `dispatch_run` (direct `tenant_id` but FK to `crews`) needs a same-tenant CHECK/trigger;
  also `ferment_recipes` self-FK and `crews.lead_worker_id`. **Resolved §2.**
- **MED-2** — probe owner-path inserts can't rely on `default current_tenant_id()` (NULL under owner).
  **Resolved §8:** pass `tenant_id` literally on every owner-side insert.
- **MED-3** — prefer the explicit loop clamp on `verify_chain` over a `security_invoker` flip (invoker
  verifies only the visible prefix → spurious TRUE). **Resolved §6.3.**
- **MED-4** — the membership-lookup branch of `current_tenant_id()` is never exercised (tenant_users
  empty after the no-op backfill). **Resolved §8:** added a test inserting `tenant_users` directly and
  calling `current_tenant_id()` with a `sub` but no `app_metadata` claim.

**Verdict: execute-ready** pending Andres's go on the two open business decisions in §9 —
**(a)** per-tenant vs global `JC-NNN` lot codes, and **(b)** the ledger canonical-bytes path. Both
have a recommendation; neither blocks writing the migrations once chosen.

---

## 1. Goal + locked sequencing

**Goal.** Introduce true multi-tenancy (estate-scoped row isolation) into a schema that is
**single-tenant and authenticated-only today**: every RLS policy is `using (true)` granted to the
`authenticated` role, `anon` is revoked globally (AD-8, `20260620140000_auth_required_rls.sql`),
writes flow through `SECURITY DEFINER` command RPCs with a pinned `search_path`, ledgers are
append-only + hash-chained (ADR-001/002), and there is **no `farm_id` / `tenant_id` / `app_metadata`
anywhere** (grep confirms the only matches are *comments* deferring the work to
"P4-S0", e.g. `20260622092000_fermentation.sql:9-11`, `20260622108000_payroll.sql:68`,
`20260622090000_people_system.sql:32-34`). After this slice, an authenticated user of tenant A can
never read or write tenant B's land, lots, people, cost, payroll, attendance, or inventory.

> **[review-hardened] No `auth.uid()` anywhere.** `auth.uid()`/`auth.role()` are **not defined** in
> this codebase — `grep -rn 'auth\.uid'` over all 24 migrations + the harness returns only two
> *comment* lines (`src/test/db/pgliteHarness.ts:15,100`). Supabase provides them natively in prod,
> but **PGlite does not**, so the whole plan must read the JWT claim GUC directly and never call
> `auth.uid()` (see §3). This is the AD-9 "works on Supabase, dies in the harness" split the harness
> exists to catch.

**Locked sequencing (do not reorder).**

- **P4-S0 lands AFTER phase 2 and BEFORE phase 3.** Phase 1 (spine: plots/lots/harvests/events/
  processing/costing) and phase 2 (people/fermentation/drying-reposo/qc-cupping/planning/weigh/
  dispatch/remote-sensing-ipm/payroll) are both fully shipped. P4-S0 tenant-scopes all of them in
  **one pass — no retrofit.** Doing this after phase 2 means there is exactly one cut-over: every
  phase-1+2 table gets `tenant_id` together, so phase 3 is built tenant-aware from line one and
  never needs a second retrofit.
- **"One pass" ≠ "one transaction."** The pass is **three staged migrations** (add-nullable →
  backfill → enforce+RLS), each independently idempotent/replayable. This is replay-safe under the
  PGlite harness's `hookTimeout: 60000` budget and isolates the RLS flip from the column lifecycle.
- **Current max migration on disk = `20260622108000_payroll.sql`.** All P4-S0 filenames must be
  strictly `> 20260622108000` (and below any future phase-3 work). This plan reserves the
  **`2026070109xxxx`** band (a clean July-1 "tenant cut-over day" break, visually unambiguous in
  `ls`, and trivially `> 20260622108000`).
- **Single schema-author lane.** This touches every base table; per MEMORY rule #3 and global rule
  #3, one session owns these three files; confirm no parallel session has taken the July band before
  writing.

---

## 2. Table-by-table tenant_id placement (direct vs FK-inherited)

There is **no `farms`/`estates` root today** — the closest singletons are hand-rolled config
(`farm_season_config` with an `id=1` check at `20260621093000_derived_metrics.sql:32`, and the
deprecated `season_summary`). **P4-S0 introduces `tenants` as THE root** (§3). Then:

- **Direct `tenant_id`** goes on **aggregate roots** (no tenant-carrying parent FK) + the **no-FK
  orphan ledgers/costing** (no structural path to a tenant) — RPC-populated.
- **Inherited** tenancy: every other table proves its tenant by following one existing FK hop to a
  tenant-carrying ancestor. These get a `tenant_id` **column too** (for RLS-predicate locality and
  index performance — a per-row correlated subquery up the FK chain is the perf trap to avoid), but
  it is *derived/backfilled from the parent*, not authored independently.

### The structural fault line that dictates everything

`lots` is a **bare `code text primary key` table with NO FK to `plots`** (`20260620120000_init.sql:57`,
promoted in place by `20260621092000_event_log_units_lot_graph.sql`). The only bridge from a lot to a
plot is `harvests (plot_id + lot_code)`, which is many-harvests-to-one-lot, and a lot can be a blend
(`is_single_origin=false`, merges via `lot_edges`). **A lot therefore has no single originating
plot/farm.** Consequence: **`lots` MUST carry `tenant_id` directly**, and the entire lot subtree
inherits from `lots` — **never derive lot tenancy through `harvests`.** This is the single most
important placement decision in the slice.

### A. DIRECT `tenant_id` — tenant roots (FK to `tenants`)

| Table | File:line | Why direct |
|---|---|---|
| `plots` | `init.sql:27` | No FK; the land root. |
| `workers` | `init.sql:44` | No FK; the people root. |
| `lots` | `init.sql:57` | **Bare code table, no plot FK** — the lot-graph root (fault line above). |
| `crews` | `people_system.sql:46` | Only nullable `lead_worker_id→workers`; tenant-level grouping. |
| `reserve_zones` | `plot_geometry.sql:32` | No FK; conservation geometry belongs to the farm. |
| `farm_season_config` | `derived_metrics.sql:32` | Singleton config → per-tenant (drop the `id=1` check; key by tenant). |
| `pay_period` | `payroll.sql:135` | No FK; text-PK payroll period root. |
| `dispatch_run` | `crew_dispatch.sql:55` | Has `crew_id→crews` so *could* inherit; **recommend direct** so dispatch RLS stands alone (avoids a 3-hop derivation). Flagged design choice. **[review-hardened] Direct-but-still-FK'd ⇒ needs a same-tenant guard** (`dispatch_run.tenant_id = crews.tenant_id`) — see invariants below (MED-1). |
| `weather` | `init.sql` (~107) | No FK; per-farm forecast strip. |
| `drying_stations` | `drying_reposo.sql:50` | Physical asset of the farm → direct (not global). |
| `ferment_recipes` | `fermentation.sql:38` | Per-tenant IP (a farm's proprietary recipe). Self-FK only; **decision flag** in §9. |

**No-FK ledgers / costing orphans — DIRECT, RPC-populated at append (see §5, §6):**

| Table | File:line | Why no inheritance |
|---|---|---|
| `lot_event` | `event_log_units_lot_graph.sql` | Hash-chained; only a free-text `stream_key` (`'lot:<code>'`/`'activity'`), no FK to subject. |
| `worker_stream_event` | `people_system.sql:146` | Hash-chained; `stream_key='worker:<id>'`, no FK. |
| `cost_entry` | `costing.sql:53` | **True orphan** — `target_code` is deliberately un-FK'd (plot id OR lot code OR NULL for farm-wide overhead). Immutable trigger blocks UPDATE, so `tenant_id` must be set at INSERT. |

> `weigh_event` and `attendance_event` are also hash-chained, but they **carry real FKs**
> (`worker_id`/`plot_id`/`lot_code` and `worker_id`/`crew_id`/`plot_id`), so they *can* inherit.
> They still need `tenant_id` set at the append RPC because the chain head-select keys on
> `stream_key` (see §6.4).

### B. INHERITED `tenant_id` — derived via one FK hop (column present, backfilled from parent)

**Lot subtree (root `lots`):** `green_lots` (`green_inventory.sql:39`, `lot_code→lots`),
`processing_batches` (`init.sql:79`), `lot_reservations`/`lot_shipments` (via `green_lots`),
`ferment_batches` (`fermentation.sql:98`, `lot_code→lots`), `ferment_readings`/`mill_water_log`
(via `ferment_batches`), `drying_assignments` (`drying_reposo.sql:71`, `lot_code→lots`),
`moisture_readings`, `cupping_sessions` (`qc_cupping.sql:41`, via `green_lots`), `cupping_scores`,
`green_defects`, `qc_holds`, `lot_edges` (`event_log_units_lot_graph.sql:89`, both
`parent_code`/`child_code→lots`).

**Plot subtree (root `plots`):** `plot_phenology`, `maturation_signal`, `pasada_schedule`
(`harvest_planning.sql:60/75/112`), `plot_vegetation_index`, `scouting_observation`,
`spray_application` (`remote_sensing_ipm.sql:53/77/100`).

**Worker subtree (root `workers`):** `worker_identity`, `worker_certifications`,
`por_obra_contracts`, `crew_memberships` (junction — also `crew_id→crews`), `attendance_event`
(`people_system.sql:80/238/217/61/190`).

**Multi-parent operational tables (inherit via any tenant-bound parent):** `harvests`
(`init.sql:64`, the plot↔lot bridge), `tasks` (`init.sql:94`), `weigh_event` (`weigh_capture.sql:91`),
`dispatch_assignment`/`dispatch_acknowledgement`/`dispatch_outbound` (via `dispatch_run`),
`pay_line`/`disbursement` (via `pay_period`).

### C. EXPLICITLY NOT tenant-scoped — global reference data (keep `using(true)`)

Exclude these from the scoping loop so the `do $$ foreach` array does not over-reach:

| Table | File:line | Rationale |
|---|---|---|
| `units` | `event_log_units_lot_graph.sql:31` | UCUM unit registry — shared catalog. |
| `lot_yield_curve` | `event_log_units_lot_graph.sql:186` | House yield factors — shared default (decision flag §9 if per-farm wanted). |
| `statutory_rates` | `payroll.sql:97` | Panama CSS/seguro/décimo law — national, not farm-specific (decision flag §9 if a tenant ever runs in another jurisdiction). |

### D. DEAD — exclude (already deprecated by `derived_metrics`)

`daily_cherries__deprecated`, `weekly_harvest__deprecated`, `variety_shares__deprecated`,
`season_summary` (renamed/replaced by views computing from `harvests`). `activity` is now a **view**
over `lot_event` (`event_log_units_lot_graph.sql:493`) — inherits from the ledger, no column.

> **[review-hardened] Reconcile with the existing `foreach` array (HIGH-2).** The
> `auth_required_rls.sql:11` array is **NOT** a usable enumeration of tenant tables — it lists only
> **12 phase-1 names**, and **5 of them are now dead/changed**: `daily_cherries`, `weekly_harvest`,
> `variety_shares`, `season_summary` (deprecated/renamed) and `activity` (now a *view*, not a base
> table). Do **not** "reuse the existing array" as the scoping loop. M3 builds `TENANT_TABLES`
> **fresh and explicit** from §2.A+§2.B (the real ~54-table source of truth) and the static guard
> (§8) reconciles it against `pg_class` so any base table that is RLS-enabled but missing from
> `TENANT_TABLES` ∪ `EXEMPT` reds the suite. The dead names above are simply never added.

### Cross-tenant consistency invariants (constraints, flagged for the schema author)

- `lot_edges`: `parent.tenant_id = child.tenant_id` (a blend cannot merge two farms' lots) — CHECK/trigger.
- `crew_memberships`: worker and crew must agree on tenant.
- All self-FKs (`*.reverses_id`, `*.superseded_by`) are same-tenant by construction — assert with a CHECK.

**[review-hardened] Same-tenant guard on every "direct `tenant_id` but retains a tenant-scoped FK"
table (MED-1).** When a table is authored with `tenant_id` *directly* (not inherited) yet still holds
an FK into another tenant-scoped table, nothing structurally forces the two tenants to agree — e.g. a
`dispatch_run` with `tenant_id = A` could point at a `crew_id` owned by tenant B. Each such pair needs
a same-tenant CHECK or BEFORE-INSERT/UPDATE trigger (a plain row-level CHECK can't subquery another
table, so these are triggers that re-read the parent's `tenant_id`):

- `dispatch_run.tenant_id = crews.tenant_id` (the `crew_id → crews` FK; verified `crew_dispatch.sql:57`).
- `ferment_recipes.superseded_by` self-FK → `superseded_by.tenant_id = ferment_recipes.tenant_id`
  (verified `fermentation.sql:48`); and `ferment_batches.recipe_id → ferment_recipes` must be
  same-tenant so a batch never points at another farm's recipe IP (`fermentation.sql:101`).
- `crews.lead_worker_id → workers` → `lead_worker.tenant_id = crews.tenant_id` (nullable FK,
  `people_system.sql:49`).
- Audit §2.A row-by-row for any other "could inherit but we chose direct" case before writing M3.

---

## 3. Tenant identity + membership model under $0

**Recommended substrate (two new tables):**

```sql
create table tenants (
  id          uuid primary key default gen_random_uuid(),  -- uuid, NOT text: opaque, JWT-safe,
  slug        text not null unique,                        -- can't collide with text business keys
  name        text not null,                               -- ('p-tizingal-alto', 'JC-564', 'w-06')
  created_at  timestamptz not null default now()
);

create table tenant_users (
  tenant_id   uuid not null references tenants(id),
  user_id     uuid not null,                               -- auth.users(id), NO cross-schema FK
  role        text not null default 'owner'
                check (role in ('owner','manager','agronomist','viewer')),
  expires_at  timestamptz,                                 -- seasonal grants auto-expire
  created_at  timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index tenant_users_user_idx on tenant_users (user_id);
```

- **`uuid` PK by deliberate shape mismatch:** every phase-1/2 key is a *text business key*; a uuid
  `tenant_id` can never be confused with or forged against one, and is opaque/unguessable in a JWT.
  `gen_random_uuid()` is already in use (`lot_event.event_uid`), so the extension is present.
- **No FK from `tenant_users.user_id` to `auth.users`** — deliberate: a hard FK into the `auth`
  schema couples migrations to Supabase-internal DDL and **breaks `pg_dump`/replay in the PGlite test
  harness** (`src/test/db/pgliteHarness.ts` has no `auth` schema — and no `auth.uid()`). Integrity is
  enforced by the signup trigger that writes the row. (Decision flag §9.)
- **`tenant_users` is the source of truth**; `role`+`expires_at` are the authorization/expiry
  authority. `role` is not yet load-bearing in any policy (single-owner today) — forward-looking.

**How `tenant_id` reaches the DB at request time — recommended hybrid:**

- **Primary trust anchor (ship now): `current_tenant_id()` as a `SECURITY DEFINER` membership
  lookup** against `tenant_users`. This is the single source of truth, needs **no auth-hook
  deployment to function**, is immune to a stale/forged `app_metadata` claim (a user cannot
  self-promote by editing a claim — membership is read fresh), and is fully $0/self-contained. One
  indexed lookup per RLS eval on `tenant_users_user_idx` — negligible for a single-estate practice
  app.
- **Later optimization (not blocking): the JWT `app_metadata.tenant_id` claim as a fast path.**
  `app_metadata` is a **core/free** GoTrue feature (NOT the paid hook tier); it is writable with the
  service-role key (server-only, used once at enrollment) and rides every issued JWT. Read it
  DB-side from `request.jwt.claims` (never `import.meta.env` — avoids the Vite optional-chaining
  inlining bug). The claim is a **cache of `tenant_users`**, minted at login by either (a) an
  `after insert on auth.users` Postgres trigger (the only $0 hook firing without external compute)
  or (b) a free-tier Custom Access Token Hook reading `tenant_users`. Both resolve to the same
  tenant, so RLS policies written against `current_tenant_id()` **do not change** when the claim is
  added.

**Why the membership lookup is the anchor, not a per-row policy subquery:** a per-policy
`exists (select 1 from tenant_users where user_id = <caller> and tenant_id = row.tenant_id)` runs a
correlated subquery on **every row of every statement** across ~50 tables (the exact trap on the
`lot_event`/`attendance_event` bulk scans) and creates a recursion/visibility puzzle for
`tenant_users`'s own policy. So: **the helper resolves the tenant once (STABLE, per-statement); the
policies do a flat scalar compare.**

**[review-hardened] `current_tenant_id()` reads the claim GUC directly — NEVER `auth.uid()`** (CRIT-1):
the caller identity (`sub`) and role come from
`current_setting('request.jwt.claims', true)::jsonb ->> 'sub'` / `->> 'role'`. **Verified against the
harness:** `pgliteHarness.ts` stamps exactly this GUC — `DEFAULT_AUTHENTICATED_CLAIMS = { role:
'authenticated', sub: '00000000-…-0001' }` is serialized into `set_config('request.jwt.claims', …)`
by `setClaims()` (lines 98–111), and the `asAuthenticated`/`asAnon` shims `set role` + stamp it
(lines 119–152). There is **no `auth` schema and no `auth.uid()`** under PGlite, so the helper must
not depend on one; prod Supabase provides `auth.uid()` natively but the replay path must not rely on
it. `current_setting('request.jwt.claims', true)` returns `''`/NULL when no claim is stamped (the
`true` = `missing_ok`), which is exactly the owner/claimless case we fail-closed on below.

**[review-hardened] Single-tenant fallback so the existing suite stays green** (CRIT-2): every
existing db test invokes the SECURITY DEFINER RPCs as the **bare `postgres` owner with no JWT claims**
(~86 `h.query('select <rpc>(…)')` call sites across ~20 files; verified by grep — e.g.
`p2s1_people.db.test.ts:172` calls `record_attendance(...)` with no `asAuthenticated` wrapper). A
naive `if v_tenant is null then raise` (§5 Move A) would raise on **every one of those calls** and red
the whole pre-existing suite — a stop-the-line condition under the local quality gate. **Chosen
resolution = option (b):** when no claim is present, `current_tenant_id()` falls back to
`_default_tenant_id()` **iff exactly one tenant row exists.** This preserves both the single-estate
owner-style tests AND prod single-estate ergonomics, while still **failing closed** the moment a
second tenant is created (the fallback returns NULL once `count(*) > 1`, so a claimless caller in a
real multi-tenant deployment sees/writes nothing). *Security trade-off:* in a future genuine
multi-tenant world a claimless session degrades to NULL (fail-closed) — the fallback is only a
single-tenant convenience, never a multi-tenant bypass. The probe's "claimless fail-closed"
assertion (§8) seeds **two** tenants precisely so the fallback is NULL there and the strict guard is
proven. *(Rejected alternative: mass-migrate all ~86 existing RPC call sites into an `asTenant(h,
DEFAULT)` wrapper — honest but a large, error-prone edit across ~20 unrelated test files, and it
would not fix prod's own single-estate ergonomics.)*

**Recommended `current_tenant_id()` (anchor form, claim-GUC-direct + single-tenant fallback):**

```sql
create or replace function current_tenant_id() returns uuid
  language plpgsql stable security definer
  set search_path = public
as $$
declare
  v_raw    text := current_setting('request.jwt.claims', true);
  v_claims jsonb;
begin
  -- [review-hardened] Guard the empty/NULL GUC. The harness resets request.jwt.claims to '' on
  -- teardown (pgliteHarness.ts:130,150) and owner-role calls have no claim set, so a bare
  -- `current_setting(...)::jsonb` would throw `invalid input syntax for type json` on ''. Coerce
  -- '' / NULL to an empty object first.
  v_claims := case
                when v_raw is null or v_raw = '' then '{}'::jsonb
                else v_raw::jsonb
              end;
  return coalesce(
    -- 1) fast path: the minted JWT claim, if present (never auth.uid())
    nullif(v_claims -> 'app_metadata' ->> 'tenant_id', '')::uuid,
    -- 2) SSOT path: membership lookup keyed on the JWT `sub`
    (select tenant_id from tenant_users
       where user_id = nullif(v_claims ->> 'sub', '')::uuid
       limit 1),
    -- 3) single-tenant fallback: a claimless/owner session resolves to the lone tenant, and ONLY
    --    while exactly one tenant exists (returns NULL once >1 → fail-closed in multi-tenant)
    (select id from tenants where (select count(*) from tenants) = 1 limit 1)
  );
end;
$$;
revoke execute on function current_tenant_id() from public;     -- AD-8 grant idiom (mandatory:
grant   execute on function current_tenant_id() to authenticated;  -- migration-grants guard checks)
```

- **STABLE** → evaluated once per statement, not per row (critical for ledger bulk scans).
- **Reads `sub`/`role` from `current_setting('request.jwt.claims', true)`** — the exact GUC the
  harness stamps — and **guards the `''`/NULL case** before `::jsonb` so a claimless/owner session
  doesn't throw `invalid input syntax for type json` (the harness resets the GUC to `''` on teardown,
  `pgliteHarness.ts:130,150`). **No `auth.uid()` call** anywhere in the replay path (CRIT-1).
- **Returns NULL for a claimless/membership-less caller once >1 tenant exists** → every policy ANDs
  `tenant_id = current_tenant_id()`; NULL never equals a real uuid → **fail-closed, sees/writes
  nothing.** While exactly one tenant exists, the third `coalesce` arm resolves to it (the CRIT-2
  single-estate fallback).

**Signup binding (the $0 hook):** *(prod-only — degrades to a no-op under PGlite, which has no
`auth.users`; see §7.)*

```sql
create or replace function handle_new_user() returns trigger
  language plpgsql security definer set search_path = public
as $$
declare t uuid;
begin
  t := _default_tenant_id();                 -- single-estate practice posture: join default estate
  insert into tenant_users (tenant_id, user_id, role)
    values (t, new.id, 'owner') on conflict (tenant_id, user_id) do nothing;  -- idempotent
  return new;
end $$;
-- The trigger targets auth.users, which exists on prod Supabase but NOT under PGlite. Guard the
-- trigger creation so the migration still replays in the harness (the trigger simply never fires
-- there — no auth.users means no signups in tests; tenant_users is seeded directly instead, §8/MED-4):
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'auth' and table_name = 'users') then
    execute 'create trigger on_auth_user_created after insert on auth.users
             for each row execute function handle_new_user()';
  end if;
end $$;

create or replace function _default_tenant_id() returns uuid
  language sql stable set search_path = public
as $$ select id from tenants where slug = 'janson-coffee' $$;  -- centralizes "which tenant", no literal UUID
```

---

## 4. RLS rewrite — concrete policy shapes

Every tenant-scoped base table (§2.A + §2.B) gets `tenant_id uuid` (backfilled, then `not null
references tenants(id) default current_tenant_id()`), an index on `tenant_id`, and **replaces** its
`using(true)` policies via a `do $$ … foreach t in array array[…]` loop **over a freshly built,
explicit `TENANT_TABLES` array** (not the stale `auth_required_rls.sql:11` array — see HIGH-2 below).
The same loop idiom is reused (`20260620140000_auth_required_rls.sql:11`,
`20260620160000_write_foundation.sql`); only the array contents are authored anew.

> **[review-hardened] There are 23 `using(true)`/`with check(true)` clauses, not 22, across 17 files
> (HIGH-2).** The plan's original "22" was an off-by-one — a single-line grep miscounts the migrations
> where `with check (true)` is split from `using (true)`. A multiline-aware scan finds **23** clauses
> (`write_foundation.sql` has 4, `green_inventory.sql` 3, `costing.sql` 2, and 14 files with 1 each).
> A "missed one" in a security-policy swap is exactly the off-by-one that strands a table on
> `using(true)`, so the static guard (§8 block 4) — driven off `pg_class`, not a hand count — is the
> backstop, not this number. Build `TENANT_TABLES` from §2.A+§2.B **exhaustively**; the §2.C `EXEMPT`
> set (`units`, `lot_yield_curve`, `statutory_rates`) keeps `using(true)` and must be in the guard's
> allowlist.

```sql
create policy "tenant read" on plots for select to authenticated
  using (tenant_id = current_tenant_id());

create policy "tenant insert" on plots for insert to authenticated
  with check (tenant_id = current_tenant_id());

create policy "tenant update" on plots for update to authenticated
  using (tenant_id = current_tenant_id())        -- can't edit another tenant's row
  with check (tenant_id = current_tenant_id());   -- can't re-home a row into/out of a tenant

create policy "tenant delete" on plots for delete to authenticated
  using (tenant_id = current_tenant_id());
```

**Why all four / both UPDATE clauses are load-bearing:** INSERT `with check` stops stamping a row to
someone else's tenant; UPDATE `using` stops editing a foreign row; the **separate UPDATE `with
check`** stops the subtler re-home attack (moving your row into another tenant, or stealing a row by
re-homing it to yours) — Postgres evaluates the two UPDATE clauses independently.

**Column default makes INSERT ergonomic AND safe:** `default current_tenant_id()` means an INSERT
that *omits* the column auto-stamps correctly, while the `with check` still rejects a client that
*explicitly sends* a foreign id. **Default + WITH CHECK = "can't forget it, can't forge it."**
(Note: the default is set in the **enforce** migration, under a real JWT — never in the add-column
step, where `current_tenant_id()` is NULL.)

**`current_tenant_id()` helper:** see §3 (STABLE SECURITY DEFINER, fail-closed NULL, AD-8 grant).

**Reconstructed `security_invoker` views inherit automatically:** `harvests_view`/`tasks_view`
(`init.sql:157-183`) and the whole view layer (`green_lots_atp`, `lot_origin_plots`, `v_worker_pay`,
`v_payroll_statutory`, `v_payslip`, `activity`, etc.) are `security_invoker = on` → they re-apply
the new base-table RLS for free. **Do NOT add tenant predicates to the views** (double-filtering /
redundant). The one caveat: recursive CTE views (`lot_origin_plots`, `cost_alloc_by_rule`) must have
**every base relation they touch** tenant-RLS'd — verify the seed (`from lots g where
g.stage='green'`) and each recursive join target are covered, else a future cross-tenant `lot_edges`
row braids the walk.

**Reference tables keep `using(true)`:** `units`, `lot_yield_curve`, `statutory_rates` (§2.C) — keep
their shared-read policy; do not loop them into the tenant set.

---

## 5. Command-RPC tenant-stamping + cross-tenant rejection

**This is the highest-stakes part.** `SECURITY DEFINER` RPCs run as the table owner and **BYPASS
RLS entirely** — the §4 `with check` policies do nothing inside them. Each of the **~26
caller-facing command RPCs** (and the DEFINER aggregators) must self-enforce. Four required moves
per RPC (Move D added in review):

**Move A — resolve tenant once, fail-closed (first statement after declarations):**

```sql
v_tenant uuid := current_tenant_id();
...
if v_tenant is null then
  raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
end if;
```

`current_tenant_id()` reads the **caller's** JWT/membership directly from
`current_setting('request.jwt.claims', true)` even inside a definer body (the claim GUC is request
context, not role context), so this correctly derives the *caller's* tenant.

> **[review-hardened] The fail-closed `raise` is non-fatal to the existing suite ONLY because of the
> single-tenant fallback (CRIT-2).** Existing tests call these RPCs as the bare owner with no claim;
> `current_tenant_id()` resolves them to `_default_tenant_id()` *because exactly one tenant exists in
> those tests*, so `v_tenant` is non-NULL and Move A does **not** raise. The instant a second tenant
> exists (the probe, or real multi-tenancy), a claimless caller gets NULL here and the RPC raises —
> fail-closed. This is why §7's "all existing tests replay green untouched" line is corrected, not
> deleted wholesale: they stay green *via the fallback*, not because the guard is absent.

**Move B — stamp `tenant_id = v_tenant` (NEVER a client param) on every INSERT.** Concrete, retrofitting
the real `record_attendance` (`people_system.sql:523`):

```sql
insert into attendance_event (tenant_id, idempotency_key, stream_key, worker_id, crew_id,
                              event_kind, plot_id, occurred_at, device_id, device_seq)
values (v_tenant, p_idempotency_key, 'attendance:' || p_worker_id, p_worker_id, v_crew,
        p_event_kind, p_plot_id, p_occurred_at, p_device_id, p_device_seq);
```

**Move C — reject cross-tenant FK args (the real leak).** Today's existence checks are tenant-blind
(`if not exists (select 1 from workers where id = p_worker_id)`, `people_system.sql:515`), so a
tenant-B caller could append to tenant A's worker. **Every** existence check and every
derive-from-parent SELECT gains `and tenant_id = v_tenant`:

```sql
-- BEFORE (cross-tenant hole):
if not exists (select 1 from workers where id = p_worker_id) then ...
-- AFTER (a foreign worker is "unknown"):
if not exists (select 1 from workers where id = p_worker_id and tenant_id = v_tenant) then
  raise exception 'unknown worker %', p_worker_id using errcode = 'foreign_key_violation';
end if;
```

**Rule: every row an RPC reads-to-derive OR writes must be clamped to `v_tenant`.** When an RPC
derives a value from a parent (e.g. `record_attendance` reads `crew_id` from `crew_memberships`,
`people_system.sql:520`), that SELECT also filters `and tenant_id = v_tenant`.

**[review-hardened] Move D — clamp EVERY idempotency lookup SELECT to `v_tenant` (HIGH-1, the
pre-insert leak).** Each RPC opens with an idempotency early-return SELECT keyed on
`idempotency_key` **only**, which runs **before** any insert — so making the *constraint* composite
(`unique(tenant_id, idempotency_key)`, §6.4) does nothing here: tenant B's call hits this read first,
finds tenant A's row, and **returns A's `event_uid`/`lot_code` to B**, short-circuiting before the
composite constraint can fire. Both the early-return AND the post-`on conflict do nothing` re-read
must filter `and tenant_id = v_tenant`:

```sql
-- BEFORE (cross-tenant short-circuit, e.g. record_attendance, people_system.sql:510):
select event_uid into existing from attendance_event where idempotency_key = p_idempotency_key;
-- AFTER:
select event_uid into existing from attendance_event
 where idempotency_key = p_idempotency_key and tenant_id = v_tenant;
-- ...and the post-conflict re-read (people_system.sql:530) gets the same `and tenant_id = v_tenant`.
```

**Real lookup sites to clamp (verified on disk — ~25+ across every RPC-bearing migration):**
`record_attendance` (`people_system.sql:510`, re-read `:530`), `record_worker_event`/`rehire`
(`people_system.sql:555,588,618,621,671,673,714,752`), `record_lot_event`
(`event_log_units_lot_graph.sql:356`, re-read `:368`), `record_cherry_intake`
(`event_log_units_lot_graph.sql:398`; pipeline-fix variants `pipeline_fixes.sql:53`,
`phase1_review_fixes.sql:56`), `advance_processing_stage` (`event_log_units_lot_graph.sql:440`;
`pipeline_fixes.sql:157`, `phase1_review_fixes.sql:105`), `start_ferment_batch`
(`fermentation.sql:245`), `record_ferment_reading` (`fermentation.sql:292,310`), `log_mill_water`
(`fermentation.sql:341,358`), `record_moisture_reading` (`drying_reposo.sql:320,332`),
`assign_drying_station`/stage (`drying_reposo.sql:411`), `record_cupping_session`/`record_cup_score`/
`record_defect`/`place_qc_hold` (`qc_cupping.sql:328,341,363,372,395,404,428,440`),
`record_maturation_signal`/`schedule_pasada`/`replan_pasada`
(`harvest_planning.sql:313,365,437`), `record_weigh_in` (`weigh_capture.sql:215`),
`generate_dispatch`/`mark_dispatch_sent` (`crew_dispatch.sql:398,482`), and the RSI lookups
(`remote_sensing_ipm.sql`, 4 sites). The probe (§8 block 2) **must** assert that A and B can each use
the *same* `idempotency_key` and each get back their *own* tenant's distinct row — the original spec
only tested cross-tenant *target entities*, never same-key collision.

**Audited RPC surface (clamp all):** People — `record_attendance`, `enroll_crew_member`,
`sign_por_obra_contract`, `record_certification`, `rehire_worker`. Lot spine — `record_lot_event`,
`record_cherry_intake`, `advance_processing_stage`. Green/claims — `reserve_green_lot`,
`materialize_green_lot`. Ferment/drying/QC — `start_ferment_batch`, `record_ferment_reading`,
`log_mill_water`, `apply_ferment_recipe`, `record_moisture_reading`, `assign_drying_station`,
`record_cupping_session`, `record_cup_score`, `record_defect`, `place_qc_hold`, `release_qc_hold`.
Planning/weigh/dispatch — `record_maturation_signal`, `schedule_pasada`, `replan_pasada`,
`record_weigh_in`, `generate_dispatch`, `mark_dispatch_sent`, `record_dispatch_ack`. Payroll —
`compute_pay_period`, `approve_pay_line`, `record_disbursement` (**money path — highest severity**).
RSI — `record_vegetation_index`, `record_scouting`, `log_spray`. EUDR — `eudr_declare_plot`.

**Composite idempotency (sleeper cross-tenant bug):** `idempotency_key unique` and
`unique(device_id, device_seq)` are **table-wide** on `lot_event` (`event_log_units_lot_graph.sql:223`),
`worker_stream_event`, `attendance_event`, `weigh_event`. Two tenants generating the same key (e.g.
both field apps use `intake-2026-06-21-001`) would have tenant B's `on conflict do nothing` silently
no-op against tenant A's row — and `record_cherry_intake` would **return tenant A's lot code to
tenant B**. Make every such constraint `unique(tenant_id, idempotency_key)` /
`unique(tenant_id, device_id, device_seq)`.

**TS port side — no signature change, by design.** The `.rpc()` envelopes (e.g.
`src/lib/db/commands/recordAttendance.ts`, `recordCherryIntake.ts`) **do not** add a `p_tenant_id`
param — the client never sends tenancy; it is derived server-side from the JWT. This is itself a
security property (no client-supplied tenant to spoof) and satisfies the injection-hardening rule
(client text → RPC param is fine because the RPC clamps to the JWT tenant, never a client-named one).
Only the SQL bodies change.

---

## 6. Non-RLS leak surfaces + each fix

RLS does **not** reach four classes of surface. These are the surfaces a "tables-only" P4-S0 would
silently leak through.

### 6.1 Materialized views — the #1 financial exposure (matviews CANNOT carry RLS)

`mv_lot_cost` / `mv_lot_cost_by_rule` (`costing.sql:251/271`) materialize **as owner**; the
migration's own comment says so (`costing.sql:247`: "a materialized view is NOT security_invoker").
The only gate today is `grant select on mv_lot_cost to authenticated` (`costing.sql:380`) → post
multi-tenant, any authenticated user reads **every tenant's cost-per-kg** ("the number the business
turns on"). The matview body has no tenant column to filter on, and lot codes come from a single
global sequence (§6.4). Fix:

1. **Carry `tenant_id` through the matview body** (through every CTE in `cost_alloc_by_rule`
   `costing.sql:143-225` → into the `select`). Make the unique indexes composite
   **`(tenant_id, green_lot_code)`** (`mv_lot_cost_pk` `:264`, `mv_lot_cost_by_rule_pk` `:275`) — else
   two tenants' equal lot codes collide on `REFRESH` and one overwrites the other.
2. **Revoke the raw `grant select`** on the matviews (`:380-381`).
3. **Front reads with a `security_barrier` view** that filters by tenant; grant on the view, not the
   matview:
   ```sql
   create view v_lot_cost with (security_barrier = true) as
     select * from mv_lot_cost where tenant_id = current_tenant_id();
   ```
4. **Fix the `.rpc()` read-ports** `cogs_per_lot` / `cogs_per_plot` / `cogs_breakdown_per_lot`
   (`costing.sql:301/328/316`). They are `security_invoker` **but read the matview, which has no
   RLS** — invoker mode re-applies RLS only to relations that *have* it, so today
   `cogs_per_lot('JC-700')` returns cost **regardless of owning tenant** (the single most dangerous
   silent leak). Add `and tenant_id = current_tenant_id()` (or read `v_lot_cost`). Consumed by
   `src/lib/db/cogs.ts` — no TS change if the fn is fixed.
5. `refresh_lot_cost()` (`costing.sql:283`, DEFINER) rebuilds all tenants at once — correct once the
   body carries `tenant_id` and the read-port filters; no per-tenant refresh needed.

### 6.2 DEFINER trigger-guard aggregates (bypass RLS, `sum()` table-wide)

`prevent_oversell` (`green_inventory.sql:85`), `prevent_overcapacity` (`drying_reposo.sql:86`),
`lots_conserve_mass_vs_claims` (`green_inventory.sql:155`), `lot_edges_conserve_mass`
(`event_log_units_lot_graph.sql:102`) each `sum(kg)` across the whole claim/mass table. Add `and
tenant_id = new.tenant_id` to every aggregate `where`. **Critical** if codes go per-tenant (§6.4):
without it the ATP/oversell/mass guarantee computes against the wrong (cross-tenant) pool — a
correctness/money bug, not just a leak.

### 6.3 DEFINER aggregator RPCs that scan rows

- **`compute_pay_period`** (`payroll.sql:534`) — `for r in select id, daily_rate_usd from workers
  loop` (`:572`) is an **unfiltered full scan of `workers`**: runs payroll over **every tenant** at
  once, reading B's `daily_rate_usd` and writing pay lines into one period. Also reads
  `farm_season_config where id=1` (`:568`) and `statutory_rates`. **Worst aggregator.** Filter the
  worker loop `and tenant_id = v_tenant`; make `farm_season_config` per-tenant (§2.A); stamp inserted
  `pay_line`.
- **`generate_dispatch`** (`crew_dispatch.sql:375`) — `for rec in select … from v_harvest_readiness
  where readiness >= thr` (`:426`) over all tenants' ready plots + global crew/pasada lookups. Filter
  the loop and lookups by tenant.
- **`verify_chain`** (`event_log_units_lot_graph.sql:297`, DEFINER, granted to all `authenticated`) —
  loops every `lot_event` row for a stream; post-tenant, A can verify B's chain. **[review-hardened]
  Use the explicit loop clamp `and tenant_id = current_tenant_id()`, NOT a `security_invoker` flip
  (MED-3).** The invoker flip *looks* tidier ("invoker removes the DEFINER bypass entirely") but it
  makes `verify_chain` verify only the **caller-visible prefix** of the chain — a partial-visibility
  walk can return a **spurious TRUE** for a chain it can only see part of, and the function's `set
  search_path`/grant posture would all need re-verifying. The explicit clamp keeps it DEFINER (so it
  still sees the whole stream) while scoping the walk to the caller's tenant. *If* the team ever does
  flip to invoker, it MUST ship a test that a partial-visibility chain returns FALSE/raises rather
  than a spurious TRUE.

### 6.4 Hash-chained ledgers + global sequences (corruption risk, not just leak)

**Ledgers** (`lot_event`, `worker_stream_event`, `attendance_event`, `weigh_event`): each
`_set_hash` trigger selects the stream head by `stream_key` **only**
(`event_log_units_lot_graph.sql:256`, `people_system.sql:265/292`, weigh `:135`). If two tenants
ever share a `stream_key` — and the literal `'activity'` key is shared by all activity events, and
`'attendance:<id>'` collides if worker ids aren't globally unique — **tenant B's insert chains its
`prev_hash` off tenant A's head**, interleaving the chains and breaking `verify_chain` for *both*.
This is **data-integrity corruption.** Fix:

1. Add `tenant_id` to all four chained tables (RPC-populated, §5).
2. Make stream uniqueness **`(tenant_id, stream_key)`** and **`(tenant_id, device_id, device_seq)`**;
   add `and tenant_id = new.tenant_id` to every `_set_hash` head-select.
2b. **[review-hardened] Assert the stamped `tenant_id` matches the caller (HIGH-3).** Because
   `tenant_id` is *non-hashed* (step 3), a row whose `tenant_id` is wrong but whose `stream_key` is
   right would **chain correctly yet sit in the wrong tenant's RLS bucket** — invisible to
   `verify_chain` (which doesn't hash/check tenant) and to the owning tenant (RLS hides it): a silent
   divergence between "what the hash chain says" and "what RLS shows." Belt-and-suspenders with the
   RPC stamp (§5 Move B), add a BEFORE-INSERT assertion on each of the four ledger tables:
   ```sql
   -- in each _set_hash (or a sibling BEFORE-INSERT trigger) on lot_event / worker_stream_event /
   -- attendance_event / weigh_event:
   if new.tenant_id is distinct from current_tenant_id() then
     raise exception 'ledger tenant_id % does not match session tenant', new.tenant_id
       using errcode = 'insufficient_privilege';
   end if;
   ```
   *(Alternative considered: fold `tenant_id` into the head-select equality so a mismatch starts a
   new broken NULL-prev chain that `verify_chain` then flags. Step 2 already adds `and tenant_id =
   new.tenant_id` to the head-select, which gives that flaggable-broken-chain behavior; the explicit
   assertion above is the stronger choice because it rejects the bad row outright instead of leaving a
   broken chain to be discovered later.)*
3. **Preserve historical hashes — do NOT change the canonical bytes.** `lot_event_canonical_bytes`
   (`event_log_units_lot_graph.sql:230`) folds `stream_key, kind, payload, occurred_at, device_id,
   device_seq` — **not** `tenant_id`. **Recommended: add `tenant_id` as a NON-hashed column** and
   enforce the boundary via RLS + the filtered head-select. A pure column-add backfill then **does
   not invalidate existing hashes** (the strongly-preferred path). *Rejected alternative:* prefixing
   `stream_key` with the tenant (or folding `tenant_id` into the canonical bytes) re-keys genesis and
   **breaks `verify_chain` on all historical rows**, forcing a full re-hash during backfill. This
   ledger canonical-bytes decision is the **highest-risk item in the slice** (§9).

**Global sequences** mint cross-tenant-collidable identifiers:

- `lot_code_seq` (start 700, `event_log_units_lot_graph.sql:203`) mints `JC-NNN`, the PK of `lots`
  and join key of the matview/green_lots/edges/cost/EUDR. A single global counter keeps codes
  globally unique (works) **but leaks cross-tenant write volume** (B infers A's harvest count from
  code gaps) and blocks per-tenant friendly `JC-001…` numbering.
- `worker_server_seq` (start 1, `people_system.sql:176`, drawn by `next_server_seq()`) is a single
  global `server` device feeding the ledger `(device_id,device_seq)` uniqueness.

**Decision (flag §9):** *Keep global* = simplest, codes/seqs stay unique, accept volume-inference +
no friendly numbering; still add `tenant_id` columns for RLS. *Per-tenant* (a
`lot_counters(tenant_id, next_val)` table updated under `pg_advisory_xact_lock(hashtext(tenant_id))`,
mirroring the `prevent_oversell` locking idiom `green_inventory.sql:102`) gives each tenant its own
`JC-001…`, **but then lot codes are unique only within a tenant, forcing composite keys everywhere a
code appears** — `lots(code)→(tenant_id,code)`, `lot_edges.parent_code/child_code` FKs,
`green_lots.lot_code`, all matview indexes, `cost_entry.target_code`, the three ledgers'
`(device_id,device_seq)`. This is the largest schema decision in P4-S0 and is exactly why it must
land in one pass before phase 3. **Recommendation: per-tenant friendly codes are worth it for a
farm-ops product** — but only if accepted with the composite-key blast radius.

### 6.5 Global config singletons → per-tenant

`farm_season_config` (read `where id=1`, `payroll.sql:568`) → per-tenant row keyed by tenant; every
`where id=1` becomes `where tenant_id = current_tenant_id()`. Config-returning DEFINER fns
`_weigh_geofence_radius_m()` (`weigh_capture.sql:83`) and `_ipm_threshold()`
(`20260622106000_remote_sensing_ipm.sql:238`) — geofence radius is almost certainly per-tenant;
confirm (§9). `statutory_rates`/`units`/`lot_yield_curve` stay global (§2.C), documented so a future
reviewer doesn't "fix" them.

### 6.6 Non-RLS read-path inventory (complete)

| # | Surface | File:line | RLS? | Fix |
|---|---|---|---|---|
| 1 | `mv_lot_cost` | costing:251 | No (owner) | tenant body + composite PK + `security_barrier` view; revoke raw grant |
| 2 | `mv_lot_cost_by_rule` | costing:271 | No | same as #1 |
| 3 | `cogs_per_lot`/`cogs_per_plot`/`cogs_breakdown_per_lot` | costing:301/328/316 | No (read matview) | `and tenant_id = current_tenant_id()` or read barrier view |
| 4 | `verify_chain` | events:297 | No (DEFINER) | **[review-hardened]** scope loop `and tenant_id = current_tenant_id()` (stay DEFINER — invoker flip can return spurious TRUE on a partial chain, MED-3) |
| 5 | `compute_pay_period` | payroll:534 | No (DEFINER) | filter worker loop + config; stamp pay_line |
| 6 | `generate_dispatch` | dispatch:375 | No (DEFINER) | filter readiness loop + crew/pasada |
| 7 | intake/stage/event + `materialize_green_lot` | events:339/377/422; greeninv:229 | No (DEFINER) | stamp + scope existence/idempotency |
| 8 | `eudr_declare_plot` | eudr:153 | No (DEFINER) | scope target plot to caller |
| 9 | oversell/mass DEFINER triggers | greeninv:85/155; events:102 | No | tenant on every `sum()` |
| 10 | `lot_code_seq`/`worker_server_seq` | events:203; people:176 | n/a | global-vs-per-tenant (§6.4) |
| 11 | `idempotency_key`/`(device_id,seq)` uniqueness | events:223 et al. | n/a | composite with `tenant_id` |
| 12 | chain head-selects (stream_key only) | events:256; people:265/292; weigh:135 | partial | tenant in head-select **+ [review-hardened] BEFORE-INSERT assert `new.tenant_id = current_tenant_id()` (HIGH-3)** |
| 13 | `farm_season_config` + config singletons | payroll:568; weigh:83; rsi:238 | No | per-tenant rows |
| 14 | `security_invoker` views | §4 list | Yes IFF bases RLS'd | verification-checklist only |

---

## 7. Backfill + migration sequencing (staged, idempotent, replayable)

All filenames strictly `> 20260622108000`. Reserved July-1 band. **Three migrations, each
self-wrapped `begin;…commit;` (rollback-proof protocol — outer ROLLBACK is not a dry run).**

The per-table column lifecycle is **THREE separate steps, never collapsed** — driven by the repo's
own `do $$ … foreach t in array array[…]` idiom (`auth_required_rls.sql:11`,
`write_foundation.sql`). The add-nullable → backfill-all → constrain-all order is
**order-independent across tables** within each phase (every new FK points only at the already-seeded
`tenants`, never between business tables), so the loop processes all ~54 tables safely regardless of
the inter-table FK graph.

**Migration 1 — `20260701090000_tenant_add_nullable.sql`**
1. `create table if not exists tenants (...)`; `create table if not exists tenant_users (...)` + index.
2. `insert into tenants (name, slug) values ('Janson Coffee','janson-coffee') on conflict (slug) do nothing;` — the default-estate anchor. Now `_default_tenant_id()` resolves.
3. Create `_default_tenant_id()`, `current_tenant_id()` (claim-GUC-direct + single-tenant fallback, §3 — **no `auth.uid()`**), `handle_new_user()` + the `auth.users` trigger **guarded behind an `information_schema` existence check** so it is created on prod (where `auth.users` exists) and silently skipped under PGlite (§3 trigger block). All AD-8 `revoke/grant execute` so `migration-grants.db.test.ts` stays green.
4. Backfill `tenant_users` **only if `auth.users` exists**: `do $$ begin if exists (…auth.users…) then insert into tenant_users select _default_tenant_id(), id, 'owner' from auth.users on conflict do nothing; end if; end $$;` (a bare `from auth.users` would error at *parse/replay* time under PGlite where the relation is absent — the guard makes it a clean no-op; the signup trigger handles the first real login on prod; mirrors the `_backfill_people()` callable-helper precedent, `people_system.sql:94-139`).
5. **Loop all tenant-scoped tables:** `alter table <t> add column if not exists tenant_id uuid;` — nullable, **no default-from-claim** (no JWT during migration → would stamp NULL). Instant; violates nothing. **Exclude** the §2.C reference tables and §2.D dead tables from the explicit `TENANT_TABLES` array (built fresh per HIGH-2, not reused from `auth_required_rls.sql`).

**Migration 2 — `20260701091000_tenant_backfill.sql`**
- For every scoped table: `update <t> set tenant_id = _default_tenant_id() where tenant_id is null;`
  Naturally idempotent (`where … is null`); re-running is a no-op. **Must complete for ALL tables
  before any `set not null`.** Also backfill the matview source columns so the rebuilt matview is
  tenant-correct.

**Migration 3 — `20260701092000_tenant_enforce_rls.sql`** (the RLS flip — **last**, so no row is
ever orphaned out of visibility mid-migration)
- Per table: `alter column tenant_id set not null` (passes — zero NULLs after M2);
  `add constraint <t>_tenant_fk foreign key (tenant_id) references tenants(id)` (passes — `tenants`
  row exists); then `alter column tenant_id set default current_tenant_id()` (now safe — future
  inserts run under a real JWT, covering direct-INSERT paths like `tasks`).
- **Drop every `using(true)`/`with check(true)` policy** (`drop policy if exists`) and recreate the
  four §4 policies referencing `current_tenant_id()` (idempotent swap, same idiom as
  `auth_required_rls.sql:16-19`).
- Composite uniqueness + ledger rebinds (§6.4): `(tenant_id, idempotency_key)`,
  `(tenant_id, device_id, device_seq)`, `(tenant_id, stream_key)` head-selects. **Add `tenant_id`
  as a non-hashed column — do not touch `lot_event_canonical_bytes`** (preserves historical hashes).
- Sequence/minter rebind if per-tenant chosen (§6.4): create `lot_counters`, seed the default
  tenant's counter to `max(JC-NNN)+1` (or `currval('lot_code_seq')`) **before** the first per-tenant
  mint (else the first new intake collides with a seeded code), mirroring `phase1_review_fixes.sql`.
- Matview rebind (§6.1): redefine `mv_lot_cost`/`mv_lot_cost_by_rule` with `tenant_id`, composite
  index, `security_barrier` wrapper view; revoke raw grants; patch `cogs_*` read-ports; then run
  `refresh_lot_cost()`. **Order:** `cost_entry.tenant_id` backfilled (M2) → matview redefined →
  refreshed, else the matview caches pre-tenant rows.
- Update the ~26 command RPCs (§5) via `create or replace function` (idempotent).

**[review-hardened] Idempotency / replay — the existing suite stays green ONLY via the single-tenant
fallback, NOT untouched-by-magic (CRIT-2).** Every statement is guarded (`if not exists`, `drop … if
exists`, `create or replace`, `where … is null`, `on conflict do nothing`), and `current_tenant_id()`
reads `request.jwt.claims` straight from the GUC — which the harness stamps via `setClaims()` — so the
new RLS is exercisable in-process with no Docker, **and no `auth.uid()` is ever called** (CRIT-1).
**But the original claim that "all existing tests replay green untouched" was false and is deleted.**
The ~86 existing RPC call sites run as the **bare `postgres` owner with no JWT claims**; the new §5
Move-A `raise` would red them all if `current_tenant_id()` returned NULL. They stay green **because**
the §3 single-tenant fallback resolves a claimless owner session to `_default_tenant_id()` *while
exactly one tenant exists* (every existing test seeds only the default estate). That is the load-
bearing mechanism — if a future test seeds a second tenant without stamping a claim, those owner-style
RPC calls **will** start failing closed, by design. **PGlite has no `auth` schema** → the guarded
`auth.users` backfill (M1 step 4) and the guarded signup trigger (M1 step 3) are clean no-ops in tests;
the probe injects tenant via `set request.jwt.claims` / the `asTenant()` shim (§8), and the
membership-lookup branch is exercised by directly seeding `tenant_users` (§8/MED-4). **Spot-check
before merge:** run the full `db` vitest project after M3 and confirm every pre-existing
`*.db.test.ts` is still green — this is the CRIT-2 regression gate, not an assumption.

**Honesty flag (not needed at practice scale):** on a large real dataset, `set not null` validation
would want `not valid` + `validate constraint` two-step to avoid a long lock. At this farm's scale
the single-pass `set not null` is fine.

---

## 8. Cross-tenant probe-test spec (fails today, passes after P4-S0)

**File:** `src/test/db/p4s0_tenant_isolation.db.test.ts` (auto-picked by the `db` vitest project
glob). **Harness addition** (additive, keeps `rls-posture.db.test.ts` green) — an `asTenant()`
helper in `src/test/db/pgliteHarness.ts` that stamps the tenant claim in ONE place. **[review-hardened]
The claim shape must match what `current_tenant_id()` reads (§3): `app_metadata.tenant_id` is the
fast-path uuid, and `sub` must be a real uuid (the helper casts `sub` to uuid), so use a uuid sub —
not `user-${tenantId}`:**

```ts
// tenantId is a uuid; userId is a uuid (so the `sub`-keyed membership lookup is testable too)
export async function asTenant<T>(h, tenantId, fn, userId?) {
  return asAuthenticated(h, fn, { role: "authenticated",
                                  sub: userId ?? tenantId,          // uuid, cast-safe in current_tenant_id()
                                  app_metadata: { tenant_id: tenantId } });
}
```

**Seed (`beforeAll`, `hookTimeout: 60000`):** `freshDb()`, then **as owner** (postgres bypasses RLS
— the only way to plant B's rows regardless of policy) seed two structurally-identical graphs:
tenant **A** (`pA, wA, JC-A00, harvest, batch, …` one row per table) and tenant **B** (mirror). Where
rows are minted by an RPC, seed via the RPC **under `asTenant(h,'A')`** so the write-path stamp is
exercised. Seeding both as owner is correct — B's data legitimately exists; the only question is
whether A's *session* can reach it.

> **[review-hardened] Owner-path inserts must pass `tenant_id` literally (MED-2).** Once the columns
> are `not null default current_tenant_id()`, an owner-role insert that *omits* `tenant_id` resolves
> the default under a claimless session — and with **two** tenants seeded the §3 single-tenant fallback
> is NULL, so the insert **violates NOT NULL** at seed time. Every owner-side insert in the probe seed
> must therefore set `tenant_id` explicitly (`insert into <t> (tenant_id, …) values ('<A or B uuid>',
> …)`). Document in the test that `default current_tenant_id()` is NULL under the owner role here —
> the default is an ergonomic for *authenticated* inserts, not a seed shortcut.
>
> **Seeding two tenants is also what arms the strict fail-closed guard:** with `count(*) from tenants
> = 2`, the single-tenant fallback (§3) returns NULL for a claimless session, so the "claimless
> fail-closed" assertions below test the *real* guard, not the convenience fallback.

**Assertion matrix (generated from a shared `TENANT_TABLES` list, never hand-drifted):**

1. **Read isolation — ~54 tables × 2:** as tenant A, `select tenant_id from <t>` → all rows `=== 'A'`
   AND `length > 0` (not vacuous); and `select 1 from <t> where id = <B's known row>` → `length 0`.
   The `where id = <B's row>` form is the strong assertion — `using(true)` returns the row (RED
   today), `tenant_id = current_tenant_id()` returns nothing (GREEN after).
2. **Write isolation — 26 RPCs × cross-tenant target:** call each RPC **as A pointed at a B-owned
   entity** (e.g. `record_cherry_intake(p_plot_id='pB', p_worker_id='wB')`,
   `materialize_green_lot('JC-B00')`, `approve_pay_line(<B line>)`, `record_dispatch_ack(<B run>)`,
   `place_qc_hold(<B lot>)`) → `rejects.toThrow(/tenant|not found|permission|denied|violates/i)`,
   **AND** re-read B's row **as owner** and assert byte-identical (catches a definer fn that raised
   *after* mutating — proves Move C, not just an error).
   - **[review-hardened] Same-idempotency-key cross-tenant probe (HIGH-1).** Call an idempotent RPC
     (e.g. `record_attendance` / `record_cherry_intake`) **as A** and **as B** with the **identical**
     `p_idempotency_key='intake-2026-06-21-001'`. Assert each returns a **different, own-tenant** row
     (A's call returns A's `event_uid`/`lot_code`; B's returns B's — never A's). On the pre-fix code
     (early-return SELECT keyed on `idempotency_key` only) B would short-circuit and **return A's
     row** → RED; after Move D's `and tenant_id = v_tenant` clamp → GREEN. This is the assertion the
     original spec was missing (it only tested cross-tenant *target entities*, never key collision).
3. **Matview isolation (keystone) — 2 matviews:** `refresh materialized view <mv>` as owner, then as
   tenant A `select green_lot_code from <mv>` → no `JC-B*` rows. (Assert through the
   `security_barrier`/accessor P4-S0 introduces, not the raw matview, if the design picks the
   wrapper.) **This block is what stops a "tables-only" P4-S0 from shipping a leak** — a table-only
   probe would pass while the matview still exposes all tenants' COGS.
4. **Static parity guard — driven off `pg_class`, not a hand literal (HIGH-2).** **[review-hardened]**
   The original "for each table in `TENANT_TABLES` …" form only checks the tables you *remembered* to
   list — it cannot catch a table you *forgot*. Instead, after replaying all migrations, query
   `pg_class`/`pg_policy` for **every base table with RLS enabled** (`relrowsecurity = true`,
   `relkind = 'r'`, schema `public`) and assert each is **either** in `TENANT_TABLES` (and the raw
   P4-S0 SQL shows it gained `tenant_id` + `not null` + `references tenants(id)` and had its
   `using(true)`/`with check(true)` swapped for `current_tenant_id()`/`tenant_id`) **or** in the
   explicit `EXEMPT` allowlist (`units`, `lot_yield_curve`, `statutory_rates`, plus `tenants` and
   `tenant_users` themselves — justified in-comment). A new RLS-enabled base table that is in neither
   set **reds the suite** — this is what catches "added a 55th table later but forgot `tenant_id`,"
   the "keep guardrails alive" rule made enforceable. The `TENANT_TABLES` array the migration loops is
   the *same constant* the test imports, so the migration and the guard cannot drift.
5. **[review-hardened] Membership-lookup branch test (MED-4).** The plan calls the `tenant_users`
   membership lookup its "primary trust anchor," yet **nothing currently exercises it** — `auth.users`
   is empty in PGlite so the M1 backfill is a no-op, `tenant_users` is empty, and the probe's
   `asTenant` only stamps the `app_metadata.tenant_id` fast-path. So the only branch under test is the
   "later optimization" claim, never the SSOT anchor. Add a focused test: seed two tenants, **insert a
   `tenant_users` row directly** (`(tenant_B_id, some_user_uuid, 'owner')`), then call
   `current_tenant_id()` with `request.jwt.claims = {sub: some_user_uuid, role:'authenticated'}` and
   **no `app_metadata`** → assert it returns `tenant_B_id` (the `sub`-keyed membership arm, not the
   fast path, not the single-tenant fallback). This is the only test that proves the membership lookup
   actually resolves.

**Falsifiability (mandatory "fails for the right reason"):** a `describe("P4-S0 falsifiability")`
block replays migrations **up to and excluding** the P4-S0 files (`freshDb({ only: [...pre-P4-S0] })`),
seeds A+B, and asserts the **opposite** — that under today's `using(true)`, A's session *can* read
B's rows (a returned row, not an import error). This proves the GREEN comes specifically from the
P4-S0 migration, not a harness quirk. Mirrors `rls-posture.db.test.ts`'s init-only delta pattern.

**Additional targeted assertions** (from the RLS facet — fold into the matrix): insert-forge
rejection (explicit foreign `tenant_id` fails `with check`); update-rehome rejection; COGS leak
(`cogs_per_lot` from B on A's lot → NULL); oversell-pool isolation (A reservations don't count
against B's ATP); same-tenant FK guard (a `dispatch_run` with `tenant_id=A` + `crew_id` of B raises,
MED-1); ledger stamp-integrity (an owner-injected `lot_event` with a mismatched `tenant_id` raises via
the BEFORE-INSERT assert, HIGH-3); **claimless fail-closed — with two tenants seeded** so the §3
single-tenant fallback is NULL: a no-claim session sees nothing and every RPC raises (proves the
strict guard, not the convenience fallback). Each **fails on the pre-retrofit `using(true)` code and
passes after** — the bug→test-same-commit + promise→enforcement gates.

---

## 9. Open questions / risks for Andres

1. **🔴 Ledger canonical-bytes is the single highest-risk decision.** Recommendation: add `tenant_id`
   as a **non-hashed** column on `lot_event`/`worker_stream_event`/`attendance_event`/`weigh_event`
   and enforce via RLS + filtered head-select — this **preserves every historical hash** and keeps
   `verify_chain` green on old rows. The alternative (fold `tenant_id` into
   `lot_event_canonical_bytes` / tenant-prefix `stream_key`) re-keys genesis and **breaks
   verification on all history** unless you re-baseline. Confirm we take the non-hashed path.
2. **🔴 Global vs per-tenant lot codes (`lot_code_seq`).** Per-tenant `JC-001…` is nicer for a
   farm-ops product but forces **composite `(tenant_id, code)` keys everywhere a lot code appears**
   (lots PK, lot_edges FKs, green_lots, matview indexes, cost_entry.target_code, ledger
   `(device_id,device_seq)`) — the biggest schema blast radius in the slice. Keep global = simplest,
   but leaks cross-tenant write-volume via code gaps. **Which do we ship?**
3. **Tenant-derivation: ship the membership-lookup `current_tenant_id()` now (SSOT, $0, no hook), add
   the JWT `app_metadata` claim later as a fast-path cache?** Confirm — both resolve to the same
   tenant so policies don't change. And confirm a free-tier Custom Access Token Hook (or the
   `after insert on auth.users` trigger) is acceptable for claim minting. **[review-hardened] The
   helper SQL is now nailed down (§3): reads `sub`/`role` from `current_setting('request.jwt.claims',
   true)` — never `auth.uid()` (CRIT-1) — with a single-tenant fallback so the existing suite stays
   green (CRIT-2), and the membership-lookup branch is now actually tested (§8 block 5 / MED-4). These
   are mechanics, not open decisions; only the "is a claim hook acceptable later" question above is
   open.**
4. **No FK from `tenant_users.user_id` → `auth.users`** is deliberate (PGlite replay + avoid coupling
   to Supabase-internal `auth` DDL); integrity is trigger-enforced. Confirm the team accepts this.
5. **`dispatch_run` direct vs inherited tenant_id** — recommend direct (dispatch RLS stands alone,
   avoids a 3-hop derivation); it has a `crew_id→crews` FK so inheriting is also defensible.
6. **`ferment_recipes`** — per-tenant IP (recommend direct) vs a shared global recipe library?
   `ferment_batches.recipe_id` should not point at another farm's recipe → leaning per-tenant.
7. **`statutory_rates`** stays global (Panama national law). Flag: if a tenant ever operates in
   another jurisdiction it must become per-tenant. `lot_yield_curve` global unless per-farm curves
   are wanted.
8. **Config-returning DEFINER fns** `_weigh_geofence_radius_m()` / `_ipm_threshold()` — confirm
   geofence radius / IPM threshold are per-tenant (each farm's plots differ).
9. **Pre-existing out-of-scope bug (flag, not fix):** `verify_chain` reads **only `lot_event`** and
   returns `TRUE` for attendance/weigh streams living in other tables (confirmed by
   `src/test/db/_s1repro.db.test.ts`). There is **no integrity verifier** for `worker_stream_event`,
   `attendance_event`, or `weigh_event` — the labor-law/payroll evidence chains. Under tenancy this
   matters more; recommend a follow-up slice adds per-ledger verifiers.
10. **`role` in `tenant_users` is not yet enforced in any policy** (single-owner today) — the
    role-based policy matrix is a later slice.

---

**Cited files (all under `/Users/andres/coffee-farm-operations-worktrees/phase1-deliver/`):**
`supabase/migrations/20260620140000_auth_required_rls.sql` (RLS-swap `do $$ foreach` idiom + anon
revoke), `20260620160000_write_foundation.sql` (loop-driven column-add + per-table policy),
`20260620120000_init.sql` (plots/lots/workers/harvests roots; reconstructed views),
`20260621092000_event_log_units_lot_graph.sql` (lot_event, `lot_code_seq`,
`lot_event_canonical_bytes`, `verify_chain`, mass guards, units/lot_yield_curve),
`20260621093500_green_inventory.sql` (green_lots, `prevent_oversell`, ATP),
`20260621094000_costing.sql` (matviews, `cogs_*`, `refresh_lot_cost`, cost_entry orphan),
`20260622090000_people_system.sql` (workers/crews subtree, ledgers, `_backfill_people` precedent,
`next_server_seq`), `20260622094000_drying_reposo.sql`, `20260622096000_qc_cupping.sql`,
`20260622100000_harvest_planning.sql`, `20260622102000_weigh_capture.sql`,
`20260622104000_crew_dispatch.sql` (`generate_dispatch`),
`20260622106000_remote_sensing_ipm.sql`, `20260622108000_payroll.sql` (`compute_pay_period`,
`farm_season_config`, `statutory_rates` — current max migration), `src/test/db/pgliteHarness.ts`,
`src/test/db/rls-posture.db.test.ts`, `src/test/db/migration-grants.db.test.ts`,
`src/lib/db/commands/*`, `src/lib/db/cogs.ts`, `docs/design/PHASE4-DESIGN.md`.
