-- ════════════════════════════════════════════════════════════════════════════
-- P3-S4 · Specialty auctions — Best of Panama / Cup of Excellence / Algrano.
-- ════════════════════════════════════════════════════════════════════════════
-- Spec: docs/design/PHASE3-DESIGN.md lines 245–260 (+ §1 cross-slice rails).
-- Depends (HARD): P3-S1 (b2b trunk, prevent_oversell reuse), Phase-1 green inventory
--                 (green_lots / green_lots_atp / lot_reservations / prevent_oversell),
--                 P3-S0 pricing spine (auction_comps / price_quotes / cogs_per_lot /
--                 v_ice_c_latest / convert_qty), lot_event / record_lot_event.
--
-- THE KEYSTONE (the highest-multiplier channel, kept honest):
--   (1) ENTERING an auction lot inserts a lot_reservations row keyed buyer='AUCTION:<name>',
--       so the EXISTING prevent_oversell trigger guards it for free — an auction-committed
--       lot can NEVER be double-sold via a B2B contract (no parallel counter).
--   (2) The WIN writes back to P3-S0: a cleared lot posts an auction_comps row (feeding the
--       reserve comp library so the auction price anchors the NEXT Geisha's reserve price)
--       AND a reserve price_quotes row that REUSES the existing auction reservation (never a
--       second claim), closing the loop.
--   (3) v_auction_results makes the BoP PREMIUM visible — clearing price ÷ the farm's
--       commodity baseline = the multiplier.
--
-- Rails honored:
--   * One write door — every write is a SECURITY DEFINER RPC (set search_path =
--     public, extensions), tenant-clamped, idempotent on a tenant-qualified key,
--     appending the relevant lot_event in the SAME txn.
--   * AD-8/AD-9 grants — per-object `grant select … to authenticated`; on every RPC
--     `revoke execute … from public` THEN `grant execute … to authenticated`. anon
--     gets NOTHING. Trigger fns revoke-from-public only (run as owner via the trigger).
--   * Tenant seam — every new table carries tenant_id + current_tenant_id() default
--     + an RLS read policy `using (tenant_id = current_tenant_id())`. New base tables
--     are registered in src/test/db/tenantTables.ts.
--   * The money guarantee is REUSED — auction entry inserts a lot_reservations row so
--     prevent_oversell fires; the write-back quote links the SAME reservation.
--   * convert_qty backs every lb↔kg conversion (the commodity baseline), never 2.2046.

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. auction_platform enum.
-- ════════════════════════════════════════════════════════════════════════════
create type auction_platform as enum
  ('best_of_panama', 'cup_of_excellence', 'algrano', 'private');

-- ════════════════════════════════════════════════════════════════════════════
-- 2. auctions — the auction header. DIRECT tenant root (no tenant-carrying parent FK).
--    status walks entered → scored → live → sold → withdrawn.
-- ════════════════════════════════════════════════════════════════════════════
create table auctions (
  id               bigint generated always as identity primary key,
  tenant_id        uuid    not null references tenants(id) default current_tenant_id(),
  platform         auction_platform not null,
  name             text    not null,
  entry_deadline   timestamptz,
  scoring_deadline timestamptz,
  status           text    not null default 'entered'
                     check (status in ('entered', 'scored', 'live', 'sold', 'withdrawn')),
  idempotency_key  text,
  created_at       timestamptz not null default now(),
  constraint auctions_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index auctions_tenant_idx on auctions (tenant_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. auction_entries — one green lot per auction. jury_score is the auction panel's
--    verdict, DISTINCT from the farm's own green_lots.cupping_score (reconciled in a
--    view). reservation_id carries the AUCTION claim (prevent_oversell guarded).
-- ════════════════════════════════════════════════════════════════════════════
create table auction_entries (
  id                       bigint generated always as identity primary key,
  tenant_id                uuid    not null references tenants(id) default current_tenant_id(),
  auction_id               bigint  not null references auctions(id),
  green_lot_code           text    not null,
  kg                       numeric not null check (kg > 0),
  jury_score               numeric check (jury_score is null or (jury_score >= 0 and jury_score <= 100)),
  clearing_price_usd_per_kg numeric check (clearing_price_usd_per_kg is null or clearing_price_usd_per_kg > 0),
  winning_bidder           text,
  result_year              integer,
  reservation_id           bigint references lot_reservations(id),
  sold_at                  timestamptz,
  idempotency_key          text,
  created_at               timestamptz not null default now(),
  constraint auction_entries_green_lot_tfk
    foreign key (tenant_id, green_lot_code) references green_lots(tenant_id, lot_code),
  -- one green lot per auction (per tenant) — no double-entry of the same lot.
  constraint auction_entries_one_per_auction_ux unique (tenant_id, auction_id, green_lot_code),
  constraint auction_entries_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index auction_entries_tenant_idx  on auction_entries (tenant_id);
create index auction_entries_auction_idx on auction_entries (tenant_id, auction_id);
create index auction_entries_lot_idx     on auction_entries (tenant_id, green_lot_code);

-- ════════════════════════════════════════════════════════════════════════════
-- 4. auction_scoresheets — APPEND-ONLY jury capture, mirroring the P2-S6 cup_scores
--    shape (per-juror/per-attribute marks). v_auction_final_score aggregates the panel.
--    No client UPDATE/DELETE grant + an immutability trigger (the cup_scores posture).
-- ════════════════════════════════════════════════════════════════════════════
create table auction_scoresheets (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  entry_id        bigint  not null references auction_entries(id),
  juror           text    not null,
  attribute       text    not null,
  score           numeric not null check (score >= 0 and score <= 100),
  occurred_at     timestamptz not null default now(),
  idempotency_key text,
  created_at      timestamptz not null default now(),
  constraint auction_scoresheets_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index auction_scoresheets_tenant_idx on auction_scoresheets (tenant_id);
create index auction_scoresheets_entry_idx  on auction_scoresheets (tenant_id, entry_id);

-- 4a. Append-only immutability trigger (cost_entry_immutable / cup_scores style).
create or replace function _auction_scoresheets_immutable() returns trigger
  language plpgsql set search_path = public
as $$
begin
  raise exception
    'auction_scoresheets is append-only: % is not permitted — post a new/correcting mark instead', tg_op
    using errcode = 'restrict_violation';
end $$;
create trigger auction_scoresheets_no_update before update on auction_scoresheets
  for each row execute function _auction_scoresheets_immutable();
create trigger auction_scoresheets_no_delete before delete on auction_scoresheets
  for each row execute function _auction_scoresheets_immutable();
revoke execute on function _auction_scoresheets_immutable() from public;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Read views (security_invoker — inherit the caller's RLS on the base tables).
-- ════════════════════════════════════════════════════════════════════════════

-- 5a. v_auction_final_score — aggregates the jury panel per entry (avg mark + jurors).
create view v_auction_final_score with (security_invoker = on) as
  select
    s.tenant_id,
    s.entry_id,
    e.auction_id,
    e.green_lot_code,
    avg(s.score)                  as final_score,
    count(distinct s.juror)       as juror_count,
    count(*)                      as mark_count
  from auction_scoresheets s
  join auction_entries e on e.id = s.entry_id and e.tenant_id = s.tenant_id
  group by s.tenant_id, s.entry_id, e.auction_id, e.green_lot_code;

-- 5b. v_auction_results — entries ⨝ auction ⨝ final score ⨝ the green lot's own cupping
--     score (reconciliation) + the clearing price + the price-multiplier over the farm's
--     commodity baseline (the BoP premium made visible). Commodity baseline = the latest
--     "C" + the house default differential, converted $/lb→$/kg via convert_qty.
create view v_auction_results with (security_invoker = on) as
  select
    e.tenant_id,
    e.id                          as entry_id,
    e.auction_id,
    a.name                        as auction_name,
    a.platform,
    a.status                      as auction_status,
    e.green_lot_code,
    g.cupping_score               as farm_cupping_score,   -- the farm's own grade INPUT
    e.jury_score,                                          -- the auction panel's verdict
    fs.final_score                as panel_final_score,     -- aggregated scoresheets
    e.clearing_price_usd_per_kg,
    e.winning_bidder,
    e.result_year,
    bl.commodity_baseline_usd_per_kg,
    case
      when bl.commodity_baseline_usd_per_kg is null
        or bl.commodity_baseline_usd_per_kg = 0
        or e.clearing_price_usd_per_kg is null then null
      else e.clearing_price_usd_per_kg / bl.commodity_baseline_usd_per_kg
    end                           as price_multiplier
  from auction_entries e
  join auctions a   on a.id = e.auction_id and a.tenant_id = e.tenant_id
  join green_lots g on g.lot_code = e.green_lot_code and g.tenant_id = e.tenant_id
  left join v_auction_final_score fs on fs.entry_id = e.id and fs.tenant_id = e.tenant_id
  left join lateral (
    select (lat.price + fsc.default_commodity_differential_usd_per_lb)
             * convert_qty(1, 'kg', '[lb]') as commodity_baseline_usd_per_kg
      from v_ice_c_latest lat
      join farm_season_config fsc on fsc.tenant_id = e.tenant_id
     where lat.tenant_id = e.tenant_id
     order by lat.as_of desc
     limit 1
  ) bl on true;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Command RPCs — the ONLY write doors. SECURITY DEFINER, tenant-clamped,
--    idempotent on a tenant-qualified key, lot_event in the same txn.
-- ════════════════════════════════════════════════════════════════════════════

-- 6a. create_auction — the auction-header writer.
create or replace function create_auction(
  p_platform         text,
  p_name             text,
  p_entry_deadline   timestamptz,
  p_scoring_deadline timestamptz,
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
  select id into v_id from auctions where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then
    return v_id;                                  -- exactly-once replay
  end if;
  insert into auctions (tenant_id, platform, name, entry_deadline, scoring_deadline, idempotency_key)
  values (v_tenant, p_platform::auction_platform, p_name, p_entry_deadline, p_scoring_deadline, v_key)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function create_auction(text, text, timestamptz, timestamptz, text) from public;
grant   execute on function create_auction(text, text, timestamptz, timestamptz, text) to authenticated;

-- 6b. enter_auction_lot — inserts the AUCTION reservation FIRST (so the EXISTING
--     prevent_oversell + _prevent_held_lot_commit triggers fire — no parallel counter,
--     no double-commit), then the entry carrying reservation_id. Appends 'auction_entered'.
create or replace function enter_auction_lot(
  p_auction_id      bigint,
  p_green_lot_code  text,
  p_kg              numeric,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_id     bigint;
  v_name   text;
  v_status text;
  v_res_id bigint;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;
  select id into v_id from auction_entries where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then
    return v_id;                                  -- exactly-once replay (no second claim)
  end if;

  select name, status into v_name, v_status
    from auctions where id = p_auction_id and tenant_id = v_tenant;
  if v_name is null then
    raise exception 'unknown auction % for tenant', p_auction_id using errcode = 'foreign_key_violation';
  end if;
  if v_status in ('sold', 'withdrawn') then
    raise exception 'auction % is % — cannot enter a lot', v_name, v_status
      using errcode = 'check_violation';
  end if;

  -- The money guarantee: insert the reservation FIRST so prevent_oversell fires.
  -- buyer = 'AUCTION:<name>' so an auction-committed lot reads as such in the claim set.
  insert into lot_reservations (tenant_id, green_lot_code, buyer, kg)
  values (v_tenant, p_green_lot_code, 'AUCTION:' || v_name, p_kg)
  returning id into v_res_id;

  insert into auction_entries (tenant_id, auction_id, green_lot_code, kg, reservation_id, idempotency_key)
  values (v_tenant, p_auction_id, p_green_lot_code, p_kg, v_res_id, v_key)
  returning id into v_id;

  perform record_lot_event(
    p_green_lot_code, 'auction_entered',
    jsonb_build_object('entry_id', v_id, 'auction_id', p_auction_id, 'auction_name', v_name,
                       'kg', p_kg, 'reservation_id', v_res_id),
    now(), 'server', nextval('lot_code_seq'), v_key || ':entered');

  return v_id;
end $$;
revoke execute on function enter_auction_lot(bigint, text, numeric, text) from public;
grant   execute on function enter_auction_lot(bigint, text, numeric, text) to authenticated;

-- 6c. record_auction_scoresheet — the append-only jury-mark writer.
create or replace function record_auction_scoresheet(
  p_entry_id        bigint,
  p_juror           text,
  p_attribute       text,
  p_score           numeric,
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
  select id into v_id from auction_scoresheets where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then
    return v_id;
  end if;
  if not exists (select 1 from auction_entries where id = p_entry_id and tenant_id = v_tenant) then
    raise exception 'unknown auction entry % for tenant', p_entry_id using errcode = 'foreign_key_violation';
  end if;
  insert into auction_scoresheets (tenant_id, entry_id, juror, attribute, score, idempotency_key)
  values (v_tenant, p_entry_id, p_juror, p_attribute, p_score, v_key)
  returning id into v_id;
  -- mark the auction 'scored' once jury capture begins (monotonic; never downgrades).
  update auctions a set status = 'scored'
    from auction_entries e
   where e.id = p_entry_id and e.tenant_id = v_tenant
     and a.id = e.auction_id and a.tenant_id = v_tenant
     and a.status = 'entered';
  return v_id;
end $$;
revoke execute on function record_auction_scoresheet(bigint, text, text, numeric, text) from public;
grant   execute on function record_auction_scoresheet(bigint, text, text, numeric, text) to authenticated;

-- 6d. record_auction_result — the WIN write-back. Stamps the entry (jury_score,
--     clearing price, winner), flips the auction to 'sold', and closes the loop into
--     P3-S0: posts an auction_comps row (the reserve comp library) AND a reserve
--     price_quotes row that REUSES the existing auction reservation (no second claim).
--     Appends 'auction_sold'. Idempotent on the entry already being sold.
create or replace function record_auction_result(
  p_entry_id                bigint,
  p_jury_score              numeric,
  p_clearing_price_usd_per_kg numeric,
  p_winning_bidder          text,
  p_result_year             integer,
  p_idempotency_key         text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_e      record;
  v_year   integer;
  v_cost   numeric;
  v_variety text;
  v_process text;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select * into v_e from auction_entries where id = p_entry_id and tenant_id = v_tenant;
  if not found then
    raise exception 'unknown auction entry %', p_entry_id using errcode = 'foreign_key_violation';
  end if;
  if v_e.sold_at is not null then
    return p_entry_id;                            -- idempotent (already cleared)
  end if;
  if p_clearing_price_usd_per_kg is null or p_clearing_price_usd_per_kg <= 0 then
    raise exception 'a cleared auction entry needs a positive clearing price'
      using errcode = 'check_violation';
  end if;

  v_year := coalesce(p_result_year, extract(year from now())::integer);

  -- 1) stamp the entry with the auction outcome.
  update auction_entries
     set jury_score = p_jury_score,
         clearing_price_usd_per_kg = p_clearing_price_usd_per_kg,
         winning_bidder = p_winning_bidder,
         result_year = v_year,
         sold_at = now()
   where id = p_entry_id and tenant_id = v_tenant;

  -- 2) flip the auction to 'sold'.
  update auctions set status = 'sold'
   where id = v_e.auction_id and tenant_id = v_tenant;

  -- 3) write-back A — post an auction_comps row so this price anchors the NEXT
  --    Geisha's reserve model (the loop the spec calls out).
  select variety into v_variety from lots where code = v_e.green_lot_code and tenant_id = v_tenant;
  insert into auction_comps
    (tenant_id, auction_name, lot_label, variety, process, cup_score,
     price_usd_per_kg, result_year, idempotency_key)
  select v_tenant, a.name, v_e.green_lot_code, v_variety, v_process, p_jury_score,
         p_clearing_price_usd_per_kg, v_year, v_key || ':comp'
    from auctions a where a.id = v_e.auction_id and a.tenant_id = v_tenant;

  -- 4) write-back B — record the realized sale as a reserve price_quotes row that
  --    REUSES the existing auction reservation (NEVER a new claim → no double-sell).
  --    cost snapshot via cogs_per_lot (NULL ⇒ margin unknown, flagged not fabricated).
  v_cost := cogs_per_lot(v_e.green_lot_code);
  insert into price_quotes
    (tenant_id, green_lot_code, regime, kg, unit_price, currency, fx_rate_to_usd,
     cost_per_kg_at_quote, status, reservation_id, idempotency_key)
  values
    (v_tenant, v_e.green_lot_code, 'reserve', v_e.kg, p_clearing_price_usd_per_kg, 'USD', 1,
     v_cost, 'accepted', v_e.reservation_id, v_key || ':wb-quote');

  -- 5) append the 'auction_sold' lot_event (verify_chain covers entered→sold).
  perform record_lot_event(
    v_e.green_lot_code, 'auction_sold',
    jsonb_build_object('entry_id', p_entry_id, 'auction_id', v_e.auction_id,
                       'jury_score', p_jury_score, 'clearing_price_usd_per_kg', p_clearing_price_usd_per_kg,
                       'winning_bidder', p_winning_bidder, 'result_year', v_year),
    now(), 'server', nextval('lot_code_seq'), v_key || ':sold');

  return p_entry_id;
end $$;
revoke execute on function record_auction_result(bigint, numeric, numeric, text, integer, text) from public;
grant   execute on function record_auction_result(bigint, numeric, numeric, text, integer, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. RLS — tenant-scoped read on every new table (mirrors the P4-S0 idiom). All
--    writes flow through the SECDEF RPCs (which bypass RLS + self-clamp the tenant),
--    so NO insert/update/delete policy exists — read-only at the policy layer.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['auctions','auction_entries','auction_scoresheets']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'create policy "tenant read" on public.%I for select to authenticated
         using (tenant_id = current_tenant_id());', t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. GRANTS (AD-8) — per-object SELECT to authenticated on every table/view (one
--    statement each so the name-anchored static guard matches). NO write grants;
--    anon gets NOTHING. RPC execute is revoked-from-public-then-granted above.
-- ════════════════════════════════════════════════════════════════════════════
grant select on auctions              to authenticated;
grant select on auction_entries       to authenticated;
grant select on auction_scoresheets   to authenticated;
grant select on v_auction_final_score to authenticated;
grant select on v_auction_results     to authenticated;

commit;
