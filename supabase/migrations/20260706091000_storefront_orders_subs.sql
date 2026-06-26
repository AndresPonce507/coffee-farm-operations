-- ════════════════════════════════════════════════════════════════════════════
-- P3-S12 · DTC orders + Stripe Checkout (MOCK/$0) + Reserve-Club subscriptions.
-- ════════════════════════════════════════════════════════════════════════════
-- Spec: docs/design/PHASE3-DESIGN.md lines 315-323 (+ §1 cross-slice rails + §0.2
--       inherited facts). The retail checkout + recurring-box slice on top of S11's
--       lot-linked SKUs: a `customers` book, `orders`/`order_lines` whose totals are
--       computed SERVER-SIDE from product_skus.price_usd_cents (a tampered cart can't
--       underpay), a Stripe-exactly-once `webhook_events` PK idempotency table, and a
--       Reserve-Club subscription stack whose `allocate_subscription_cycle` REUSES the
--       Phase-1 oversell machinery VERBATIM (inserts a lot_reservations row so the
--       existing prevent_oversell trigger fires) — a $30k/kg Geisha micro-lot can NEVER
--       be promised to more subscribers than kg exist.
-- Deps: P3-S11 (products / product_skus / finished_goods / record_fg_movement,
--       20260706090000), Phase-1 green inventory (green_lots / lot_reservations /
--       prevent_oversell / record_lot_event / lot_code_seq), the P4-S0 tenant seam.
-- Live max at authoring: 20260706090000_storefront_skus.sql — this timestamp
--       (20260706091000) is strictly greater; single schema author for the serial lane.
--
-- §1 RAILS HONORED:
--   * ONE write door — every mutation flows through a SECURITY DEFINER, tenant-clamped,
--     idempotent RPC; NO client INSERT/UPDATE/DELETE grant on any table.
--   * AD-8/AD-9 grants EXACTLY — per-object `grant select ... to authenticated` (one
--     statement each); every RPC `revoke execute ... from public` THEN grant; anon gets
--     NOTHING. Browser-callable RPCs -> authenticated; the two webhook/edge-function
--     RPCs (mark_order_paid, issue_dgi_cufe) -> service_role ONLY (never browser).
--   * MONEY GUARANTEE REUSED, NOT REBUILT — orders decrement stock via S11's
--     record_fg_movement (its fail-closed finished-goods guard); subscription
--     allocations insert a lot_reservations row so the EXISTING prevent_oversell trigger
--     fires. No parallel counter anywhere.
--   * SERVER-COMPUTED TOTALS — create_order reads price_usd_cents from product_skus and
--     computes subtotal / ITBMS 7% / total itself; it takes NO client total.
--   * APPEND-ONLY ledgers — sub_allocations / sub_events / webhook_events are immutable.
--   * tenant_id + current_tenant_id() + RLS on every new table; lot-event audit via
--     record_lot_event in the same txn.
-- Paid gate: Stripe = allowed ($0-until-revenue, hosted Checkout/Billing, webhook on the
--   free Edge tier). DGI CUFE = a later PAC flag — this slice provides the dgi_cufe
--   column + issue_dgi_cufe hook but calls NO PAC (the $0 path stamps an internal folio).
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 0. service_role — exists on real Supabase; create it if absent so the grants below
--    replay in PGlite (the test harness only pre-creates anon + authenticated).
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Enums — order channel/status + subscription status/cadence.
-- ════════════════════════════════════════════════════════════════════════════
create type order_channel as enum ('web', 'pos', 'wholesale');
create type order_status  as enum ('pending', 'paid', 'fulfilled', 'cancelled', 'refunded');
create type sub_status    as enum ('active', 'paused', 'past_due', 'cancelled');
create type sub_cadence   as enum ('monthly', 'bi-monthly', 'quarterly');

-- ════════════════════════════════════════════════════════════════════════════
-- 2. customers — the DTC contact book. Email uniqueness is CASE-INSENSITIVE via a
--    lower() expression index (no citext dependency — keeps the migration replayable).
-- ════════════════════════════════════════════════════════════════════════════
create table customers (
  id                 bigint generated always as identity primary key,
  tenant_id          uuid    not null references tenants(id) default current_tenant_id(),
  email              text    not null,
  name               text,
  stripe_customer_id text,
  marketing_consent  boolean not null default false,
  idempotency_key    text,
  created_at         timestamptz not null default now(),
  constraint customers_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index customers_tenant_idx on customers (tenant_id);
create unique index customers_tenant_email_ux on customers (tenant_id, lower(email));

-- ════════════════════════════════════════════════════════════════════════════
-- 3. orders + order_lines — totals computed SERVER-SIDE; lines capture green_lot_code.
-- ════════════════════════════════════════════════════════════════════════════
create table orders (
  id                      bigint generated always as identity primary key,
  tenant_id               uuid    not null references tenants(id) default current_tenant_id(),
  customer_id             bigint  not null references customers(id),
  channel                 order_channel not null,
  status                  order_status  not null default 'pending',
  currency                text    not null default 'USD',
  subtotal_cents          integer not null check (subtotal_cents >= 0),
  dgi_tax_cents           integer not null check (dgi_tax_cents >= 0),   -- ITBMS 7%
  total_cents             integer not null check (total_cents >= 0),
  stripe_payment_intent   text,
  stripe_checkout_session text,
  dgi_cufe                text,                                          -- fiscal folio
  idempotency_key         text,
  created_at              timestamptz not null default now(),
  constraint orders_tenant_idem_ux unique (tenant_id, idempotency_key),
  -- the total is the server's arithmetic, enforced at the data layer too.
  constraint orders_total_is_sum check (total_cents = subtotal_cents + dgi_tax_cents)
);
create index orders_tenant_idx   on orders (tenant_id);
create index orders_customer_idx on orders (customer_id);

create table order_lines (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  order_id        bigint  not null references orders(id),
  sku_id          bigint  not null references product_skus(id),
  green_lot_code  text    not null,                       -- captured for provenance/COGS
  qty_units       integer not null check (qty_units > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  line_total_cents integer not null check (line_total_cents >= 0),
  created_at      timestamptz not null default now()
);
create index order_lines_tenant_idx on order_lines (tenant_id);
create index order_lines_order_idx   on order_lines (order_id);
create index order_lines_green_idx   on order_lines (green_lot_code);

-- ════════════════════════════════════════════════════════════════════════════
-- 4. webhook_events — the Stripe exactly-once ledger. stripe_event_id is the PK; a
--    replayed event collides and is a no-op (mirrors lot_event.idempotency_key).
--    Append-only (immutability trigger below).
-- ════════════════════════════════════════════════════════════════════════════
create table webhook_events (
  stripe_event_id text    primary key,
  tenant_id       uuid    not null references tenants(id),
  order_id        bigint  references orders(id),
  event_type      text    not null,
  received_at     timestamptz not null default now()
);
create index webhook_events_tenant_idx on webhook_events (tenant_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 5. subscriptions + subscription_lines — Reserve-Club recurring boxes.
-- ════════════════════════════════════════════════════════════════════════════
create table subscriptions (
  id                     bigint generated always as identity primary key,
  tenant_id              uuid    not null references tenants(id) default current_tenant_id(),
  customer_id            bigint  not null references customers(id),
  cadence                sub_cadence not null,
  status                 sub_status  not null default 'active',
  stripe_subscription_id text,
  started_at             timestamptz not null default now(),
  idempotency_key        text,
  created_at             timestamptz not null default now(),
  constraint subscriptions_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index subscriptions_tenant_idx   on subscriptions (tenant_id);
create index subscriptions_customer_idx on subscriptions (customer_id);

create table subscription_lines (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  subscription_id bigint  not null references subscriptions(id),
  sku_id          bigint  not null references product_skus(id),
  qty_units       integer not null check (qty_units > 0),
  created_at      timestamptz not null default now()
);
create index subscription_lines_tenant_idx on subscription_lines (tenant_id);
create index subscription_lines_sub_idx     on subscription_lines (subscription_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 6. sub_allocations — APPEND-ONLY claim linking a subscription cycle to a green-lot
--    reservation. The reservation_id FK points at the lot_reservations row whose INSERT
--    fired prevent_oversell (the money guarantee, REUSED). Composite FK to green_lots.
-- ════════════════════════════════════════════════════════════════════════════
create table sub_allocations (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  subscription_id bigint  not null references subscriptions(id),
  green_lot_code  text    not null,
  kg              numeric not null check (kg > 0),
  reservation_id  bigint  not null references lot_reservations(id),
  cycle_label     text    not null,
  idempotency_key text,
  created_at      timestamptz not null default now(),
  constraint sub_allocations_tenant_idem_ux unique (tenant_id, idempotency_key),
  constraint sub_allocations_green_lot_tfk
    foreign key (tenant_id, green_lot_code) references green_lots(tenant_id, lot_code)
);
create index sub_allocations_tenant_idx on sub_allocations (tenant_id);
create index sub_allocations_sub_idx     on sub_allocations (subscription_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 7. sub_events — APPEND-ONLY subscription lifecycle ledger (created/paused/resumed/
--    skipped/swapped/cancelled/allocated/dunning).
-- ════════════════════════════════════════════════════════════════════════════
create table sub_events (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  subscription_id bigint  not null references subscriptions(id),
  kind            text    not null
    check (kind in ('created','paused','resumed','skipped','swapped','cancelled','allocated','dunning')),
  payload         jsonb   not null default '{}'::jsonb,
  occurred_at     timestamptz not null default now(),
  idempotency_key text,
  created_at      timestamptz not null default now(),
  constraint sub_events_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index sub_events_tenant_idx on sub_events (tenant_id);
create index sub_events_sub_idx     on sub_events (subscription_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 8. Append-only immutability triggers (the cost_entry_immutable idiom).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function _sub_allocations_immutable() returns trigger
  language plpgsql set search_path = public
as $$
begin
  raise exception
    'sub_allocations is append-only: % is not permitted — post a superseding row instead', tg_op
    using errcode = 'restrict_violation';
end $$;
create trigger sub_allocations_no_update before update on sub_allocations
  for each row execute function _sub_allocations_immutable();
create trigger sub_allocations_no_delete before delete on sub_allocations
  for each row execute function _sub_allocations_immutable();

create or replace function _sub_events_immutable() returns trigger
  language plpgsql set search_path = public
as $$
begin
  raise exception
    'sub_events is append-only: % is not permitted', tg_op using errcode = 'restrict_violation';
end $$;
create trigger sub_events_no_update before update on sub_events
  for each row execute function _sub_events_immutable();
create trigger sub_events_no_delete before delete on sub_events
  for each row execute function _sub_events_immutable();

create or replace function _webhook_events_immutable() returns trigger
  language plpgsql set search_path = public
as $$
begin
  raise exception
    'webhook_events is append-only: % is not permitted', tg_op using errcode = 'restrict_violation';
end $$;
create trigger webhook_events_no_update before update on webhook_events
  for each row execute function _webhook_events_immutable();
create trigger webhook_events_no_delete before delete on webhook_events
  for each row execute function _webhook_events_immutable();

-- ════════════════════════════════════════════════════════════════════════════
-- 9. Internal helper — upsert a customer by (tenant, lower(email)), returning the id.
--    SECURITY DEFINER; called only by the command RPCs (never granted to a caller).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function _upsert_customer(
  p_tenant uuid, p_email text, p_name text, p_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare v_id bigint;
begin
  select id into v_id from customers
   where tenant_id = p_tenant and lower(email) = lower(p_email);
  if v_id is not null then
    -- keep the freshest non-null name without mutating identity.
    if p_name is not null then
      update customers set name = p_name where id = v_id and name is distinct from p_name;
    end if;
    return v_id;
  end if;
  insert into customers (tenant_id, email, name, idempotency_key)
  values (p_tenant, p_email, p_name, p_key)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function _upsert_customer(uuid, text, text, text) from public;

-- ════════════════════════════════════════════════════════════════════════════
-- 10. Command RPCs — the ONLY write door. All SECURITY DEFINER, tenant-clamped,
--     idempotent. Browser-callable ones grant to authenticated; the webhook ones to
--     service_role only.
-- ════════════════════════════════════════════════════════════════════════════

-- 10a. create_order — SERVER-COMPUTES subtotal / ITBMS 7% / total from
--      product_skus.price_usd_cents (NEVER trusts a client total — it takes none), then
--      decrements finished goods for each line via record_fg_movement (the S11
--      fail-closed oversell guard fires — an over-order rolls the whole txn back).
--      p_lines is a JSON array of {sku_id, qty_units}.
create or replace function create_order(
  p_customer_email  text,
  p_customer_name   text,
  p_channel         text,
  p_currency        text,
  p_lines           jsonb,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant   uuid := current_tenant_id();
  v_key      text;
  v_order    bigint;
  v_cust     bigint;
  v_line     jsonb;
  v_sku      bigint;
  v_qty      integer;
  v_price    integer;
  v_green    text;
  v_subtotal integer := 0;
  v_tax      integer;
  v_line_no  integer := 0;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select id into v_order from orders where tenant_id = v_tenant and idempotency_key = v_key;
  if v_order is not null then return v_order; end if;       -- idempotent

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'create_order requires at least one line' using errcode = 'check_violation';
  end if;

  v_cust := _upsert_customer(v_tenant, p_customer_email, p_customer_name, v_key || ':cust');

  -- Create the order shell first (status pending); totals patched after the lines roll up.
  insert into orders (tenant_id, customer_id, channel, status, currency,
                      subtotal_cents, dgi_tax_cents, total_cents, idempotency_key)
  values (v_tenant, v_cust, p_channel::order_channel, 'pending', coalesce(p_currency, 'USD'),
          0, 0, 0, v_key)
  returning id into v_order;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_line_no := v_line_no + 1;
    v_sku := (v_line->>'sku_id')::bigint;
    v_qty := (v_line->>'qty_units')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'line %: qty_units must be greater than zero', v_line_no using errcode = 'check_violation';
    end if;

    -- SERVER-SIDE price: read it from the SKU, tenant-clamped. The client cannot set it.
    select price_usd_cents, green_lot_code into v_price, v_green
      from product_skus where id = v_sku and tenant_id = v_tenant;
    if v_price is null then
      raise exception 'unknown sku %', v_sku using errcode = 'foreign_key_violation';
    end if;

    insert into order_lines (tenant_id, order_id, sku_id, green_lot_code, qty_units,
                             unit_price_cents, line_total_cents)
    values (v_tenant, v_order, v_sku, v_green, v_qty, v_price, v_price * v_qty);

    v_subtotal := v_subtotal + v_price * v_qty;

    -- ALLOCATE finished goods: the S11 guard fails closed if stock is short (the whole
    -- order txn rolls back). REUSED, not rebuilt — no parallel counter.
    perform record_fg_movement(v_sku, -v_qty, 'sale', v_key || ':l' || v_line_no);
  end loop;

  -- ITBMS (Panama sales tax) is statutory 7% on the goods subtotal.
  v_tax := round(v_subtotal * 0.07)::integer;
  update orders
     set subtotal_cents = v_subtotal,
         dgi_tax_cents  = v_tax,
         total_cents    = v_subtotal + v_tax
   where id = v_order;

  perform record_lot_event(
    'activity', 'order_placed',
    jsonb_build_object('order_id', v_order, 'channel', p_channel, 'subtotal_cents', v_subtotal,
                       'tax_cents', v_tax, 'total_cents', v_subtotal + v_tax),
    now(), 'server', nextval('lot_code_seq'), v_key || ':order');

  return v_order;
end $$;
revoke execute on function create_order(text, text, text, text, jsonb, text) from public;
grant   execute on function create_order(text, text, text, text, jsonb, text) to authenticated;

-- 10b. create_checkout_order — the Stripe hosted-Checkout entry. Delegates to
--      create_order (web channel, same server-side compute + allocation), then stamps
--      the checkout session id. Idempotent through the delegate.
create or replace function create_checkout_order(
  p_customer_email         text,
  p_customer_name          text,
  p_currency               text,
  p_lines                  jsonb,
  p_stripe_checkout_session text,
  p_idempotency_key        text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_order  bigint;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_order := create_order(p_customer_email, p_customer_name, 'web', p_currency, p_lines, p_idempotency_key);
  update orders set stripe_checkout_session = p_stripe_checkout_session
   where id = v_order and tenant_id = v_tenant;
  return v_order;
end $$;
revoke execute on function create_checkout_order(text, text, text, jsonb, text, text) from public;
grant   execute on function create_checkout_order(text, text, text, jsonb, text, text) to authenticated;

-- 10c. mark_order_paid — STRIPE EXACTLY-ONCE. service_role ONLY (called from the
--      Stripe-webhook Edge Function, NEVER a browser). Tenant is derived from the ORDER
--      (a service_role session carries no JWT tenant claim). Idempotent via the
--      webhook_events PK: a replayed stripe_event_id collides on insert -> no-op.
create or replace function mark_order_paid(
  p_order_id        bigint,
  p_stripe_event_id text,
  p_payment_intent  text,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid;
  v_status order_status;
  v_seen   integer;
begin
  select tenant_id, status into v_tenant, v_status from orders where id = p_order_id;
  if v_tenant is null then
    raise exception 'unknown order %', p_order_id using errcode = 'foreign_key_violation';
  end if;

  -- EXACTLY-ONCE: claim the stripe event. A duplicate event collides on the PK; we
  -- swallow it and return (the order was already settled by the first delivery).
  insert into webhook_events (stripe_event_id, tenant_id, order_id, event_type)
  values (p_stripe_event_id, v_tenant, p_order_id, 'payment_succeeded')
  on conflict (stripe_event_id) do nothing;
  get diagnostics v_seen = row_count;
  if v_seen = 0 then
    return p_order_id;                  -- replay — no second status flip, no double-charge.
  end if;

  -- First delivery: settle the order (idempotent on status too).
  if v_status = 'pending' then
    update orders
       set status = 'paid', stripe_payment_intent = p_payment_intent
     where id = p_order_id;
  end if;

  perform record_lot_event(
    'activity', 'order_paid',
    jsonb_build_object('order_id', p_order_id, 'stripe_event_id', p_stripe_event_id,
                       'payment_intent', p_payment_intent),
    now(), 'server', nextval('lot_code_seq'), v_tenant::text || ':paid:' || p_stripe_event_id);

  return p_order_id;
end $$;
revoke execute on function mark_order_paid(bigint, text, text, text) from public;
grant   execute on function mark_order_paid(bigint, text, text, text) to service_role;

-- 10d. issue_dgi_cufe — stamps the fiscal folio after a (later) PAC round-trip.
--      service_role ONLY. $0 path: the caller supplies an internal non-fiscal folio;
--      no PAC is contacted here. Idempotent (a re-stamp returns the order).
create or replace function issue_dgi_cufe(
  p_order_id        bigint,
  p_cufe            text,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare v_existing text;
begin
  select dgi_cufe into v_existing from orders where id = p_order_id;
  if not found then
    raise exception 'unknown order %', p_order_id using errcode = 'foreign_key_violation';
  end if;
  if v_existing is not null then
    return p_order_id;                  -- already stamped — idempotent.
  end if;
  update orders set dgi_cufe = p_cufe where id = p_order_id;
  return p_order_id;
end $$;
revoke execute on function issue_dgi_cufe(bigint, text, text) from public;
grant   execute on function issue_dgi_cufe(bigint, text, text) to service_role;

-- 10e. create_subscription — mints a Reserve-Club subscription (status active) + one
--      subscription_line, appends a 'created' sub_event. Idempotent on the client key.
create or replace function create_subscription(
  p_customer_email       text,
  p_customer_name        text,
  p_sku_id               bigint,
  p_cadence              text,
  p_qty_units            integer,
  p_stripe_subscription_id text,
  p_idempotency_key      text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_sub    bigint;
  v_cust   bigint;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select id into v_sub from subscriptions where tenant_id = v_tenant and idempotency_key = v_key;
  if v_sub is not null then return v_sub; end if;          -- idempotent

  if not exists (select 1 from product_skus where id = p_sku_id and tenant_id = v_tenant) then
    raise exception 'unknown sku %', p_sku_id using errcode = 'foreign_key_violation';
  end if;
  if coalesce(p_qty_units, 0) <= 0 then
    raise exception 'qty_units must be greater than zero' using errcode = 'check_violation';
  end if;

  v_cust := _upsert_customer(v_tenant, p_customer_email, p_customer_name, v_key || ':cust');

  insert into subscriptions (tenant_id, customer_id, cadence, status, stripe_subscription_id, idempotency_key)
  values (v_tenant, v_cust, p_cadence::sub_cadence, 'active', p_stripe_subscription_id, v_key)
  returning id into v_sub;

  insert into subscription_lines (tenant_id, subscription_id, sku_id, qty_units)
  values (v_tenant, v_sub, p_sku_id, p_qty_units);

  insert into sub_events (tenant_id, subscription_id, kind, payload, idempotency_key)
  values (v_tenant, v_sub, 'created',
          jsonb_build_object('sku_id', p_sku_id, 'cadence', p_cadence, 'qty_units', p_qty_units),
          v_key || ':created');

  return v_sub;
end $$;
revoke execute on function create_subscription(text, text, bigint, text, integer, text, text) from public;
grant   execute on function create_subscription(text, text, bigint, text, integer, text, text) to authenticated;

-- 10f. _transition_subscription — internal helper for the simple status transitions.
--      Idempotent on the sub_event key. Not granted to any caller.
create or replace function _transition_subscription(
  p_subscription_id bigint,
  p_new_status      sub_status,
  p_kind            text,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  if exists (select 1 from sub_events where tenant_id = v_tenant and idempotency_key = v_key || ':' || p_kind) then
    return p_subscription_id;                  -- idempotent replay
  end if;
  if not exists (select 1 from subscriptions where id = p_subscription_id and tenant_id = v_tenant) then
    raise exception 'unknown subscription %', p_subscription_id using errcode = 'foreign_key_violation';
  end if;

  if p_new_status is not null then
    update subscriptions set status = p_new_status
     where id = p_subscription_id and tenant_id = v_tenant;
  end if;

  insert into sub_events (tenant_id, subscription_id, kind, idempotency_key)
  values (v_tenant, p_subscription_id, p_kind, v_key || ':' || p_kind);

  return p_subscription_id;
end $$;
revoke execute on function _transition_subscription(bigint, sub_status, text, text) from public;

create or replace function pause_subscription(p_subscription_id bigint, p_idempotency_key text)
  returns bigint language sql security definer set search_path = public, extensions as $$
  select _transition_subscription(p_subscription_id, 'paused'::sub_status, 'paused', p_idempotency_key);
$$;
revoke execute on function pause_subscription(bigint, text) from public;
grant   execute on function pause_subscription(bigint, text) to authenticated;

create or replace function resume_subscription(p_subscription_id bigint, p_idempotency_key text)
  returns bigint language sql security definer set search_path = public, extensions as $$
  select _transition_subscription(p_subscription_id, 'active'::sub_status, 'resumed', p_idempotency_key);
$$;
revoke execute on function resume_subscription(bigint, text) from public;
grant   execute on function resume_subscription(bigint, text) to authenticated;

create or replace function cancel_subscription(p_subscription_id bigint, p_idempotency_key text)
  returns bigint language sql security definer set search_path = public, extensions as $$
  select _transition_subscription(p_subscription_id, 'cancelled'::sub_status, 'cancelled', p_idempotency_key);
$$;
revoke execute on function cancel_subscription(bigint, text) from public;
grant   execute on function cancel_subscription(bigint, text) to authenticated;

-- 10g. skip_subscription_cycle — append a 'skipped' sub_event for a cycle; NO status
--      change. Idempotent on the (sub_event key + cycle).
create or replace function skip_subscription_cycle(
  p_subscription_id bigint,
  p_cycle_label     text,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;
  if exists (select 1 from sub_events where tenant_id = v_tenant and idempotency_key = v_key) then
    return p_subscription_id;
  end if;
  if not exists (select 1 from subscriptions where id = p_subscription_id and tenant_id = v_tenant) then
    raise exception 'unknown subscription %', p_subscription_id using errcode = 'foreign_key_violation';
  end if;
  insert into sub_events (tenant_id, subscription_id, kind, payload, idempotency_key)
  values (v_tenant, p_subscription_id, 'skipped', jsonb_build_object('cycle', p_cycle_label), v_key);
  return p_subscription_id;
end $$;
revoke execute on function skip_subscription_cycle(bigint, text, text) from public;
grant   execute on function skip_subscription_cycle(bigint, text, text) to authenticated;

-- 10h. swap_subscription_sku — repoint a subscription_line to a new SKU; append
--      'swapped'. Idempotent on the sub_event key.
create or replace function swap_subscription_sku(
  p_subscription_id bigint,
  p_line_id         bigint,
  p_new_sku_id      bigint,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_old    bigint;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;
  if exists (select 1 from sub_events where tenant_id = v_tenant and idempotency_key = v_key) then
    return p_subscription_id;
  end if;

  select sku_id into v_old from subscription_lines
   where id = p_line_id and subscription_id = p_subscription_id and tenant_id = v_tenant;
  if v_old is null then
    raise exception 'unknown subscription_line %', p_line_id using errcode = 'foreign_key_violation';
  end if;
  if not exists (select 1 from product_skus where id = p_new_sku_id and tenant_id = v_tenant) then
    raise exception 'unknown sku %', p_new_sku_id using errcode = 'foreign_key_violation';
  end if;

  update subscription_lines set sku_id = p_new_sku_id
   where id = p_line_id and tenant_id = v_tenant;

  insert into sub_events (tenant_id, subscription_id, kind, payload, idempotency_key)
  values (v_tenant, p_subscription_id, 'swapped',
          jsonb_build_object('line_id', p_line_id, 'old_sku', v_old, 'new_sku', p_new_sku_id), v_key);

  return p_subscription_id;
end $$;
revoke execute on function swap_subscription_sku(bigint, bigint, bigint, text) from public;
grant   execute on function swap_subscription_sku(bigint, bigint, bigint, text) to authenticated;

-- 10i. allocate_subscription_cycle — THE money-guarantee touch point. Inserts a
--      lot_reservations row so the EXISTING prevent_oversell trigger fires (a scarce
--      micro-lot can't be promised to more subscribers than kg exist), then records the
--      sub_allocations link + an 'allocated' sub_event. An oversell rolls the whole txn
--      back. Idempotent on the client key (no second reservation on replay).
create or replace function allocate_subscription_cycle(
  p_subscription_id bigint,
  p_green_lot_code  text,
  p_kg              numeric,
  p_cycle_label     text,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_alloc  bigint;
  v_res    bigint;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select id into v_alloc from sub_allocations where tenant_id = v_tenant and idempotency_key = v_key;
  if v_alloc is not null then return v_alloc; end if;       -- idempotent

  if not exists (select 1 from subscriptions where id = p_subscription_id and tenant_id = v_tenant) then
    raise exception 'unknown subscription %', p_subscription_id using errcode = 'foreign_key_violation';
  end if;
  if coalesce(p_kg, 0) <= 0 then
    raise exception 'allocation kg must be greater than zero' using errcode = 'check_violation';
  end if;

  -- THE money guarantee, REUSED VERBATIM: inserting the reservation fires the EXISTING
  -- prevent_oversell trigger (Σreservations + Σshipments ≤ current_kg, per-tenant per-lot
  -- advisory lock). No parallel counter; an oversell raises and rolls back this txn.
  insert into lot_reservations (tenant_id, green_lot_code, buyer, kg)
  values (v_tenant, p_green_lot_code, 'Reserve Club sub#' || p_subscription_id, p_kg)
  returning id into v_res;

  insert into sub_allocations (tenant_id, subscription_id, green_lot_code, kg, reservation_id,
                              cycle_label, idempotency_key)
  values (v_tenant, p_subscription_id, p_green_lot_code, p_kg, v_res, p_cycle_label, v_key)
  returning id into v_alloc;

  insert into sub_events (tenant_id, subscription_id, kind, payload, idempotency_key)
  values (v_tenant, p_subscription_id, 'allocated',
          jsonb_build_object('green_lot_code', p_green_lot_code, 'kg', p_kg,
                             'cycle', p_cycle_label, 'reservation_id', v_res),
          v_key || ':alloc');

  perform record_lot_event(
    p_green_lot_code, 'subscription_allocated',
    jsonb_build_object('subscription_id', p_subscription_id, 'kg', p_kg, 'cycle', p_cycle_label,
                       'reservation_id', v_res),
    now(), 'server', nextval('lot_code_seq'), v_key || ':alloc');

  return v_alloc;
end $$;
revoke execute on function allocate_subscription_cycle(bigint, text, numeric, text, text) from public;
grant   execute on function allocate_subscription_cycle(bigint, text, numeric, text, text) to authenticated;

-- 10j. record_dunning_event — append a 'dunning' sub_event; a 'final' stage marks the
--      subscription past_due. Idempotent on the client key.
create or replace function record_dunning_event(
  p_subscription_id bigint,
  p_stage           text,
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

  select id into v_id from sub_events where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then return v_id; end if;            -- idempotent

  if not exists (select 1 from subscriptions where id = p_subscription_id and tenant_id = v_tenant) then
    raise exception 'unknown subscription %', p_subscription_id using errcode = 'foreign_key_violation';
  end if;

  insert into sub_events (tenant_id, subscription_id, kind, payload, idempotency_key)
  values (v_tenant, p_subscription_id, 'dunning', jsonb_build_object('stage', p_stage), v_key)
  returning id into v_id;

  if p_stage = 'final' then
    update subscriptions set status = 'past_due'
     where id = p_subscription_id and tenant_id = v_tenant and status <> 'cancelled';
  end if;

  return v_id;
end $$;
revoke execute on function record_dunning_event(bigint, text, text) from public;
grant   execute on function record_dunning_event(bigint, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 11. Read views (security_invoker — inherit caller RLS). The admin /orders +
--     /subscriptions surfaces read these; COGS-per-order joins mv_lot_cost_secure
--     (cost_per_kg_green is NULL when cost is unknown — flagged, NEVER fabricated).
-- ════════════════════════════════════════════════════════════════════════════
create view v_order_book with (security_invoker = on) as
select
  o.id,
  o.tenant_id,
  o.channel,
  o.status,
  o.currency,
  o.subtotal_cents,
  o.dgi_tax_cents,
  o.total_cents,
  o.stripe_payment_intent,
  o.dgi_cufe,
  o.idempotency_key,
  o.created_at,
  c.email as customer_email,
  c.name  as customer_name,
  (select count(*) from order_lines ol where ol.order_id = o.id) as line_count
from orders o
join customers c on c.id = o.customer_id and c.tenant_id = o.tenant_id;

create view v_order_cogs with (security_invoker = on) as
select
  ol.tenant_id,
  ol.order_id,
  ol.sku_id,
  ol.green_lot_code,
  ol.qty_units,
  ol.line_total_cents,
  mlc.cost_per_kg_green                 -- NULL ⇒ COGS unknown (flagged, not fabricated)
from order_lines ol
left join mv_lot_cost_secure mlc
  on mlc.green_lot_code = ol.green_lot_code;

create view v_subscription_board with (security_invoker = on) as
select
  s.id,
  s.tenant_id,
  s.cadence,
  s.status,
  s.stripe_subscription_id,
  s.started_at,
  c.email as customer_email,
  c.name  as customer_name,
  coalesce((select sum(a.kg) from sub_allocations a where a.subscription_id = s.id), 0) as allocated_kg,
  (select count(*) from sub_events e where e.subscription_id = s.id and e.kind = 'dunning') as dunning_count
from subscriptions s
join customers c on c.id = s.customer_id and c.tenant_id = s.tenant_id;

-- ════════════════════════════════════════════════════════════════════════════
-- 12. RLS — tenant-scoped read on every new table. ALL writes flow through the SECDEF
--     RPCs (they bypass RLS + self-clamp), so NO insert/update/delete policy.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array[
    'customers','orders','order_lines','webhook_events',
    'subscriptions','subscription_lines','sub_allocations','sub_events'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'create policy "tenant read" on public.%I for select to authenticated
         using (tenant_id = current_tenant_id());', t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 13. GRANTS (AD-8) — per-object SELECT to authenticated (one statement each so the
--     name-anchored static guard matches). anon gets NOTHING. Trigger/internal fns are
--     never granted. RPC execute was revoked-then-granted at each definition above.
-- ════════════════════════════════════════════════════════════════════════════
grant select on customers           to authenticated;
grant select on orders              to authenticated;
grant select on order_lines         to authenticated;
grant select on webhook_events      to authenticated;
grant select on subscriptions       to authenticated;
grant select on subscription_lines  to authenticated;
grant select on sub_allocations     to authenticated;
grant select on sub_events          to authenticated;
grant select on v_order_book        to authenticated;
grant select on v_order_cogs        to authenticated;
grant select on v_subscription_board to authenticated;

revoke execute on function _sub_allocations_immutable() from public;
revoke execute on function _sub_events_immutable()      from public;
revoke execute on function _webhook_events_immutable()  from public;

commit;
