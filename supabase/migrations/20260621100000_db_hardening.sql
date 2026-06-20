-- DB hardening — closes two gaps left by the earlier migrations.
--
--   (1) Removes the dead `grant select … to anon` on the six computed-aggregate
--       views (20260620170000). anon is ALREADY blocked by security_invoker +
--       the revoked underlying-table grants (verified 401 in prod), so this grant
--       never actually let anon read anything — it is purely misleading. The
--       authenticated owner keeps its SELECT (the app reads as authenticated).
--   (2) Fills CHECK-coverage holes write_foundation + plot_geometry left open:
--       season_summary magnitudes, the plot-geometry columns (forward guards —
--       all currently NULL), plots.harvested_kg and workers.today_kg.
--
-- Non-destructive: every current row already satisfies every constraint (audited
-- against live data before authoring — season figures positive, harvested_kg ≥ 0,
-- today_kg ≥ 0, geometry columns NULL, reserve area > 0).

begin;

-- (1) Revoke the dead anon grants on the six computed-aggregate views, plus a
--     belt-and-suspenders revoke on the two init detail views (harvests_view,
--     tasks_view) — those already lost their anon SELECT in 20260620140000, so
--     that half is a harmless no-op (REVOKE of an un-held privilege is silent).
--     `revoke all` also clears the truncate/trigger/references bits anon inherited
--     from Supabase's platform default ACL. authenticated keeps its SELECT.
revoke all on
  plots_view, workers_view, variety_shares_view,
  daily_cherries_view, weekly_harvest_view, season_summary_view,
  harvests_view, tasks_view
  from anon;

-- (2) season_summary: every figure is a non-negative magnitude.
alter table season_summary
  add constraint season_target_nonneg    check (target_kg       >= 0),
  add constraint season_harvested_nonneg check (harvested_kg    >= 0),
  add constraint season_today_nonneg     check (today_kg        >= 0),
  add constraint season_revenue_nonneg   check (ytd_revenue_usd >= 0);

-- plots: the derived harvest tally is non-negative; the geometry columns
-- (currently all NULL) must be physically sane — these guard future
-- GeoJSON-derived writes (slope 0–90°, aspect 0–360°, elevations min ≤ mean ≤ max).
alter table plots
  add constraint plots_harvested_nonneg check (harvested_kg >= 0),
  add constraint plots_slope_range  check (slope_deg_mean  is null or slope_deg_mean  between 0 and 90),
  add constraint plots_aspect_range check (aspect_deg_mean is null or aspect_deg_mean between 0 and 360),
  add constraint plots_elev_ordered check (
        (elevation_min_m  is null or elevation_mean_m is null or elevation_min_m  <= elevation_mean_m)
    and (elevation_mean_m is null or elevation_max_m  is null or elevation_mean_m <= elevation_max_m)
    and (elevation_min_m  is null or elevation_max_m  is null or elevation_min_m  <= elevation_max_m)
  );

-- workers: today's running tally is non-negative.
alter table workers
  add constraint workers_today_nonneg check (today_kg >= 0);

-- reserve_zones: a zone's area is positive when set.
alter table reserve_zones
  add constraint reserve_area_pos check (area_ha is null or area_ha > 0);

commit;
