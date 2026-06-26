-- ════════════════════════════════════════════════════════════════════════════
-- P3-S1 · B2B buyers + offers + standards-based sales contracts — THE TRADE TRUNK.
-- ════════════════════════════════════════════════════════════════════════════
-- Spec: docs/design/PHASE3-DESIGN.md lines 191–211 (+ §1 cross-slice rails).
-- Depends (HARD): P3-S0 price port (pricing_regime, v_ice_c_latest, convert_qty);
--                 Phase-1 green inventory (green_lots / green_lots_atp /
--                 lot_reservations / prevent_oversell); lot_event / record_lot_event.
--
-- THE KEYSTONE: the crown-jewel cannot be double-sold and cannot be mis-priced.
--   (1) A contract line claims green inventory by inserting a lot_reservations row,
--       so the EXISTING prevent_oversell trigger guards it for free — no parallel
--       counter. A second over-claim against the same lot rolls the whole txn back.
--   (2) A Presidential/Specialty single-origin lot (the reserve band) can NEVER carry
--       regime='commodity' on an offer, nor sit on a pricing_basis='differential'
--       contract — rejected at the data layer by a BEFORE-INSERT trigger, not just
--       the RPC.
--
-- Rails honored:
--   * One write door — every write is a SECURITY DEFINER RPC (set search_path =
--     public, extensions), tenant-clamped, idempotent on a tenant-qualified key,
--     appending the relevant lot_event in the SAME txn (offer_published /
--     contract_signed / price_fixed).
--   * AD-8/AD-9 grants — per-object `grant select … to authenticated`; on every RPC
--     `revoke execute … from public` THEN `grant execute … to authenticated`. anon
--     gets NOTHING.
--   * Tenant seam — every new table carries tenant_id + current_tenant_id() default
--     + an RLS read policy `using (tenant_id = current_tenant_id())`, mirroring the
--     on-disk P4-S0 idiom. New base tables are registered in src/test/db/tenantTables.ts.
--   * Append-only legal instruments — green_offers / contract_lines carry NO client
--     UPDATE/DELETE grant and NO update/delete policy; corrections are superseding
--     rows / RPC-driven status transitions (the price_quotes posture), so a blocking
--     immutability trigger is deliberately NOT used (the RPCs must flip status / set
--     the fixed price as owner).
--   * The lb↔kg "C" factor routes through convert_qty(1,'kg','[lb]') (never 2.2046).

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. b2b_buyers — the green-buyer CRM master (created here, extended by P3-S18).
--    name + ISO country_code (drives the consignee block) + incoterm/currency
--    defaults + roaster/importer/agent type. NOT append-only (CRM data evolves) —
--    but still RPC-only writes at the client boundary (no write grant/policy).
-- ════════════════════════════════════════════════════════════════════════════
create table b2b_buyers (
  id               bigint generated always as identity primary key,
  tenant_id        uuid    not null references tenants(id) default current_tenant_id(),
  name             text    not null,
  country_code     text,                                   -- ISO 3166-1 alpha-2/3
  buyer_type       text    check (buyer_type in ('roaster', 'importer', 'agent')),
  default_incoterm text,
  default_currency text    not null default 'USD',
  idempotency_key  text,
  created_at       timestamptz not null default now(),
  constraint b2b_buyers_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index b2b_buyers_tenant_idx on b2b_buyers (tenant_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. green_offers — append-only published offer lines. regime mirrors the dual
--    split (a Geisha NEVER carries regime='commodity' — trigger below); asking_price
--    NULL = auction/RFQ; corrections = a new row + withdrawn_at on the superseded one.
-- ════════════════════════════════════════════════════════════════════════════
create table green_offers (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  green_lot_code  text    not null,
  regime          pricing_regime not null,
  asking_price    numeric check (asking_price is null or asking_price > 0), -- NULL = auction/RFQ
  kg              numeric check (kg is null or kg > 0),                     -- offered quantity (NULL = all ATP)
  currency        text    not null default 'USD',
  withdrawn_at    timestamptz,
  idempotency_key text,
  created_at      timestamptz not null default now(),
  constraint green_offers_green_lot_tfk
    foreign key (tenant_id, green_lot_code) references green_lots(tenant_id, lot_code),
  constraint green_offers_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index green_offers_tenant_idx on green_offers (tenant_id);
create index green_offers_lot_idx    on green_offers (tenant_id, green_lot_code);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. sales_contracts — the standards-based contract header. Gap-free monotonic
--    JC-K-NNNN per tenant (minted in create_sales_contract under an advisory lock).
-- ════════════════════════════════════════════════════════════════════════════
create table sales_contracts (
  id                   bigint generated always as identity primary key,
  tenant_id            uuid    not null references tenants(id) default current_tenant_id(),
  contract_no          text    not null,
  buyer_id             bigint  not null references b2b_buyers(id),
  incoterm             text    not null
                         check (incoterm in
                           ('EXW','FCA','CPT','CIP','DAP','DPU','DDP','FAS','FOB','CFR','CIF')),
  incoterm_named_place text,
  contract_standard    text    check (contract_standard in ('GCA','ECF','custom')),
  pricing_basis        text    not null check (pricing_basis in ('fixed','differential','auction')),
  currency             text    not null default 'USD',
  status               text    not null default 'draft'
                         check (status in
                           ('draft','signed','fixed','in_transit','delivered','closed','cancelled')),
  signed_at            timestamptz,
  idempotency_key      text,
  created_at           timestamptz not null default now(),
  constraint sales_contracts_no_ux       unique (tenant_id, contract_no),
  constraint sales_contracts_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index sales_contracts_tenant_idx on sales_contracts (tenant_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 4. contract_lines — append-only contract lines. Adding a line ALSO inserts a
--    lot_reservations row (buyer = contract_no) so prevent_oversell guards it for
--    free; reservation_id carries the claim. differential_cents (cents/lb) +
--    ice_c_contract_month are the commodity leg; unit_price is the fixed $/kg
--    (set on fix_contract_price for a differential basis, or supplied for fixed).
-- ════════════════════════════════════════════════════════════════════════════
create table contract_lines (
  id                   bigint generated always as identity primary key,
  tenant_id            uuid    not null references tenants(id) default current_tenant_id(),
  contract_id          bigint  not null references sales_contracts(id),
  green_lot_code       text    not null,
  kg                   numeric not null check (kg > 0),
  unit_price           numeric check (unit_price is null or unit_price >= 0), -- $/kg (fixed leg)
  differential_cents   numeric,                                                -- cents/lb over "C"
  ice_c_contract_month text,                                                   -- the "C" reference month
  reservation_id       bigint references lot_reservations(id),
  fixed_at             timestamptz,
  idempotency_key      text,
  created_at           timestamptz not null default now(),
  constraint contract_lines_green_lot_tfk
    foreign key (tenant_id, green_lot_code) references green_lots(tenant_id, lot_code),
  constraint contract_lines_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index contract_lines_tenant_idx   on contract_lines (tenant_id);
create index contract_lines_contract_idx on contract_lines (tenant_id, contract_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Data-layer regime guards (fire on EVERY insert path — RPC or direct).
-- ════════════════════════════════════════════════════════════════════════════

-- 5a. green_offers_regime_chk — a reserve-mandatory lot (Presidential/Specialty
--     single-origin) can NEVER be published as regime='commodity'. Queries the lot
--     by new.tenant_id (NOT current_tenant_id()) so the guard holds on a direct
--     owner insert too. Mirrors S0's _enforce_regime_pricing.
create or replace function _green_offers_regime_chk() returns trigger
  language plpgsql set search_path = public
as $$
declare v_grade text; v_single boolean;
begin
  if new.regime = 'commodity' then
    select g.sca_grade, l.is_single_origin
      into v_grade, v_single
      from green_lots g
      join lots l on l.code = g.lot_code and l.tenant_id = g.tenant_id
     where g.lot_code = new.green_lot_code and g.tenant_id = new.tenant_id;
    if found and v_grade in ('Presidential', 'Specialty') and coalesce(v_single, false) then
      raise exception
        'regime isolation: green lot % is %-grade single-origin — it cannot be offered on the commodity index (reserve-only)',
        new.green_lot_code, v_grade
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger green_offers_regime_chk before insert on green_offers
  for each row execute function _green_offers_regime_chk();

-- 5b. contract_pricing_basis_chk — a reserve-mandatory lot can NEVER sit on a
--     pricing_basis='differential' contract (the commodity leg). Resolves the
--     parent contract's basis, then guards the lot's regime.
create or replace function _contract_line_basis_chk() returns trigger
  language plpgsql set search_path = public
as $$
declare v_basis text; v_grade text; v_single boolean;
begin
  select pricing_basis into v_basis
    from sales_contracts where id = new.contract_id and tenant_id = new.tenant_id;
  if v_basis = 'differential' then
    select g.sca_grade, l.is_single_origin
      into v_grade, v_single
      from green_lots g
      join lots l on l.code = g.lot_code and l.tenant_id = g.tenant_id
     where g.lot_code = new.green_lot_code and g.tenant_id = new.tenant_id;
    if found and v_grade in ('Presidential', 'Specialty') and coalesce(v_single, false) then
      raise exception
        'regime isolation: green lot % is %-grade single-origin — it cannot be sold on a differential (commodity) pricing basis (reserve-only)',
        new.green_lot_code, v_grade
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger contract_lines_basis_chk before insert on contract_lines
  for each row execute function _contract_line_basis_chk();

revoke execute on function _green_offers_regime_chk() from public;
revoke execute on function _contract_line_basis_chk() from public;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Read views (security_invoker — inherit the caller's RLS on the base tables).
-- ════════════════════════════════════════════════════════════════════════════

-- 6a. v_offer_board — live offers ⨝ green_lots grade/score ⨝ green_lots_atp (live ATP).
create view v_offer_board with (security_invoker = on) as
  select
    o.tenant_id,
    o.id                as offer_id,
    o.green_lot_code,
    o.regime,
    o.asking_price,
    o.kg                as offered_kg,
    o.currency,
    g.sca_grade,
    g.cupping_score,
    atp.atp             as atp_kg
  from green_offers o
  join green_lots g on g.lot_code = o.green_lot_code and g.tenant_id = o.tenant_id
  left join green_lots_atp atp on atp.green_lot_code = o.green_lot_code
  where o.withdrawn_at is null;

-- 6b. v_contract_status — header + Σ line kg + Σ fixed value + fixation %.
create view v_contract_status with (security_invoker = on) as
  select
    c.tenant_id,
    c.id                as contract_id,
    c.contract_no,
    c.buyer_id,
    c.status,
    c.pricing_basis,
    c.incoterm,
    c.currency,
    coalesce(sum(li.kg), 0)                                          as total_kg,
    coalesce(sum(case when li.unit_price is not null
                      then li.unit_price * li.kg else 0 end), 0)     as fixed_value,
    case when count(li.id) = 0 then 0
         else count(li.id) filter (where li.unit_price is not null)::numeric
              / count(li.id) end                                     as fixation_pct
  from sales_contracts c
  left join contract_lines li on li.contract_id = c.id and li.tenant_id = c.tenant_id
  group by c.tenant_id, c.id, c.contract_no, c.buyer_id, c.status,
           c.pricing_basis, c.incoterm, c.currency;

-- 6c. v_fixation_cockpit — un-fixed differential lines × current "C" + implied price.
create view v_fixation_cockpit with (security_invoker = on) as
  select
    li.tenant_id,
    li.id               as contract_line_id,
    li.contract_id,
    c.contract_no,
    li.green_lot_code,
    li.kg,
    li.differential_cents,
    li.ice_c_contract_month,
    (select lat.price from v_ice_c_latest lat
      where lat.tenant_id = li.tenant_id
        and lat.contract_month = li.ice_c_contract_month
      limit 1)                                                       as current_c_price,
    ((select lat.price from v_ice_c_latest lat
       where lat.tenant_id = li.tenant_id
         and lat.contract_month = li.ice_c_contract_month
       limit 1) + coalesce(li.differential_cents, 0) / 100.0)
       * convert_qty(1, 'kg', '[lb]')                                as implied_unit_price
  from contract_lines li
  join sales_contracts c on c.id = li.contract_id and c.tenant_id = li.tenant_id
  where c.pricing_basis = 'differential'
    and li.unit_price is null;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Command RPCs — the ONLY write doors. SECURITY DEFINER, tenant-clamped,
--    idempotent on a tenant-qualified key, lot_event in the same txn.
-- ════════════════════════════════════════════════════════════════════════════

-- 7a. create_b2b_buyer — the buyer CRM-master writer.
create or replace function create_b2b_buyer(
  p_name             text,
  p_country_code     text,
  p_buyer_type       text,
  p_default_incoterm text,
  p_default_currency text,
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
  select id into v_id from b2b_buyers where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then
    return v_id;                                  -- exactly-once replay
  end if;
  insert into b2b_buyers (tenant_id, name, country_code, buyer_type,
                          default_incoterm, default_currency, idempotency_key)
  values (v_tenant, p_name, p_country_code, p_buyer_type,
          p_default_incoterm, coalesce(p_default_currency, 'USD'), v_key)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function create_b2b_buyer(text, text, text, text, text, text) from public;
grant   execute on function create_b2b_buyer(text, text, text, text, text, text) to authenticated;

-- 7b. publish_green_offer — validates regime vs the lot (the trigger fires),
--     appends 'offer_published'. asking_price NULL = auction/RFQ.
create or replace function publish_green_offer(
  p_green_lot_code  text,
  p_regime          text,
  p_asking_price    numeric,
  p_kg              numeric,
  p_currency        text,
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
  select id into v_id from green_offers where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then
    return v_id;
  end if;

  insert into green_offers (tenant_id, green_lot_code, regime, asking_price, kg,
                            currency, idempotency_key)
  values (v_tenant, p_green_lot_code, p_regime::pricing_regime, p_asking_price, p_kg,
          coalesce(p_currency, 'USD'), v_key)
  returning id into v_id;

  perform record_lot_event(
    p_green_lot_code, 'offer_published',
    jsonb_build_object('offer_id', v_id, 'regime', p_regime, 'asking_price', p_asking_price,
                       'kg', p_kg, 'currency', coalesce(p_currency, 'USD')),
    now(), 'server', nextval('lot_code_seq'), v_key || ':offered');

  return v_id;
end $$;
revoke execute on function publish_green_offer(text, text, numeric, numeric, text, text) from public;
grant   execute on function publish_green_offer(text, text, numeric, numeric, text, text) to authenticated;

-- 7c. create_sales_contract — mints a gap-free monotonic JC-K-NNNN per tenant under
--     an advisory lock (the prevent_oversell / _next_lot_code idiom). Resolves the
--     buyer within the caller's tenant (no cross-tenant buyer reference). Returns id.
create or replace function create_sales_contract(
  p_buyer_id             bigint,
  p_incoterm             text,
  p_incoterm_named_place text,
  p_contract_standard    text,
  p_pricing_basis        text,
  p_currency             text,
  p_idempotency_key      text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_id     bigint;
  v_n      bigint;
  v_no     text;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;
  select id into v_id from sales_contracts where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then
    return v_id;
  end if;

  if not exists (select 1 from b2b_buyers where id = p_buyer_id and tenant_id = v_tenant) then
    raise exception 'unknown buyer % for tenant', p_buyer_id using errcode = 'foreign_key_violation';
  end if;

  -- gap-free monotonic JC-K-NNNN per tenant (advisory-locked so concurrent mints queue).
  perform pg_advisory_xact_lock(hashtext('contract_no:' || v_tenant::text));
  select coalesce(
           max((regexp_replace(contract_no, '\D', '', 'g'))::bigint), 0) + 1
    into v_n
    from sales_contracts
   where tenant_id = v_tenant and contract_no ~ '^JC-K-[0-9]+$';
  v_no := 'JC-K-' || lpad(v_n::text, 4, '0');

  insert into sales_contracts (tenant_id, contract_no, buyer_id, incoterm, incoterm_named_place,
                               contract_standard, pricing_basis, currency, status, idempotency_key)
  values (v_tenant, v_no, p_buyer_id, p_incoterm, p_incoterm_named_place,
          p_contract_standard, p_pricing_basis, coalesce(p_currency, 'USD'), 'draft', v_key)
  returning id into v_id;

  return v_id;
end $$;
revoke execute on function create_sales_contract(bigint, text, text, text, text, text, text) from public;
grant   execute on function create_sales_contract(bigint, text, text, text, text, text, text) to authenticated;

-- 7d. add_contract_line — inserts the lot_reservations CLAIM FIRST (so prevent_oversell
--     + _prevent_held_lot_commit fire before anything commits), then the line carrying
--     the reservation_id. Rejects unless the contract is still in 'draft'.
create or replace function add_contract_line(
  p_contract_id         bigint,
  p_green_lot_code      text,
  p_kg                  numeric,
  p_unit_price          numeric,
  p_differential_cents  numeric,
  p_ice_c_contract_month text,
  p_idempotency_key     text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_id     bigint;
  v_no     text;
  v_status text;
  v_res_id bigint;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;
  select id into v_id from contract_lines where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then
    return v_id;
  end if;

  select contract_no, status into v_no, v_status
    from sales_contracts where id = p_contract_id and tenant_id = v_tenant;
  if v_no is null then
    raise exception 'unknown contract % for tenant', p_contract_id using errcode = 'foreign_key_violation';
  end if;
  if v_status <> 'draft' then
    raise exception 'contract % cannot add lines from status % (must be draft)', v_no, v_status
      using errcode = 'check_violation';
  end if;

  -- The money guarantee: insert the reservation FIRST so the EXISTING prevent_oversell
  -- + _prevent_held_lot_commit triggers fire (no parallel counter). buyer = contract_no.
  insert into lot_reservations (tenant_id, green_lot_code, buyer, kg)
  values (v_tenant, p_green_lot_code, v_no, p_kg)
  returning id into v_res_id;

  insert into contract_lines (tenant_id, contract_id, green_lot_code, kg, unit_price,
                              differential_cents, ice_c_contract_month, reservation_id, idempotency_key)
  values (v_tenant, p_contract_id, p_green_lot_code, p_kg, p_unit_price,
          p_differential_cents, p_ice_c_contract_month, v_res_id, v_key)
  returning id into v_id;

  return v_id;
end $$;
revoke execute on function add_contract_line(bigint, text, numeric, numeric, numeric, text, text) from public;
grant   execute on function add_contract_line(bigint, text, numeric, numeric, numeric, text, text) to authenticated;

-- 7e. sign_sales_contract — requires ≥1 line + status 'draft'; flips to 'signed';
--     appends a 'contract_signed' lot_event per distinct green lot in the contract.
--     (Reserve contracts will additionally require an approved sample once P3-S2
--     lands — TODO seam: add the green_samples prereq there, not here.)
create or replace function sign_sales_contract(
  p_contract_id     bigint,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_no     text;
  v_status text;
  v_lines  integer;
  r        record;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select contract_no, status into v_no, v_status
    from sales_contracts where id = p_contract_id and tenant_id = v_tenant;
  if v_no is null then
    raise exception 'unknown contract % for tenant', p_contract_id using errcode = 'foreign_key_violation';
  end if;
  if v_status = 'signed' then
    return p_contract_id;                          -- idempotent
  end if;
  if v_status <> 'draft' then
    raise exception 'contract % cannot be signed from status %', v_no, v_status
      using errcode = 'check_violation';
  end if;

  select count(*) into v_lines from contract_lines
   where contract_id = p_contract_id and tenant_id = v_tenant;
  if v_lines = 0 then
    raise exception 'contract % cannot be signed with no lines', v_no
      using errcode = 'check_violation';
  end if;

  update sales_contracts set status = 'signed', signed_at = now()
   where id = p_contract_id and tenant_id = v_tenant;

  -- append a 'contract_signed' event per distinct green lot (verify_chain covers
  -- offer→sold for each lot).
  for r in
    select distinct green_lot_code from contract_lines
     where contract_id = p_contract_id and tenant_id = v_tenant
  loop
    perform record_lot_event(
      r.green_lot_code, 'contract_signed',
      jsonb_build_object('contract_id', p_contract_id, 'contract_no', v_no,
                         'green_lot_code', r.green_lot_code),
      now(), 'server', nextval('lot_code_seq'),
      v_key || ':signed:' || r.green_lot_code);
  end loop;

  return p_contract_id;
end $$;
revoke execute on function sign_sales_contract(bigint, text) from public;
grant   execute on function sign_sales_contract(bigint, text) to authenticated;

-- 7f. fix_contract_price — the fixation writer for a differential contract line.
--     Reads the live "C" (P3-S0 v_ice_c_latest), refuses to fix a line with no
--     reservation (no phantom kg), computes the fixed $/kg via convert_qty, sets the
--     line's unit_price + fixed_at, flips the contract to 'fixed', appends 'price_fixed'.
create or replace function fix_contract_price(
  p_contract_line_id bigint,
  p_idempotency_key  text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_line   record;
  v_basis  text;
  v_c      numeric;
  v_unit   numeric;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select * into v_line from contract_lines
   where id = p_contract_line_id and tenant_id = v_tenant;
  if not found then
    raise exception 'unknown contract line %', p_contract_line_id using errcode = 'foreign_key_violation';
  end if;
  if v_line.unit_price is not null then
    return p_contract_line_id;                     -- already fixed (idempotent)
  end if;
  -- no phantom kg: a line whose reservation is missing cannot be fixed.
  if v_line.reservation_id is null then
    raise exception 'contract line % has no reservation — cannot fix a phantom kg', p_contract_line_id
      using errcode = 'check_violation';
  end if;

  select pricing_basis into v_basis from sales_contracts
   where id = v_line.contract_id and tenant_id = v_tenant;
  if v_basis <> 'differential' then
    raise exception 'fixation guard: contract line % is on a % basis — only a differential line carries a "C" leg to fix', p_contract_line_id, v_basis
      using errcode = 'check_violation';
  end if;

  select price into v_c from v_ice_c_latest
   where tenant_id = v_tenant and contract_month = v_line.ice_c_contract_month;
  if v_c is null then
    raise exception 'no ICE "C" mark to fix for month %', v_line.ice_c_contract_month
      using errcode = 'no_data_found';
  end if;

  -- fixed $/kg = ("C" $/lb + differential cents/lb ÷ 100) × convert_qty(1,'kg','[lb]').
  v_unit := (v_c + coalesce(v_line.differential_cents, 0) / 100.0) * convert_qty(1, 'kg', '[lb]');

  update contract_lines set unit_price = v_unit, fixed_at = now()
   where id = p_contract_line_id and tenant_id = v_tenant;
  update sales_contracts set status = 'fixed'
   where id = v_line.contract_id and tenant_id = v_tenant and status = 'signed';

  perform record_lot_event(
    v_line.green_lot_code, 'price_fixed',
    jsonb_build_object('contract_line_id', p_contract_line_id, 'contract_id', v_line.contract_id,
                       'c_price', v_c, 'differential_cents', v_line.differential_cents,
                       'unit_price', v_unit, 'contract_month', v_line.ice_c_contract_month),
    now(), 'server', nextval('lot_code_seq'), v_key || ':fixed');

  return p_contract_line_id;
end $$;
revoke execute on function fix_contract_price(bigint, text) from public;
grant   execute on function fix_contract_price(bigint, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. RLS — tenant-scoped read on every new table (mirrors the P4-S0 idiom). All
--    writes flow through the SECDEF RPCs (which bypass RLS + self-clamp the tenant),
--    so NO insert/update/delete policy exists — read-only at the policy layer (this
--    is what makes green_offers / contract_lines append-only for clients).
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['b2b_buyers','green_offers','sales_contracts','contract_lines']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'create policy "tenant read" on public.%I for select to authenticated
         using (tenant_id = current_tenant_id());', t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. GRANTS (AD-8) — per-object SELECT to authenticated on every table/view (one
--    statement each so the name-anchored static guard matches). NO write grants;
--    anon gets NOTHING. RPC execute is revoked-from-public-then-granted above.
-- ════════════════════════════════════════════════════════════════════════════
grant select on b2b_buyers         to authenticated;
grant select on green_offers       to authenticated;
grant select on sales_contracts    to authenticated;
grant select on contract_lines     to authenticated;
grant select on v_offer_board      to authenticated;
grant select on v_contract_status  to authenticated;
grant select on v_fixation_cockpit to authenticated;

commit;
