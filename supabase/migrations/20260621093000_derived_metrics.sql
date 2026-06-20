-- S4 — derived-metrics semantic layer (ADR-003 + AD-4 honest provenance).
--
-- The four derived views (daily/weekly/variety/season) already compute the dashboard
-- aggregates from the harvests the owner logs (see 20260620170000_computed_aggregates).
-- This migration closes the last honesty gap in the SEASON HEADLINE:
--
--   season_summary_view still read its target_kg + ytd_revenue_usd from a hand-authored
--   `season_summary` table — mixing genuine INPUTS with computed totals in a row that
--   could silently DISAGREE with the harvests truth. A goal (target) is an INPUT, not a
--   derived number; modeled revenue is an INPUT until real sales exist (S5). Both belong
--   in ONE owned place.
--
-- So S4:
--   1. introduces `farm_season_config` — a 1-row config holding the genuine inputs
--      (target_kg, ytd_revenue_usd), seeded with the values season_summary held.
--   2. CREATE OR REPLACEs season_summary_view to read the inputs from the config while
--      STILL summing harvested_kg/today_kg from harvests — keeping the EXACT column set
--      src/lib/db/trends.ts mapSeason expects (id, target_kg, harvested_kg, today_kg,
--      ytd_revenue_usd) and the id = 1 single() contract.
--   3. renames ASIDE (ALTER ... RENAME TO <name>__deprecated — NOT drop, a one-line
--      rollback) every base aggregate table no view/getter reads anymore:
--      daily_cherries / weekly_harvest / variety_shares (the views compute from
--      harvests) and season_summary (its view now reads the config). The data is kept,
--      just unreachable under the old name — so a getter still pointing at an old
--      aggregate name fails loud instead of silently serving stale numbers.

begin;

-- ── 1. farm_season_config: the genuine season INPUTS, in one owned place ──────
-- Singleton (id = 1, enforced by the check) so getSeason()'s `.eq(id,1).single()`
-- contract has exactly one config row to read its inputs from.
create table farm_season_config (
  id              integer primary key default 1 check (id = 1),
  target_kg       numeric not null,   -- the season goal (an input, set by the owner)
  ytd_revenue_usd numeric not null    -- modeled until S5 sales exist (an input, not derived)
);

-- Seed with the values the old season_summary row carried (target 190000, revenue
-- 486500) so the headline is unchanged the moment this migration lands. Idempotent.
insert into farm_season_config (id, target_kg, ytd_revenue_usd)
  values (1, 190000, 486500)
  on conflict (id) do nothing;

-- AD-8: read-only config. authenticated reads it; anon reads nothing; nobody writes.
-- (default privileges are locked since grant_hygiene, so the grant must be explicit.)
alter table farm_season_config enable row level security;
create policy "authenticated read" on farm_season_config
  for select to authenticated using (true);
grant select on farm_season_config to authenticated;

-- ── 2. season_summary_view: inputs from config, totals from harvests ──────────
-- CREATE OR REPLACE keeps the view name (the seam trends.ts reads) and the column set
-- mapSeason expects. The inputs now come from farm_season_config; harvested_kg/today_kg
-- stay SUMMED from harvests so the headline can never disagree with the logged truth.
create or replace view season_summary_view with (security_invoker = on) as
  select c.id,
         c.target_kg,
         c.ytd_revenue_usd,
         (select coalesce(sum(cherries_kg), 0) from harvests)::numeric as harvested_kg,
         (select coalesce(sum(cherries_kg), 0) from harvests
            where date = (select max(date) from harvests))::numeric as today_kg
  from farm_season_config c;

-- AD-8: re-grant SELECT explicitly on the replaced view (CREATE OR REPLACE preserves
-- grants, but be explicit so the grant guard's per-object scan sees it on this object).
grant select on season_summary_view to authenticated;

-- ── 3. rename aside the now-unreferenced base aggregate tables ─────────────────
-- After step 2, NO view or getter reads any of these (the four views compute from
-- harvests + the config). Rename — NOT drop — so the data survives and rollback is a
-- one-line `ALTER ... RENAME TO <orig>`. RLS/policies/grants travel with the table
-- under its new name; nothing reads it, so its posture is moot.
alter table daily_cherries  rename to daily_cherries__deprecated;
alter table weekly_harvest  rename to weekly_harvest__deprecated;
alter table variety_shares  rename to variety_shares__deprecated;
alter table season_summary  rename to season_summary__deprecated;

commit;
