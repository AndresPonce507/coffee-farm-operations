-- Season-input hardening — follows S4 (20260621093000), which moved the season
-- INPUTS (target_kg, ytd_revenue_usd) out of season_summary into farm_season_config.
-- The non-negative guards db_hardening (20260621100000) originally placed on
-- season_summary belong on their new home now that season_summary is renamed aside.
--
-- harvested_kg / today_kg are no longer stored — season_summary_view derives them
-- from harvests, where the cherries_kg > 0 constraint already guarantees
-- non-negativity — so they need no constraint here.
--
-- Non-destructive: the seeded config row (target 190000, revenue 486500) satisfies both.

begin;

alter table farm_season_config
  add constraint farm_season_target_nonneg  check (target_kg       >= 0),
  add constraint farm_season_revenue_nonneg check (ytd_revenue_usd >= 0);

commit;
