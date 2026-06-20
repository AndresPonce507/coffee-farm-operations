-- Dashboard reflects real writes: the getters read these views, which compute the
-- aggregates from the harvests the owner actually logs (instead of seeded figures).
-- The underlying stored columns/tables are left in place (harmless) — the views
-- simply ignore them and compute fresh. Also fixes the plots insert bug (C1):
-- harvested_kg is no longer written by the form, so give it a default.

begin;

-- C1 fix: createPlot intentionally never writes the (now-derived) harvested_kg.
alter table plots alter column harvested_kg set default 0;
-- (workers.today_kg already defaults to 0.)

-- plots + harvested_kg computed from the plot's logged cherries.
create view plots_view with (security_invoker = on) as
  select p.id, p.ord, p.name, p.block, p.variety, p.area_ha, p.altitude_masl,
         p.trees, p.shade_pct, p.established_year, p.status, p.last_inspected,
         p.expected_yield_kg,
         coalesce(h.kg, 0)::numeric as harvested_kg
  from plots p
  left join (
    select plot_id, sum(cherries_kg) as kg from harvests group by plot_id
  ) h on h.plot_id = p.id;

-- workers + today_kg = that worker's cherries on the most recent picking day.
create view workers_view with (security_invoker = on) as
  select w.id, w.name, w.role, w.daily_rate_usd, w.attendance, w.started_year,
         w.phone, w.crew,
         coalesce(t.kg, 0)::numeric as today_kg
  from workers w
  left join (
    select worker_id, sum(cherries_kg) as kg
    from harvests
    where date = (select max(date) from harvests)
    group by worker_id
  ) t on t.worker_id = w.id;

-- Season-to-date by variety (via the harvest's plot), biggest first.
create view variety_shares_view with (security_invoker = on) as
  select p.variety, coalesce(sum(h.cherries_kg), 0)::numeric as kg
  from harvests h
  join plots p on p.id = h.plot_id
  group by p.variety
  order by kg desc;

-- Daily intake (one point per logged day).
create view daily_cherries_view with (security_invoker = on) as
  select to_char(date, 'Mon DD') as label,
         sum(cherries_kg)::numeric as value,
         date as on_date
  from harvests
  group by date
  order by date;

-- Weekly intake (Monday-anchored buckets).
create view weekly_harvest_view with (security_invoker = on) as
  select to_char(date_trunc('week', date), 'Mon DD') as label,
         sum(cherries_kg)::numeric as value,
         date_trunc('week', date) as week_start
  from harvests
  group by date_trunc('week', date)
  order by week_start;

-- Season headline: editable target + revenue, computed harvested + today.
create view season_summary_view with (security_invoker = on) as
  select s.id,
         s.target_kg,
         s.ytd_revenue_usd,
         (select coalesce(sum(cherries_kg), 0) from harvests)::numeric as harvested_kg,
         (select coalesce(sum(cherries_kg), 0) from harvests
            where date = (select max(date) from harvests))::numeric as today_kg
  from season_summary s;

grant select on
  plots_view, workers_view, variety_shares_view,
  daily_cherries_view, weekly_harvest_view, season_summary_view
  to anon, authenticated;

commit;
