-- S7 — Activity-based COGS: true cost-per-kg-green, the number the business turns on.
--
-- One APPEND-ONLY `cost_entry` ledger (D-COST-1) tags every cost to a driver
-- (worker-day | task | processing-batch) and an allocation target (plot | lot | farm)
-- under one of FOUR documented allocation rules:
--   1. direct-labor → lot   : the whole amount lands on that lot.
--   2. processing   → lot   : the whole amount lands on that lot.
--   3. agronomy     → plot  : split across the plot's lots by harvested cherries-kg share.
--   4. overhead     → farm  : split across ALL green lots pro-rata by their green-kg.
-- Corrections are REVERSING ENTRIES — a negative-amount row pointing at the original
-- via `reverses_id`, NEVER an UPDATE/DELETE. The ledger therefore doubles as the
-- future QBO/Xero journal source AND the audit trail. An immutability trigger
-- physically rejects UPDATE/DELETE, so the only legal write is an append.
--
-- mv_lot_cost is THE one earned materialized view (ADR-003 / D4 exception): a
-- recursive walk DOWN the lot graph apportioning each cost over green-kg. It is the
-- one place a SUM/GROUP-BY-over-a-recursive-CTE is worth caching; everything else in
-- the app is a plain security_invoker view. Refreshed on the write path via
-- refresh_lot_cost() (the same seam that busts the cache tag, D5).
--   * Green-kg denominator = the green lot NODE's mass (current_kg ?? origin_kg),
--     DEGRADING to processing_batches.current_kg WHERE stage='green' for that lot_code
--     until the lot graph is fully populated.
--   * cost-per-kg-green is NULL (never a divide-by-zero raise) when green-kg is 0.
--
-- cogs_per_lot()/cogs_per_plot() are security_invoker functions exposed via .rpc()
-- (RLS-respecting; they read the matview + base tables as the caller).
--
-- SPIKE (AD-9) result: PGlite 0.5.x DOES support CREATE MATERIALIZED VIEW, plain
-- REFRESH, REFRESH ... CONCURRENTLY (needs a UNIQUE index), and recursive CTEs.
-- BUT `REFRESH ... CONCURRENTLY` cannot run inside a transaction block on real
-- Postgres, and PostgREST wraps every RPC call in one — so refresh_lot_cost() uses
-- PLAIN `refresh materialized view` (safe inside the request txn; this $0 app has no
-- concurrent-reader pressure). The UNIQUE index on green_lot_code is created anyway
-- (cheap; keeps the CONCURRENTLY escape hatch open for a future out-of-txn caller).
--
-- GRANTS (AD-8 + the S3/S5 SECURITY-DEFINER lesson): cost_entry + mv_lot_cost get an
-- explicit `grant select ... to authenticated`; cost_entry gets INSERT-only to
-- authenticated (the one legal append path — no UPDATE/DELETE grant, matching the S5
-- claim-table posture); nothing to anon. The refresh helper is a security definer fn
-- (it must REFRESH a matview owned by the table owner) so it FIRST revokes EXECUTE
-- from public, THEN grants only to authenticated. cogs_per_lot/cogs_per_plot are
-- security_invoker and likewise have PUBLIC execute revoked + authenticated granted.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. cost_entry — the APPEND-ONLY costing ledger.
--    driver       : what generated the cost (worker-day | task | processing-batch).
--    allocation_rule + target_kind/target_code: how it is apportioned (the 4 rules).
--    amount_usd   : signed — a negative row is a reversal of `reverses_id`.
--    reverses_id  : self-FK to the row this one corrects (null for an original).
-- ──────────────────────────────────────────────────────────────────────────
create table cost_entry (
  id              bigint generated always as identity primary key,
  driver          text    not null check (driver in ('worker-day','task','processing-batch')),
  allocation_rule text    not null check (allocation_rule in ('direct-labor','processing','agronomy','overhead')),
  target_kind     text    not null check (target_kind in ('plot','lot','farm')),
  -- target_code points at plots.id (plot), lots.code (lot), or is NULL for farm-wide
  -- overhead. Un-FK'd on purpose: the rule already constrains shape, and a farm row
  -- has no target; a hard FK would also fight the two id namespaces (plot vs lot).
  target_code     text,
  amount_usd      numeric not null,
  reverses_id     bigint  references cost_entry(id),
  memo            text,
  occurred_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  -- shape guard: farm-wide rows carry no target; plot/lot rows must name one.
  check ((target_kind = 'farm' and target_code is null)
      or (target_kind in ('plot','lot') and target_code is not null)),
  -- a reversal is a negative-amount row; an original is non-negative.
  check ((reverses_id is null and amount_usd >= 0)
      or (reverses_id is not null and amount_usd <= 0))
);
create index cost_entry_target_idx on cost_entry (target_kind, target_code);
create index cost_entry_rule_idx   on cost_entry (allocation_rule);

-- ──────────────────────────────────────────────────────────────────────────
-- 2. cost_entry_immutable — APPEND-ONLY enforcement at the data layer. The ledger
--    is the QBO journal source + audit trail, so a row can never be edited or
--    removed; corrections are reversing entries. This BEFORE UPDATE/DELETE trigger
--    fails closed (matches the S5 claim-table append-only posture, but stronger —
--    here even the owner is blocked, because an edited journal is a falsified one).
-- ──────────────────────────────────────────────────────────────────────────
create or replace function cost_entry_immutable() returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  raise exception
    'cost_entry is append-only: % is not permitted — post a reversing entry instead',
    tg_op
    using errcode = 'restrict_violation';
end $$;

create trigger cost_entry_no_update before update on cost_entry
  for each row execute function cost_entry_immutable();
create trigger cost_entry_no_delete before delete on cost_entry
  for each row execute function cost_entry_immutable();

-- ──────────────────────────────────────────────────────────────────────────
-- 3. green_lot_mass — the green-kg denominator, with the documented degradation:
--    prefer the green lot NODE's declared mass (current_kg ?? origin_kg); fall back
--    to processing_batches.current_kg WHERE stage='green' for that lot_code until the
--    lot graph carries the mass. A security_invoker helper view so it inherits RLS.
-- ──────────────────────────────────────────────────────────────────────────
create view green_lot_mass with (security_invoker = on) as
  select
    l.code as green_lot_code,
    coalesce(
      nullif(coalesce(l.current_kg, l.origin_kg), 0),         -- node mass, if > 0
      (select pb.current_kg                                    -- else degrade to batch
         from processing_batches pb
        where pb.lot_code = l.code and pb.stage = 'green'
        order by pb.started_date desc
        limit 1)
    ) as green_kg
  from lots l
  where l.stage = 'green';

-- ──────────────────────────────────────────────────────────────────────────
-- 4. cost_alloc_by_rule — the apportionment engine, resolved per
--    (green-lot, allocation_rule). This is the SSOT the per-category card
--    build-up (waterfall + decomposition) reads, so the breakdown ALWAYS
--    reconciles to the cost-per-kg-green HEADLINE — it is literally the same
--    allocation, just not yet summed over rules. (Before this, the card read a
--    lot-literal cost_entry ledger that excluded the walked-down source costs,
--    the agronomy plot split, and the farm-overhead pro-rata, so the build-up
--    silently understated and contradicted its own total — D-COST review CRIT.)
--
--    Stage A — resolve plot/farm targets onto LOTS, carrying the rule:
--      * lot   target  -> that lot, full amount.
--      * plot  target  -> the plot's lots, split by Σcherries_kg share (agronomy).
--      * farm  target  -> deferred to stage C (needs green-kg, computed after the walk).
--    Stage B — recursive walk DOWN lot_edges: a cost on any lot flows to its green
--      descendants, apportioned by edge kg / Σ(parent's outgoing kg) at each branch.
--      A lot that is itself green (a terminal) keeps its share.
--    Stage C — farm/overhead rows split across ALL green lots pro-rata by green-kg.
--
--    cost_per_green_lot (below) is then just Σ(allocated_cost) over the rules, so
--    mv_lot_cost / cogs_per_lot keep the SAME numeric value — the per-rule view is
--    additive, never a second source of truth for the total.
-- ──────────────────────────────────────────────────────────────────────────
create view cost_alloc_by_rule with (security_invoker = on) as
with recursive
  -- net amount per ledger row (reversals are just negative rows; we sum signed).
  entries as (
    select id, allocation_rule, target_kind, target_code, amount_usd
      from cost_entry
  ),
  -- Stage A: lot-or-plot-targeted costs resolved onto a (entry, rule, lot, amount) seed.
  lot_seed as (
    -- direct lot targets (rules direct-labor / processing, and any lot-targeted row)
    select e.id as entry_id, e.allocation_rule, e.target_code as lot_code, e.amount_usd as amount
      from entries e
     where e.target_kind = 'lot'
    union all
    -- agronomy → plot: split across the plot's lots by harvested cherries_kg share.
    select e.id as entry_id, e.allocation_rule, hs.lot_code,
           e.amount_usd * (hs.lot_kg / nullif(hs.plot_kg, 0)) as amount
      from entries e
      join (
        select h.plot_id,
               h.lot_code,
               sum(h.cherries_kg) as lot_kg,
               sum(sum(h.cherries_kg)) over (partition by h.plot_id) as plot_kg
          from harvests h
         group by h.plot_id, h.lot_code
      ) hs on hs.plot_id = e.target_code
     where e.target_kind = 'plot'
  ),
  -- Stage B: walk each seeded lot's amount DOWN the graph to its green descendants,
  -- carrying the rule. factor = product of (edge kg / parent outgoing kg) along the
  -- path. A green node terminates the walk (keeps its accumulated factor).
  walk as (
    -- base: the seeded lot itself, factor 1.
    select s.entry_id, s.allocation_rule, s.lot_code, s.lot_code as cur_code,
           s.amount, 1::numeric as factor
      from lot_seed s
    union all
    -- descend one edge: split the running factor by this edge's mass share.
    select w.entry_id, w.allocation_rule, w.lot_code, e.child_code, w.amount,
           w.factor * (e.kg / po.out_kg) as factor
      from walk w
      join lots cur on cur.code = w.cur_code
      -- only descend out of NON-green nodes (a green node is terminal).
      join lot_edges e on e.parent_code = w.cur_code and cur.stage is distinct from 'green'
      join (
        select parent_code, sum(kg) as out_kg from lot_edges group by parent_code
      ) po on po.parent_code = e.parent_code
  ),
  -- the green terminals reached by the walk, per rule.
  direct_alloc as (
    select w.cur_code as green_lot_code, w.allocation_rule, sum(w.amount * w.factor) as amount
      from walk w
      join lots g on g.code = w.cur_code and g.stage = 'green'
     group by w.cur_code, w.allocation_rule
  ),
  -- green-kg per green lot (with the documented degradation).
  masses as (
    select green_lot_code, green_kg from green_lot_mass
  ),
  -- Stage C: farm/overhead rows split across ALL green lots pro-rata by green-kg,
  -- KEEPING the rule (a non-'overhead' farm row, were one booked, shows under its
  -- own rule rather than being silently merged into a single overhead bucket).
  farm_by_rule as (
    select allocation_rule, coalesce(sum(amount_usd), 0) as amount
      from entries where target_kind = 'farm'
     group by allocation_rule
  ),
  green_kg_total as (
    select coalesce(sum(green_kg), 0) as total from masses
  ),
  overhead_alloc as (
    select m.green_lot_code, f.allocation_rule,
           f.amount * (m.green_kg / nullif((select total from green_kg_total), 0)) as amount
      from masses m
      cross join farm_by_rule f
  )
  select green_lot_code, allocation_rule, sum(amount) as allocated_cost
    from (
      select green_lot_code, allocation_rule, amount from direct_alloc
      union all
      select green_lot_code, allocation_rule, amount from overhead_alloc
    ) u
   group by green_lot_code, allocation_rule;

-- cost_per_green_lot — per-green-lot TOTAL cost + green-kg. Now a thin aggregate
-- over cost_alloc_by_rule (Σ over rules), driven by green_lot_mass so EVERY green
-- lot appears (cost 0, not absent, when it has no costs yet). mv_lot_cost /
-- cogs_per_lot read this unchanged; the value is identical to the pre-per-rule
-- engine (same allocation, just summed).
create view cost_per_green_lot with (security_invoker = on) as
  select
    m.green_lot_code,
    coalesce(
      (select sum(r.allocated_cost) from cost_alloc_by_rule r
        where r.green_lot_code = m.green_lot_code),
      0
    ) as total_cost,
    m.green_kg
  from green_lot_mass m;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. mv_lot_cost — THE one earned materialized view (ADR-003 exception). Caches the
--    per-green-lot total cost + green-kg + the derived cost-per-kg-green. NULL when
--    green-kg is 0/undeclared (never a divide-by-zero). Refreshed on the write path.
--    NOTE: a materialized view is NOT security_invoker — it materializes as the owner
--    — so it is NOT exposed raw to PostgREST writes; reads go through the SELECT grant
--    (single-tenant app, authenticated-only read posture) and the .rpc() functions.
-- ──────────────────────────────────────────────────────────────────────────
create materialized view mv_lot_cost as
  select
    c.green_lot_code,
    c.total_cost,
    c.green_kg,
    case
      when c.green_kg is null or c.green_kg = 0 then null   -- no divide-by-zero
      else c.total_cost / c.green_kg
    end as cost_per_kg_green
  from cost_per_green_lot c;

-- UNIQUE index: required for REFRESH ... CONCURRENTLY (kept as an escape hatch even
-- though refresh_lot_cost() uses a plain refresh — see header). Also speeds lookups.
create unique index mv_lot_cost_pk on mv_lot_cost (green_lot_code);

-- mv_lot_cost_by_rule — the per-(green-lot, allocation_rule) allocated cost,
-- materialized so the per-category card build-up reads the SAME allocation as the
-- headline (no lot-literal-ledger divergence). Σ(allocated_cost) over a lot's rows
-- == that lot's mv_lot_cost.total_cost by construction. Refreshed alongside
-- mv_lot_cost on the write path.
create materialized view mv_lot_cost_by_rule as
  select green_lot_code, allocation_rule, allocated_cost
    from cost_alloc_by_rule;

create unique index mv_lot_cost_by_rule_pk
  on mv_lot_cost_by_rule (green_lot_code, allocation_rule);

-- ──────────────────────────────────────────────────────────────────────────
-- 6. refresh_lot_cost — the write-path refresh. SECURITY DEFINER (it must REFRESH a
--    matview owned by the table owner). PLAIN refresh, NOT concurrently: PostgREST
--    runs each RPC in a txn and `refresh ... concurrently` is illegal inside one.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function refresh_lot_cost() returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  refresh materialized view mv_lot_cost;
  refresh materialized view mv_lot_cost_by_rule;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 7. cogs_per_lot / cogs_per_plot — the .rpc() read surface (security_invoker so
--    they read the matview/base tables under the caller's RLS).
--    cogs_per_lot  : cost-per-kg-green for one green lot (NULL on zero yield).
--    cogs_per_plot : the plot's green lots' total cost over their total green-kg
--                    (a green lot "belongs" to a plot iff a harvest tied that plot to
--                    the lot's lineage — resolved via the seed/edge walk's lot_seed).
-- ──────────────────────────────────────────────────────────────────────────
create or replace function cogs_per_lot(p_lot_code text) returns numeric
  language sql
  security invoker
  stable
  set search_path = public
as $$
  select cost_per_kg_green from mv_lot_cost where green_lot_code = p_lot_code;
$$;

-- cogs_breakdown_per_lot — the per-rule cost build-up BEHIND a lot's headline
-- (security_invoker; reads mv_lot_cost_by_rule under the caller's RLS). The four
-- rows (or fewer) sum to the lot's total_cost, so the card's waterfall +
-- decomposition + per-category readouts reconcile to cost-per-kg-green EXACTLY
-- instead of reading a lot-literal ledger that omitted overhead/agronomy/walked
-- source costs. Returns nothing for an uncosted/absent green lot (card shows 0s).
create or replace function cogs_breakdown_per_lot(p_lot_code text)
  returns table(allocation_rule text, allocated_cost numeric)
  language sql
  security invoker
  stable
  set search_path = public
as $$
  select allocation_rule, allocated_cost
    from mv_lot_cost_by_rule
   where green_lot_code = p_lot_code;
$$;

create or replace function cogs_per_plot(p_plot_id text) returns numeric
  language sql
  security invoker
  stable
  set search_path = public
as $$
  -- the green lots descended from this plot = green terminals reachable from the
  -- plot's harvested lots. cost-per-kg-green at the plot level = Σcost / Σgreen-kg
  -- (NULL when no green-kg, no divide-by-zero).
  with recursive plot_lots as (
    select distinct h.lot_code from harvests h where h.plot_id = p_plot_id
  ),
  -- walk down from each of the plot's harvested lots to its green terminals.
  walk as (
    select pl.lot_code as cur_code from plot_lots pl
    union
    select e.child_code
      from walk w
      join lots cur on cur.code = w.cur_code and cur.stage is distinct from 'green'
      join lot_edges e on e.parent_code = w.cur_code
  ),
  green_terminals as (
    select distinct w.cur_code as green_lot_code
      from walk w join lots g on g.code = w.cur_code and g.stage = 'green'
  )
  select case
           when coalesce(sum(m.green_kg), 0) = 0 then null
           else sum(m.total_cost) / sum(m.green_kg)
         end
    from mv_lot_cost m
    join green_terminals gt on gt.green_lot_code = m.green_lot_code;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 8. RLS — authenticated-only read on cost_entry (mirrors the S3/S5 posture). The
--    matview is not an RLS-able relation (PostgREST exposes it read-only); its
--    SELECT grant alone gates it. cost_entry is APPEND-ONLY for clients: an INSERT
--    policy exists; no update/delete policy (and the immutability trigger blocks both
--    even for the owner).
-- ──────────────────────────────────────────────────────────────────────────
alter table cost_entry enable row level security;
create policy "authenticated read"   on cost_entry for select to authenticated using (true);
create policy "authenticated append" on cost_entry for insert to authenticated with check (true);

-- ──────────────────────────────────────────────────────────────────────────
-- 9. GRANTS (AD-8) — explicit SELECT on the ledger + matview; INSERT-only on the
--    ledger (the one legal append path; no UPDATE/DELETE to ANY role); nothing to
--    anon. The definer refresh fn slams PUBLIC EXECUTE shut then grants only to
--    authenticated; the security_invoker .rpc() fns do the same (they read RLS-
--    protected data, so leftover PUBLIC execute must not survive — match S5).
-- ──────────────────────────────────────────────────────────────────────────
grant select on cost_entry          to authenticated;
grant select on mv_lot_cost         to authenticated;
grant select on mv_lot_cost_by_rule to authenticated;
-- the views are helpers the matview/fns read; grant select for completeness/debug
grant select on green_lot_mass      to authenticated;
grant select on cost_per_green_lot  to authenticated;
grant select on cost_alloc_by_rule  to authenticated;

-- append-only client write: INSERT only (UPDATE/DELETE never granted — the
-- immutability trigger + missing policy make a destructive path impossible).
grant insert on cost_entry to authenticated;

-- CRITICAL (S3/S5 lesson): Postgres grants EXECUTE to PUBLIC on every new function.
-- refresh_lot_cost is SECURITY DEFINER (runs as the owner) — slam PUBLIC shut FIRST.
revoke execute on function refresh_lot_cost()          from public;
revoke execute on function cogs_per_lot(text)          from public;
revoke execute on function cogs_per_plot(text)         from public;
revoke execute on function cogs_breakdown_per_lot(text) from public;
-- cost_entry_immutable() is a trigger fn (never a caller-facing RPC) — no grant; the
-- AD-8 static guard excludes trigger fns by their not being granted execute.
grant execute on function refresh_lot_cost()           to authenticated;
grant execute on function cogs_per_lot(text)           to authenticated;
grant execute on function cogs_per_plot(text)          to authenticated;
grant execute on function cogs_breakdown_per_lot(text) to authenticated;

commit;
