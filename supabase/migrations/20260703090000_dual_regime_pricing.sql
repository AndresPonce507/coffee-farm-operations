-- ════════════════════════════════════════════════════════════════════════════
-- P3-S0 · Dual-regime pricing core — market-data ledgers + regime-isolated
--          quote/fixation. THE price-resolution core every commerce slice reads.
-- ════════════════════════════════════════════════════════════════════════════
-- Spec: docs/design/PHASE3-DESIGN.md lines 167–189 (+ §1 cross-slice rails).
--
-- The keystone guard: a Best-of-Panama Geisha (Presidential/Specialty + single
-- origin) physically CANNOT be quoted on the commodity index — rejected at the DB,
-- not just the UI. The money guarantee is REUSED: accept_quote inserts a
-- lot_reservations row so the EXISTING prevent_oversell trigger fires (no parallel
-- counter). The lb↔kg "C" factor routes through convert_qty/units (never 2.2046).
--
-- Rails honored:
--   * One write door — all writes via SECURITY DEFINER RPCs (set search_path =
--     public, extensions), tenant-clamped, idempotent on a tenant-qualified key,
--     appending lot_event in the SAME txn for every commercial decision.
--   * AD-8/AD-9 grants — per-object `grant select … to authenticated`; on every RPC
--     `revoke execute … from public` THEN `grant execute … to authenticated`. anon
--     gets NOTHING.
--   * Tenant seam — every new table carries tenant_id + current_tenant_id() default
--     + RLS `using (tenant_id = current_tenant_id())`, mirroring the on-disk P4-S0
--     idiom (20260701092000 / 20260623100000). New RLS tables are registered in
--     src/test/db/tenantTables.ts (the §8 parity contract).
--   * Margin floor reads cogs_per_lot(lot)/mv_lot_cost; NULL COGS ⇒ allowed-but-
--     flagged "margin unknown", never a fabricated floor.
--   * P2-S6 hold seam — a held lot inherits the commit block automatically via
--     lot_reservations (the existing _prevent_held_lot_commit trigger); NOT rebuilt.

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 0. Enums + the lb↔kg unit (the named silent-corruption trap).
-- ════════════════════════════════════════════════════════════════════════════
create type pricing_regime as enum ('commodity', 'reserve');
create type ice_c_source   as enum ('manual', 'barchart-free', 'investing-scrape');

-- '[lb]' is NOT in the seeded units table (only kg/g are mass units). The commodity
-- "C" $/lb→$/kg factor MUST route through convert_qty(1,'kg','[lb]') = 1/0.453592 —
-- so seed the canonical avoirdupois pound here. NEVER hardcode 2.2046 in SQL or JS.
insert into units (code, dimension, to_base, display) values
  ('[lb]', 'mass', 0.453592, 'lb')
  on conflict (code) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. farm_season_config — the named single-source margin floors + settlement knobs.
-- ════════════════════════════════════════════════════════════════════════════
alter table farm_season_config
  add column if not exists settlement_currency                    text    not null default 'USD',
  add column if not exists default_commodity_differential_usd_per_lb numeric not null default 0.35,
  add column if not exists reserve_min_margin_pct                  numeric not null default 0.20,
  add column if not exists commodity_min_margin_pct                numeric not null default 0.10;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Market-data ledgers (append-only, RPC-only writers).
-- ════════════════════════════════════════════════════════════════════════════

-- 2a. ice_c_quotes — daily/intraday ICE "C" marks. source enum makes the engine
--     feed-agnostic; manual mark entry is the always-available $0 fallback.
create table ice_c_quotes (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  contract_month  text    not null,                       -- e.g. '2026-12'
  as_of           timestamptz not null default now(),
  price           numeric not null check (price > 0),     -- USD per lb ("C")
  source          ice_c_source not null default 'manual',
  idempotency_key text,
  created_at      timestamptz not null default now()
);
create index ice_c_quotes_month_asof_idx on ice_c_quotes (contract_month, as_of desc);
create index ice_c_quotes_tenant_idx     on ice_c_quotes (tenant_id);
create unique index ice_c_quotes_tenant_idem_ux
  on ice_c_quotes (tenant_id, idempotency_key) where idempotency_key is not null;

-- 2b. auction_comps — the reserve comp library (public BoP/CoE results, hand-seeded).
create table auction_comps (
  id               bigint generated always as identity primary key,
  tenant_id        uuid    not null references tenants(id) default current_tenant_id(),
  auction_name     text    not null,
  lot_label        text,
  variety          text,
  process          text,
  cup_score        numeric check (cup_score >= 0 and cup_score <= 100),
  price_usd_per_kg numeric not null check (price_usd_per_kg > 0),
  result_year      integer,
  idempotency_key  text,
  created_at       timestamptz not null default now()
);
create index auction_comps_tenant_idx on auction_comps (tenant_id);
create unique index auction_comps_tenant_idem_ux
  on auction_comps (tenant_id, idempotency_key) where idempotency_key is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Versioned, append-only rule config (named, auditable, tunable without code).
-- ════════════════════════════════════════════════════════════════════════════

-- 3a. differential_schedule — commodity bands keyed to grade/cup-score. A tune = a
--     NEW version row; the latest version wins (append-only, no in-place UPDATE).
create table differential_schedule (
  id                      bigint generated always as identity primary key,
  tenant_id               uuid    not null references tenants(id) default current_tenant_id(),
  version                 integer not null,
  grade                   text,                            -- sca_grade band (null = default)
  min_cup_score           numeric,
  differential_usd_per_lb numeric not null,
  effective_at            timestamptz not null default now(),
  created_at              timestamptz not null default now()
);
create index differential_schedule_tenant_idx on differential_schedule (tenant_id);

-- 3b. reserve_price_model — the decoupled coefficients:
--     price = base + coefficient × (score − pivot) + scarcity. Named + versioned.
create table reserve_price_model (
  id                       bigint generated always as identity primary key,
  tenant_id                uuid    not null references tenants(id) default current_tenant_id(),
  version                  integer not null,
  base_usd_per_kg          numeric not null,
  coefficient_usd_per_point numeric not null,
  score_pivot              numeric not null default 87,
  scarcity_usd_per_kg      numeric not null default 0,
  effective_at             timestamptz not null default now(),
  created_at               timestamptz not null default now()
);
create index reserve_price_model_tenant_idx on reserve_price_model (tenant_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 4. price_quotes — the binding price table. Regime-isolated by a CHECK + a trigger.
--    cost_per_kg_at_quote snapshots mv_lot_cost; margin_pct_at_quote is GENERATED.
-- ════════════════════════════════════════════════════════════════════════════
create table price_quotes (
  id                   bigint generated always as identity primary key,
  tenant_id            uuid    not null references tenants(id) default current_tenant_id(),
  green_lot_code       text    not null,
  regime               pricing_regime not null,
  kg                   numeric not null check (kg > 0),
  unit_price           numeric not null check (unit_price >= 0),   -- per kg, in `currency`
  currency             text    not null default 'USD',
  fx_rate_to_usd       numeric not null default 1 check (fx_rate_to_usd > 0),
  -- snapshot of cogs_per_lot(green_lot)/mv_lot_cost at quote time. NULL ⇒ margin unknown.
  cost_per_kg_at_quote numeric,
  -- margin-on-revenue snapshot for display: (usd_price − cost) / usd_price. NULL when
  -- COGS is unknown (never a fabricated floor).
  margin_pct_at_quote  numeric generated always as (
    case
      when cost_per_kg_at_quote is null or (unit_price * fx_rate_to_usd) = 0 then null
      else (unit_price * fx_rate_to_usd - cost_per_kg_at_quote) / (unit_price * fx_rate_to_usd)
    end
  ) stored,
  status               text    not null default 'quoted'
                         check (status in ('quoted', 'accepted', 'superseded', 'cancelled')),
  -- commodity-only legs (NULL on reserve quotes — enforced by the regime CHECK below)
  ice_c_contract_month    text,
  ice_c_price_at_quote    numeric,
  differential_usd_per_lb numeric,
  reservation_id          bigint references lot_reservations(id),  -- set on accept
  idempotency_key         text,
  created_at              timestamptz not null default now(),
  -- tenant-scoped composite FK to the green lot (mirrors the on-disk P4-S0 idiom).
  constraint price_quotes_green_lot_tfk
    foreign key (tenant_id, green_lot_code) references green_lots(tenant_id, lot_code),
  -- REGIME ISOLATION (column shape): a reserve quote carries NO commodity leg; a
  -- commodity quote MUST name an ICE "C" contract month.
  constraint price_quotes_regime_isolation check (
    (regime = 'reserve'   and ice_c_contract_month is null and differential_usd_per_lb is null)
    or (regime = 'commodity' and ice_c_contract_month is not null)
  ),
  constraint price_quotes_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index price_quotes_tenant_idx on price_quotes (tenant_id);
create index price_quotes_lot_idx    on price_quotes (green_lot_code);

-- ════════════════════════════════════════════════════════════════════════════
-- 5. fixations — locks a commodity quote's "C" leg, referencing a lot_reservations.id
--    (it does NOT invent a parallel counter). Append-only.
-- ════════════════════════════════════════════════════════════════════════════
create table fixations (
  id                   bigint generated always as identity primary key,
  tenant_id            uuid    not null references tenants(id) default current_tenant_id(),
  price_quote_id       bigint  not null references price_quotes(id),
  reservation_id       bigint  not null references lot_reservations(id),
  ice_c_contract_month text    not null,
  ice_c_price_locked   numeric not null check (ice_c_price_locked > 0),
  locked_at            timestamptz not null default now(),
  idempotency_key      text,
  created_at           timestamptz not null default now(),
  constraint fixations_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index fixations_tenant_idx on fixations (tenant_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Immutability triggers — the append-only ledgers (cost_entry_immutable style).
--    price_quotes is DELIBERATELY excluded: its status transitions (quoted→accepted)
--    flow through the SECDEF RPCs; clients are blocked by the absent UPDATE grant +
--    absent update policy, not by an all-blocking trigger.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function _ice_c_quotes_immutable() returns trigger
  language plpgsql set search_path = public
as $$
begin
  raise exception
    'ice_c_quotes is append-only: % is not permitted — post a new mark instead', tg_op
    using errcode = 'restrict_violation';
end $$;
create trigger ice_c_quotes_no_update before update on ice_c_quotes
  for each row execute function _ice_c_quotes_immutable();
create trigger ice_c_quotes_no_delete before delete on ice_c_quotes
  for each row execute function _ice_c_quotes_immutable();

create or replace function _auction_comps_immutable() returns trigger
  language plpgsql set search_path = public
as $$
begin
  raise exception
    'auction_comps is append-only: % is not permitted — post a corrected comp instead', tg_op
    using errcode = 'restrict_violation';
end $$;
create trigger auction_comps_no_update before update on auction_comps
  for each row execute function _auction_comps_immutable();
create trigger auction_comps_no_delete before delete on auction_comps
  for each row execute function _auction_comps_immutable();

create or replace function _rule_config_immutable() returns trigger
  language plpgsql set search_path = public
as $$
begin
  raise exception
    '% is append-only: % is not permitted — post a new version row instead', tg_table_name, tg_op
    using errcode = 'restrict_violation';
end $$;
create trigger differential_schedule_no_update before update on differential_schedule
  for each row execute function _rule_config_immutable();
create trigger differential_schedule_no_delete before delete on differential_schedule
  for each row execute function _rule_config_immutable();
create trigger reserve_price_model_no_update before update on reserve_price_model
  for each row execute function _rule_config_immutable();
create trigger reserve_price_model_no_delete before delete on reserve_price_model
  for each row execute function _rule_config_immutable();

create or replace function _fixations_immutable() returns trigger
  language plpgsql set search_path = public
as $$
begin
  raise exception
    'fixations is append-only: % is not permitted — a locked fixation is irreversible', tg_op
    using errcode = 'restrict_violation';
end $$;
create trigger fixations_no_update before update on fixations
  for each row execute function _fixations_immutable();
create trigger fixations_no_delete before delete on fixations
  for each row execute function _fixations_immutable();

-- ════════════════════════════════════════════════════════════════════════════
-- 7. price_regime_for_lot — 'reserve' when sca_grade in (Presidential,Specialty) AND
--    single-origin, else 'commodity'. SECURITY DEFINER + current_tenant_id() clamp.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function price_regime_for_lot(p_lot_code text) returns text
  language plpgsql security definer stable set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_grade  text;
  v_single boolean;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  select g.sca_grade, l.is_single_origin
    into v_grade, v_single
    from green_lots g
    join lots l on l.code = g.lot_code and l.tenant_id = g.tenant_id
   where g.lot_code = p_lot_code and g.tenant_id = v_tenant;
  if not found then
    raise exception 'unknown green lot %', p_lot_code using errcode = 'foreign_key_violation';
  end if;
  if v_grade in ('Presidential', 'Specialty') and coalesce(v_single, false) then
    return 'reserve';
  end if;
  return 'commodity';
end $$;
revoke execute on function price_regime_for_lot(text) from public;
grant   execute on function price_regime_for_lot(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. Data-layer invariant triggers on price_quotes.
-- ════════════════════════════════════════════════════════════════════════════

-- 8a. enforce_regime_pricing — THE KEYSTONE. Rejects a commodity quote for a lot
--     whose sca_grade in (Presidential,Specialty) AND single-origin. Fires on EVERY
--     insert path (RPC or direct), so the guard is the data layer, not the RPC.
create or replace function _enforce_regime_pricing() returns trigger
  language plpgsql set search_path = public
as $$
declare
  v_grade  text;
  v_single boolean;
begin
  if new.regime = 'commodity' then
    select g.sca_grade, l.is_single_origin
      into v_grade, v_single
      from green_lots g
      join lots l on l.code = g.lot_code and l.tenant_id = g.tenant_id
     where g.lot_code = new.green_lot_code and g.tenant_id = new.tenant_id;
    if found and v_grade in ('Presidential', 'Specialty') and coalesce(v_single, false) then
      raise exception
        'regime isolation: green lot % is %-grade single-origin — cannot be priced on the commodity index (reserve-only)',
        new.green_lot_code, v_grade
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger price_quotes_enforce_regime before insert on price_quotes
  for each row execute function _enforce_regime_pricing();

-- 8b. _enforce_margin_floor — rejects unit_price < cost × (1 + min_margin_pct) using
--     the REGIME's floor from farm_season_config. NULL COGS ⇒ allowed-but-flagged
--     (no fabricated floor). Fires on every insert path.
create or replace function _enforce_margin_floor() returns trigger
  language plpgsql set search_path = public
as $$
declare
  v_floor_pct numeric;
  v_usd_price numeric := new.unit_price * coalesce(new.fx_rate_to_usd, 1);
begin
  -- NULL COGS: degrade gracefully — allow, flagged "margin unknown" (margin_pct null).
  if new.cost_per_kg_at_quote is null then
    return new;
  end if;
  select case when new.regime = 'reserve' then reserve_min_margin_pct
              else commodity_min_margin_pct end
    into v_floor_pct
    from farm_season_config where tenant_id = new.tenant_id;
  v_floor_pct := coalesce(v_floor_pct, 0);
  if v_usd_price < new.cost_per_kg_at_quote * (1 + v_floor_pct) - 1e-9 then
    raise exception
      'margin floor: %/kg is below the % regime floor of %/kg (cost %/kg × (1 + %))',
      v_usd_price, new.regime, new.cost_per_kg_at_quote * (1 + v_floor_pct),
      new.cost_per_kg_at_quote, v_floor_pct
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger price_quotes_enforce_margin before insert on price_quotes
  for each row execute function _enforce_margin_floor();

revoke execute on function _enforce_regime_pricing()  from public;
revoke execute on function _enforce_margin_floor()    from public;
revoke execute on function _ice_c_quotes_immutable()  from public;
revoke execute on function _auction_comps_immutable() from public;
revoke execute on function _rule_config_immutable()   from public;
revoke execute on function _fixations_immutable()     from public;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. Read views (security_invoker — inherit caller RLS on the base tables).
-- ════════════════════════════════════════════════════════════════════════════

-- 9a. v_ice_c_latest — the latest mark per contract month (per tenant).
create view v_ice_c_latest with (security_invoker = on) as
  select distinct on (q.tenant_id, q.contract_month)
         q.tenant_id, q.contract_month, q.price, q.as_of, q.source
    from ice_c_quotes q
   order by q.tenant_id, q.contract_month, q.as_of desc, q.id desc;

-- 9b. v_lot_price_book — per green lot: regime, live indicative price, cogs floor,
--     indicative margin, remaining ATP. Indicative price is best-effort (NULL when
--     the regime's inputs are missing); the RPCs are the authoritative pricers.
create view v_lot_price_book with (security_invoker = on) as
  select
    g.tenant_id,
    g.lot_code                                          as green_lot_code,
    g.sca_grade,
    g.cupping_score,
    price_regime_for_lot(g.lot_code)                    as regime,
    cogs_per_lot(g.lot_code)                            as cogs_per_kg_green,
    atp.atp                                             as atp_kg,
    case
      when price_regime_for_lot(g.lot_code) = 'commodity' then
        (select (lat.price + fsc.default_commodity_differential_usd_per_lb)
                  * convert_qty(1, 'kg', '[lb]')
           from v_ice_c_latest lat
           join farm_season_config fsc on fsc.tenant_id = g.tenant_id
          where lat.tenant_id = g.tenant_id
          order by lat.as_of desc limit 1)
      else
        (select rpm.base_usd_per_kg
                  + rpm.coefficient_usd_per_point * (g.cupping_score - rpm.score_pivot)
                  + rpm.scarcity_usd_per_kg
           from reserve_price_model rpm
          where rpm.tenant_id = g.tenant_id
          order by rpm.version desc limit 1)
    end                                                 as indicative_unit_price
  from green_lots g
  join lots l on l.code = g.lot_code and l.tenant_id = g.tenant_id
  left join green_lots_atp atp on atp.green_lot_code = g.lot_code;

-- 9c. v_fixation_exposure — open commodity reservations not yet fixed × current "C"
--     = the unfixed price risk. A reservation is "unfixed" when no fixations row
--     references it.
create view v_fixation_exposure with (security_invoker = on) as
  select
    pq.tenant_id,
    pq.id                                               as price_quote_id,
    pq.green_lot_code,
    pq.reservation_id,
    pq.kg,
    pq.ice_c_contract_month,
    (select lat.price from v_ice_c_latest lat
      where lat.tenant_id = pq.tenant_id
        and lat.contract_month = pq.ice_c_contract_month
      limit 1)                                          as current_c_price,
    (select lat.price from v_ice_c_latest lat
      where lat.tenant_id = pq.tenant_id
        and lat.contract_month = pq.ice_c_contract_month
      limit 1) * pq.kg * convert_qty(1, 'kg', '[lb]')   as exposure_usd
  from price_quotes pq
  where pq.regime = 'commodity'
    and pq.status = 'accepted'
    and pq.reservation_id is not null
    and not exists (select 1 from fixations f where f.reservation_id = pq.reservation_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 10. Command RPCs — the ONLY write doors. SECURITY DEFINER, tenant-clamped,
--     idempotent on a tenant-qualified key, lot_event in the same txn.
-- ════════════════════════════════════════════════════════════════════════════

-- 10a. record_ice_c_quote — the append-only "C" mark writer (the only insert door).
create or replace function record_ice_c_quote(
  p_contract_month  text,
  p_price           numeric,
  p_source          text,
  p_as_of           timestamptz,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_id     bigint;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;
  select id into v_id from ice_c_quotes
   where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then
    return v_id;                                  -- exactly-once replay
  end if;
  insert into ice_c_quotes (tenant_id, contract_month, as_of, price, source, idempotency_key)
  values (v_tenant, p_contract_month, coalesce(p_as_of, now()), p_price,
          coalesce(p_source, 'manual')::ice_c_source, v_key)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function record_ice_c_quote(text, numeric, text, timestamptz, text) from public;
grant   execute on function record_ice_c_quote(text, numeric, text, timestamptz, text) to authenticated;

-- 10b. record_auction_comp — the append-only reserve comp writer.
create or replace function record_auction_comp(
  p_auction_name     text,
  p_lot_label        text,
  p_variety          text,
  p_process          text,
  p_cup_score        numeric,
  p_price_usd_per_kg numeric,
  p_result_year      integer,
  p_idempotency_key  text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_id     bigint;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;
  select id into v_id from auction_comps
   where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then
    return v_id;
  end if;
  insert into auction_comps (tenant_id, auction_name, lot_label, variety, process,
                             cup_score, price_usd_per_kg, result_year, idempotency_key)
  values (v_tenant, p_auction_name, p_lot_label, p_variety, p_process,
          p_cup_score, p_price_usd_per_kg, p_result_year, v_key)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function record_auction_comp(text, text, text, text, numeric, numeric, integer, text) from public;
grant   execute on function record_auction_comp(text, text, text, text, numeric, numeric, integer, text) to authenticated;

-- 10c. quote_commodity_price — unit_price = ("C" + differential) × the convert_qty-
--      backed lb/kg factor; snapshots cogs_per_lot; the regime + margin triggers fire;
--      appends 'price_quoted'.
create or replace function quote_commodity_price(
  p_green_lot_code        text,
  p_kg                    numeric,
  p_contract_month        text,
  p_differential_usd_per_lb numeric,
  p_currency              text,
  p_fx_rate               numeric,
  p_idempotency_key       text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_id     bigint;
  v_c      numeric;
  v_diff   numeric;
  v_unit   numeric;
  v_cost   numeric;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;
  select id into v_id from price_quotes where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then
    return v_id;
  end if;

  -- the live "C" mark for the contract month.
  select price into v_c from v_ice_c_latest
   where tenant_id = v_tenant and contract_month = p_contract_month;
  if v_c is null then
    raise exception 'no ICE "C" mark for contract month %', p_contract_month
      using errcode = 'no_data_found';
  end if;

  v_diff := coalesce(
    p_differential_usd_per_lb,
    (select default_commodity_differential_usd_per_lb from farm_season_config where tenant_id = v_tenant));

  -- $/lb → $/kg via convert_qty(1,'kg','[lb]') (= 1/0.453592). NEVER a 2.2046 literal.
  v_unit := (v_c + v_diff) * convert_qty(1, 'kg', '[lb]');

  v_cost := cogs_per_lot(p_green_lot_code);          -- NULL ⇒ margin unknown (flagged)

  insert into price_quotes
    (tenant_id, green_lot_code, regime, kg, unit_price, currency, fx_rate_to_usd,
     cost_per_kg_at_quote, status, ice_c_contract_month, ice_c_price_at_quote,
     differential_usd_per_lb, idempotency_key)
  values
    (v_tenant, p_green_lot_code, 'commodity', p_kg, v_unit, coalesce(p_currency, 'USD'),
     coalesce(p_fx_rate, 1), v_cost, 'quoted', p_contract_month, v_c, v_diff, v_key)
  returning id into v_id;

  perform record_lot_event(
    p_green_lot_code, 'price_quoted',
    jsonb_build_object('quote_id', v_id, 'regime', 'commodity', 'kg', p_kg,
                       'unit_price', v_unit, 'contract_month', p_contract_month,
                       'differential', v_diff, 'c_price', v_c),
    now(), 'server', nextval('lot_code_seq'), v_key || ':quoted');

  return v_id;
end $$;
revoke execute on function quote_commodity_price(text, numeric, text, numeric, text, numeric, text) from public;
grant   execute on function quote_commodity_price(text, numeric, text, numeric, text, numeric, text) to authenticated;

-- 10d. quote_reserve_price — reads cupping score + reserve_price_model + auction_comps,
--      clamps the model price to the comp range, NEVER touches ice_c_quotes; an
--      optional human override is still floored by the margin trigger; appends
--      'reserve_priced'.
create or replace function quote_reserve_price(
  p_green_lot_code    text,
  p_kg                numeric,
  p_override_usd_per_kg numeric,
  p_currency          text,
  p_fx_rate           numeric,
  p_idempotency_key   text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_id     bigint;
  v_score  numeric;
  v_model  record;
  v_price  numeric;
  v_max    numeric;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;
  select id into v_id from price_quotes where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then
    return v_id;
  end if;

  select cupping_score into v_score from green_lots
   where lot_code = p_green_lot_code and tenant_id = v_tenant;
  if v_score is null then
    raise exception 'unknown green lot %', p_green_lot_code using errcode = 'foreign_key_violation';
  end if;

  if p_override_usd_per_kg is not null then
    v_price := p_override_usd_per_kg;             -- human override (still margin-floored)
  else
    select * into v_model from reserve_price_model
     where tenant_id = v_tenant order by version desc limit 1;
    if not found then
      raise exception 'no reserve_price_model configured' using errcode = 'no_data_found';
    end if;
    v_price := v_model.base_usd_per_kg
             + v_model.coefficient_usd_per_point * (v_score - v_model.score_pivot)
             + v_model.scarcity_usd_per_kg;
    -- Cap the model price at the auction-comp CEILING only (the record champion is an
    -- UPPER reference, never a floor). Flooring up to a single outlier comp would
    -- collapse a degenerate [min,max]=point range and issue world-record prices; the
    -- margin trigger already guards the lower bound.
    select max(price_usd_per_kg) into v_max
      from auction_comps where tenant_id = v_tenant;
    if v_max is not null then
      v_price := least(v_price, v_max);
    end if;
  end if;

  insert into price_quotes
    (tenant_id, green_lot_code, regime, kg, unit_price, currency, fx_rate_to_usd,
     cost_per_kg_at_quote, status, idempotency_key)
  values
    (v_tenant, p_green_lot_code, 'reserve', p_kg, v_price, coalesce(p_currency, 'USD'),
     coalesce(p_fx_rate, 1), cogs_per_lot(p_green_lot_code), 'quoted', v_key)
  returning id into v_id;

  perform record_lot_event(
    p_green_lot_code, 'reserve_priced',
    jsonb_build_object('quote_id', v_id, 'regime', 'reserve', 'kg', p_kg,
                       'unit_price', v_price, 'cupping_score', v_score,
                       'override', p_override_usd_per_kg is not null),
    now(), 'server', nextval('lot_code_seq'), v_key || ':priced');

  return v_id;
end $$;
revoke execute on function quote_reserve_price(text, numeric, numeric, text, numeric, text) from public;
grant   execute on function quote_reserve_price(text, numeric, numeric, text, numeric, text) to authenticated;

-- 10e. accept_quote — INSERTS a lot_reservations row (THIS is where prevent_oversell
--      + _prevent_held_lot_commit fire — the money guarantee, REUSED), flips status,
--      appends 'price_accepted'. Oversell/hold ⇒ the whole txn rolls back.
create or replace function accept_quote(
  p_quote_id        bigint,
  p_buyer           text,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_q      record;
  v_res_id bigint;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select * into v_q from price_quotes where id = p_quote_id and tenant_id = v_tenant;
  if not found then
    raise exception 'unknown quote %', p_quote_id using errcode = 'foreign_key_violation';
  end if;
  if v_q.status = 'accepted' and v_q.reservation_id is not null then
    return v_q.reservation_id;                    -- idempotent
  end if;
  if v_q.status <> 'quoted' then
    raise exception 'quote % cannot be accepted from status %', p_quote_id, v_q.status
      using errcode = 'check_violation';
  end if;

  -- The money guarantee: inserting the reservation fires the EXISTING prevent_oversell
  -- + _prevent_held_lot_commit triggers (no parallel counter, no rebuilt hold guard).
  insert into lot_reservations (tenant_id, green_lot_code, buyer, kg)
  values (v_tenant, v_q.green_lot_code, p_buyer, v_q.kg)
  returning id into v_res_id;

  update price_quotes set status = 'accepted', reservation_id = v_res_id
   where id = p_quote_id and tenant_id = v_tenant;

  perform record_lot_event(
    v_q.green_lot_code, 'price_accepted',
    jsonb_build_object('quote_id', p_quote_id, 'reservation_id', v_res_id,
                       'buyer', p_buyer, 'kg', v_q.kg, 'unit_price', v_q.unit_price),
    now(), 'server', nextval('lot_code_seq'), v_key || ':accepted');

  return v_res_id;
end $$;
revoke execute on function accept_quote(bigint, text, text) from public;
grant   execute on function accept_quote(bigint, text, text) to authenticated;

-- 10f. lock_fixation — commodity-only. Snapshots v_ice_c_latest, links the
--      reservation, appends 'fixation_locked'. RAISES on a reserve quote.
create or replace function lock_fixation(
  p_quote_id        bigint,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_q      record;
  v_c      numeric;
  v_id     bigint;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select * into v_q from price_quotes where id = p_quote_id and tenant_id = v_tenant;
  if not found then
    raise exception 'unknown quote %', p_quote_id using errcode = 'foreign_key_violation';
  end if;
  -- THE FIXATION REGIME GUARD — a reserve quote has no "C" leg to fix.
  if v_q.regime <> 'commodity' then
    raise exception 'fixation regime guard: quote % is a reserve quote — only a commodity "C" leg can be fixed', p_quote_id
      using errcode = 'check_violation';
  end if;
  if v_q.reservation_id is null then
    raise exception 'quote % must be accepted (have a reservation) before fixation', p_quote_id
      using errcode = 'check_violation';
  end if;

  select id into v_id from fixations where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then
    return v_id;                                  -- idempotent
  end if;

  select price into v_c from v_ice_c_latest
   where tenant_id = v_tenant and contract_month = v_q.ice_c_contract_month;
  if v_c is null then
    raise exception 'no ICE "C" mark to fix for month %', v_q.ice_c_contract_month
      using errcode = 'no_data_found';
  end if;

  insert into fixations (tenant_id, price_quote_id, reservation_id, ice_c_contract_month,
                         ice_c_price_locked, idempotency_key)
  values (v_tenant, p_quote_id, v_q.reservation_id, v_q.ice_c_contract_month, v_c, v_key)
  returning id into v_id;

  perform record_lot_event(
    v_q.green_lot_code, 'fixation_locked',
    jsonb_build_object('fixation_id', v_id, 'quote_id', p_quote_id,
                       'reservation_id', v_q.reservation_id,
                       'contract_month', v_q.ice_c_contract_month, 'c_locked', v_c),
    now(), 'server', nextval('lot_code_seq'), v_key || ':fixed');

  return v_id;
end $$;
revoke execute on function lock_fixation(bigint, text) from public;
grant   execute on function lock_fixation(bigint, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 11. RLS — tenant-scoped read on every new table (mirrors the P4-S0 idiom). All
--     writes flow through the SECDEF RPCs (which bypass RLS + self-clamp the tenant),
--     so NO insert/update/delete policy exists — read-only at the policy layer.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array[
    'ice_c_quotes','auction_comps','differential_schedule','reserve_price_model',
    'price_quotes','fixations'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'create policy "tenant read" on public.%I for select to authenticated
         using (tenant_id = current_tenant_id());', t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 12. GRANTS (AD-8) — per-object SELECT to authenticated on every table/view (one
--     statement each so the name-anchored static guard matches). NO write grants;
--     anon gets NOTHING. RPC execute is revoked-from-public-then-granted above.
-- ════════════════════════════════════════════════════════════════════════════
grant select on ice_c_quotes          to authenticated;
grant select on auction_comps         to authenticated;
grant select on differential_schedule to authenticated;
grant select on reserve_price_model   to authenticated;
grant select on price_quotes          to authenticated;
grant select on fixations             to authenticated;
grant select on v_ice_c_latest        to authenticated;
grant select on v_lot_price_book      to authenticated;
grant select on v_fixation_exposure   to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 13. Seed data — $0, hand-seeded from public results.
-- ════════════════════════════════════════════════════════════════════════════
-- The $30,204/kg 2025 Best-of-Panama washed-Geisha anchor comp (the reserve price
-- story). tenant_id defaults to current_tenant_id() (the single-estate tenant at
-- migration time).
insert into auction_comps
  (auction_name, lot_label, variety, process, cup_score, price_usd_per_kg, result_year, idempotency_key)
values
  ('Best of Panama', 'Washed Geisha (champion lot)', 'Geisha', 'Washed', 94, 30204, 2025,
   'seed:bop-2025-washed-geisha');

-- Default commodity differential schedule (version 1) — neutral house default.
insert into differential_schedule (version, grade, min_cup_score, differential_usd_per_lb)
values (1, null, null, 0.35);

-- Default reserve price model (version 1): base + coefficient×(score−87) + scarcity.
-- e.g. a 92-point lot ⇒ 150 + 60×(92−87) + 0 = 450 $/kg (then clamped to comps).
insert into reserve_price_model
  (version, base_usd_per_kg, coefficient_usd_per_point, score_pivot, scarcity_usd_per_kg)
values (1, 150, 60, 87, 0);

commit;
