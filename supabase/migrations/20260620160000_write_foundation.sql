-- Write foundation for full CRUD. Makes the six core tables editable by the
-- authenticated owner, with validation enforced at the DB layer + audit timestamps.
--
-- The derived aggregates (daily_cherries, weekly_harvest, variety_shares, the season
-- roll-ups, workers.today_kg, plots.harvested_kg) are intentionally left untouched here;
-- a later migration converts them to computed views so the dashboard reflects real writes.

begin;

-- ── Audit columns + updated_at trigger on the mutable tables ──────────────────
create or replace function set_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['plots','workers','lots','harvests','processing_batches','tasks']
  loop
    execute format('alter table %I add column created_at timestamptz not null default now();', t);
    execute format('alter table %I add column updated_at timestamptz not null default now();', t);
    execute format(
      'create trigger %I_set_updated_at before update on %I for each row execute function set_updated_at();',
      t, t
    );
  end loop;
end $$;

-- ── Validation CHECK constraints (don't trust the client) ─────────────────────
alter table plots
  add constraint plots_shade_pct_range   check (shade_pct between 0 and 100),
  add constraint plots_area_ha_pos       check (area_ha > 0),
  add constraint plots_trees_nonneg      check (trees >= 0),
  add constraint plots_altitude_pos      check (altitude_masl > 0),
  add constraint plots_expected_yield_nn check (expected_yield_kg >= 0),
  add constraint plots_year_sane         check (established_year between 1950 and 2100);

alter table workers
  add constraint workers_rate_nonneg check (daily_rate_usd >= 0),
  add constraint workers_year_sane   check (started_year between 1950 and 2100);

alter table harvests
  add constraint harvests_cherries_pos   check (cherries_kg > 0),
  add constraint harvests_ripeness_range check (ripeness_pct between 0 and 100),
  add constraint harvests_brix_nonneg    check (brix_avg >= 0);

alter table processing_batches
  add constraint pb_cherries_pos   check (cherries_kg > 0),
  add constraint pb_current_nonneg check (current_kg >= 0),
  add constraint pb_no_mass_gain   check (current_kg <= cherries_kg),
  add constraint pb_moisture_range check (moisture_pct between 0 and 100),
  add constraint pb_progress_range check (progress_pct between 0 and 100);

alter table weather
  add constraint weather_rain_range check (rain_pct between 0 and 100),
  add constraint weather_lo_le_hi   check (lo <= hi);

alter table lots
  add constraint lots_code_format check (code ~ '^JC-[0-9]{3,}$');

-- Drop the unused 'ripeness' enum (no column references it).
drop type if exists ripeness;

-- ── Grant writes back to the authenticated owner + write RLS policies ─────────
grant insert, update, delete
  on plots, workers, lots, harvests, processing_batches, tasks
  to authenticated;

do $$
declare t text;
begin
  foreach t in array array['plots','workers','lots','harvests','processing_batches','tasks']
  loop
    execute format('create policy "authenticated insert" on %I for insert to authenticated with check (true);', t);
    execute format('create policy "authenticated update" on %I for update to authenticated using (true) with check (true);', t);
    execute format('create policy "authenticated delete" on %I for delete to authenticated using (true);', t);
  end loop;
end $$;

commit;
