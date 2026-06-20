-- Janson Coffee · Farm Operations — initial schema
-- Faithful Postgres model of the in-repo domain (src/lib/types.ts + src/lib/data/*).
-- Text primary keys preserve the existing ids (p-tizingal-alto, w-06, JC-564 …) so
-- nothing has to be renumbered. Read-only public app => RLS on, anon SELECT-only.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- Enums — mirror the TypeScript union types 1:1
-- ──────────────────────────────────────────────────────────────────────────
create type coffee_variety   as enum ('Geisha', 'Caturra', 'Catuaí', 'Pacamara', 'Typica');
create type plot_status      as enum ('healthy', 'watch', 'at-risk');
create type ripeness         as enum ('underripe', 'ripe', 'overripe');   -- reserved by the domain model (harvests track ripeness_pct numeric)
create type worker_role      as enum ('Picker', 'Agronomist', 'Mill Operator', 'Supervisor', 'Driver');
create type attendance_status as enum ('present', 'absent', 'rest-day');
create type process_method   as enum ('Washed', 'Natural', 'Honey', 'Anaerobic');
create type batch_stage      as enum ('cherry', 'fermentation', 'drying', 'parchment', 'milled', 'green');
create type task_category    as enum ('Pruning', 'Fertilizing', 'Pest Control', 'Weeding', 'Planting', 'Irrigation', 'Soil');
create type task_status      as enum ('todo', 'in-progress', 'done', 'blocked');
create type priority         as enum ('low', 'medium', 'high');
create type activity_kind    as enum ('harvest', 'processing', 'task', 'labor', 'shipment');
create type weather_icon     as enum ('sun', 'cloud', 'rain', 'fog');

-- ──────────────────────────────────────────────────────────────────────────
-- Anchor tables
-- ──────────────────────────────────────────────────────────────────────────
create table plots (
  id                text          primary key,
  ord               integer       not null,   -- curated display order (not derivable from any field)
  name              text          not null,
  block             text          not null,
  variety           coffee_variety not null,
  area_ha           numeric        not null,
  altitude_masl     integer        not null,
  trees             integer        not null,
  shade_pct         integer        not null,
  established_year  integer        not null,
  status            plot_status    not null,
  last_inspected    date           not null,
  expected_yield_kg numeric        not null,
  harvested_kg      numeric        not null
);

create table workers (
  id             text              primary key,
  name           text              not null,
  role           worker_role       not null,
  daily_rate_usd numeric           not null,
  attendance     attendance_status not null,
  started_year   integer           not null,
  phone          text              not null,
  today_kg       numeric           not null default 0,
  crew           text              not null
);

-- Traceability lot codes shared by harvests and processing batches.
create table lots (
  code text primary key
);

-- ──────────────────────────────────────────────────────────────────────────
-- Operational tables
-- ──────────────────────────────────────────────────────────────────────────
create table harvests (
  id           text    primary key,
  date         date    not null,
  plot_id      text    not null references plots(id),
  worker_id    text    not null references workers(id),  -- the picker
  cherries_kg  numeric not null,
  ripeness_pct numeric not null,
  brix_avg     numeric not null,
  lot_code     text    not null references lots(code)
);
create index harvests_plot_id_idx   on harvests (plot_id);
create index harvests_worker_id_idx on harvests (worker_id);
create index harvests_lot_code_idx  on harvests (lot_code);
create index harvests_date_idx      on harvests (date);

create table processing_batches (
  id            text           primary key,
  lot_code      text           not null references lots(code),
  variety       coffee_variety not null,
  method        process_method not null,
  stage         batch_stage    not null,
  started_date  date           not null,
  cherries_kg   numeric        not null,
  current_kg    numeric        not null,
  moisture_pct  numeric        not null,
  patio         text           not null,
  progress_pct  integer        not null
);
create index processing_batches_lot_code_idx on processing_batches (lot_code);

create table tasks (
  id        text          primary key,
  title     text          not null,
  category  task_category not null,
  plot_id   text          references plots(id),         -- nullable: farm-wide work
  worker_id text          not null references workers(id), -- assignee
  due       date          not null,
  status    task_status   not null,
  priority  priority      not null
);
create index tasks_plot_id_idx   on tasks (plot_id);
create index tasks_worker_id_idx on tasks (worker_id);

create table activity (
  id   text          primary key,
  at   date          not null,
  kind activity_kind not null,
  text text          not null
);

-- ──────────────────────────────────────────────────────────────────────────
-- Dashboard aggregate / presentation tables
-- (hand-authored narrative figures; sort_order preserves display order)
-- ──────────────────────────────────────────────────────────────────────────
create table weather (
  sort_order integer      primary key,
  day        text         not null,
  hi         integer      not null,
  lo         integer      not null,
  rain_pct   integer      not null,
  icon       weather_icon not null
);

create table daily_cherries (
  sort_order integer primary key,
  label      text    not null,
  value      numeric not null
);

create table weekly_harvest (
  sort_order integer primary key,
  label      text    not null,
  value      numeric not null
);

create table variety_shares (
  variety coffee_variety primary key,
  kg      numeric        not null
);

-- Singleton: season headline figures (one row, enforced by the id check).
create table season_summary (
  id              integer primary key default 1 check (id = 1),
  target_kg       numeric not null,
  harvested_kg    numeric not null,
  today_kg        numeric not null,
  ytd_revenue_usd numeric not null
);

-- ──────────────────────────────────────────────────────────────────────────
-- Views — re-join the denormalized names the UI consumes
-- (security_invoker so base-table RLS is enforced for the querying role)
-- ──────────────────────────────────────────────────────────────────────────
create view harvests_view with (security_invoker = on) as
  select h.id,
         h.date,
         h.plot_id,
         p.name as plot_name,
         w.name as picker,
         h.cherries_kg,
         h.ripeness_pct,
         h.brix_avg,
         h.lot_code
  from harvests h
  join plots   p on p.id = h.plot_id
  join workers w on w.id = h.worker_id;

create view tasks_view with (security_invoker = on) as
  select t.id,
         t.title,
         t.category,
         t.plot_id,
         p.name as plot_name,
         w.name as assignee,
         t.due,
         t.status,
         t.priority
  from tasks t
  left join plots   p on p.id = t.plot_id
  join      workers w on w.id = t.worker_id;

-- ──────────────────────────────────────────────────────────────────────────
-- Row Level Security — public app is read-only: anon (and authenticated) may SELECT, nothing else
-- ──────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'plots','workers','lots','harvests','processing_batches','tasks',
    'activity','weather','daily_cherries','weekly_harvest','variety_shares','season_summary'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    execute format($p$create policy "public read" on %I for select to anon, authenticated using (true);$p$, t);
  end loop;
end $$;

grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;  -- includes the two views

commit;
