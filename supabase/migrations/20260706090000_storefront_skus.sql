-- ════════════════════════════════════════════════════════════════════════════
-- P3-S11 · Catalog + lot-linked SKUs + finished-goods inventory (consumer trunk).
-- ════════════════════════════════════════════════════════════════════════════
-- Spec: docs/design/PHASE3-DESIGN.md lines 307-311 (+ §1 cross-slice rails + §0.2
--       inherited facts). The first DTC slice: a `products` master, a `product_skus`
--       table whose load-bearing `green_lot_code` FK makes every retail bag traceable
--       back to the green lot (and its full lot_edges ancestry), and an append-only
--       `fg_ledger` whose trigger rolls signed movements into a `finished_goods`
--       aggregate — `available = on_hand − allocated`, mirroring `green_lots_atp`.
-- Deps: P3-S10 roast SKUs (roast_skus, 20260705094000), Phase-1 green inventory
--       (green_lots / lots / materialize_green_lot / record_lot_event / lot_code_seq),
--       the P4-S0 tenant seam (current_tenant_id / RLS).
-- Live max at authoring: 20260705094000_roasting.sql — this timestamp (20260706090000)
--       is strictly greater; single schema author for the serial lane.
--
-- WHAT THIS SLICE OWNS:
--   * products — roasted-SKU master (slug, variety, process, tasting_notes, is_active).
--   * product_skus — the lot-linked sellable unit. The composite FK
--       (tenant_id, green_lot_code) -> green_lots(tenant_id, lot_code) is the keystone
--       traceability link; roast_sku_id -> roast_skus(id) is the P3-S10 roast→product
--       closer. A SKU can NEVER claim a green lot it isn't backed by (the FK + the
--       create_sku validation both enforce it — invariant 5).
--   * finished_goods — the per-SKU retail inventory aggregate fed by the ledger:
--       available_units = on_hand_units − allocated_units (GENERATED). allocated_units
--       is the seam P3-S12 Reserve-Club allocations decrement against. A data-layer
--       CHECK (available >= 0) plus the trigger's explicit guard make a finished-goods
--       oversell impossible — FAIL-CLOSED exactly like prevent_oversell (invariant 2).
--   * fg_ledger — the append-only movement source of truth (roast-in / sale /
--       subscription-fulfill / adjust / return). Immutable (no UPDATE/DELETE).
--   * create_product / create_sku / record_fg_movement — the ONLY write doors
--       (SECURITY DEFINER, tenant-clamped, idempotent, lot-event-appending in the
--       same txn). NO client INSERT/UPDATE/DELETE grant on any table.
--   * finished_goods_atp — the security_invoker read view the /shop UI reads.
--
-- §1 RAILS HONORED: one write door (SECDEF RPCs); AD-8 grants exactly (per-object
--   select to authenticated; revoke-from-public-then-grant on every RPC; anon gets
--   NOTHING); hash-chained audit via record_lot_event keyed on the green lot code;
--   the money guarantee is REUSED, never rebuilt (finished_goods is the spec's own
--   ledger-fed aggregate; the green-lot oversell seam — lot_reservations/lot_shipments
--   /prevent_oversell — is untouched); tenant_id + current_tenant_id() + RLS on every
--   new table.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Enums — pack format + bag size (the retail SKU dimensions).
-- ════════════════════════════════════════════════════════════════════════════
create type pack_format as enum ('whole-bean', 'ground');
create type bag_size    as enum ('250g', '340g', '454g', '1kg', '12oz');

-- ════════════════════════════════════════════════════════════════════════════
-- 2. products — the roasted-SKU master. INHERITED tenant idiom.
-- ════════════════════════════════════════════════════════════════════════════
create table products (
  id            bigint generated always as identity primary key,
  tenant_id     uuid    not null references tenants(id) default current_tenant_id(),
  slug          text    not null,
  name          text    not null,
  variety       text,
  process       text,
  tasting_notes text,
  is_active     boolean not null default true,
  idempotency_key text,
  created_at    timestamptz not null default now(),
  constraint products_tenant_idem_ux unique (tenant_id, idempotency_key),
  constraint products_tenant_slug_ux unique (tenant_id, slug)
);
create index products_tenant_idx on products (tenant_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. product_skus — the lot-linked sellable unit. The composite FK to green_lots is
--    the load-bearing traceability link (every bag → its green lot's lot_edges chain).
-- ════════════════════════════════════════════════════════════════════════════
create table product_skus (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  product_id      bigint  not null references products(id),
  green_lot_code  text    not null,                       -- the keystone traceability link
  roast_sku_id    bigint  references roast_skus(id),       -- P3-S10 roast→product closer
  pack_format     pack_format not null,
  bag_size        bag_size    not null,
  price_usd_cents integer not null check (price_usd_cents >= 0),
  stripe_price_id text,                                    -- P3-S12 Stripe seam ($0 until sale)
  gtin            text,                                    -- GS1 bag-label identity
  is_reserve_club boolean not null default false,
  is_active       boolean not null default true,
  idempotency_key text,
  created_at      timestamptz not null default now(),
  constraint product_skus_tenant_idem_ux unique (tenant_id, idempotency_key),
  -- INVARIANT 5: a SKU cannot claim a green lot it isn't backed by.
  constraint product_skus_green_lot_tfk
    foreign key (tenant_id, green_lot_code) references green_lots(tenant_id, lot_code)
);
create index product_skus_tenant_idx  on product_skus (tenant_id);
create index product_skus_green_idx   on product_skus (green_lot_code);
create index product_skus_product_idx on product_skus (product_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 4. finished_goods — the per-SKU retail inventory aggregate. available is GENERATED
--    (on_hand − allocated, mirroring green_lots_atp). A data-layer CHECK makes a
--    finished-goods oversell impossible (FAIL-CLOSED). One row per SKU, minted by
--    create_sku; only the fg_ledger trigger mutates on_hand_units. No client write.
-- ════════════════════════════════════════════════════════════════════════════
create table finished_goods (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  sku_id          bigint  not null references product_skus(id),
  on_hand_units   integer not null default 0,
  allocated_units integer not null default 0 check (allocated_units >= 0),
  available_units integer generated always as (on_hand_units - allocated_units) stored,
  updated_at      timestamptz not null default now(),
  constraint finished_goods_sku_ux unique (tenant_id, sku_id),
  -- The keystone fail-closed invariant: available can never go negative.
  constraint finished_goods_available_nonneg check (on_hand_units - allocated_units >= 0)
);
create index finished_goods_tenant_idx on finished_goods (tenant_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 5. fg_ledger — the append-only movement source of truth. Immutable.
-- ════════════════════════════════════════════════════════════════════════════
create table fg_ledger (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  sku_id          bigint  not null references product_skus(id),
  qty_units       integer not null check (qty_units <> 0),   -- signed on_hand delta
  reason          text    not null
    check (reason in ('roast-in', 'sale', 'subscription-fulfill', 'adjust', 'return')),
  idempotency_key text,
  created_at      timestamptz not null default now(),
  constraint fg_ledger_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index fg_ledger_tenant_idx on fg_ledger (tenant_id);
create index fg_ledger_sku_idx    on fg_ledger (sku_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 6. fg_ledger triggers — (a) apply the signed movement into finished_goods, fail-
--    closed on negative available; (b) append-only immutability.
-- ════════════════════════════════════════════════════════════════════════════
-- 6a. _fg_ledger_apply — AFTER INSERT: serialize per SKU (advisory lock, like
--     prevent_oversell), roll the signed qty into on_hand. The finished_goods CHECK
--     is the data-layer backstop; this raise gives a clean fail-closed message first.
create or replace function _fg_ledger_apply() returns trigger
  language plpgsql set search_path = public
as $$
declare
  v_on_hand   integer;
  v_allocated integer;
begin
  -- Per-SKU serialization so two concurrent sales against one SKU can't both pass a
  -- stale available read (the prevent_oversell pattern, reused for finished goods).
  perform pg_advisory_xact_lock(hashtext('finished_goods:' || new.tenant_id::text || ':' || new.sku_id::text));

  select on_hand_units, allocated_units into v_on_hand, v_allocated
    from finished_goods
   where tenant_id = new.tenant_id and sku_id = new.sku_id
   for update;
  if not found then
    raise exception 'fg_ledger: no finished_goods row for sku % (create the SKU first)', new.sku_id
      using errcode = 'foreign_key_violation';
  end if;

  if (v_on_hand + new.qty_units) - v_allocated < 0 then
    raise exception
      'finished-goods oversell guard: applying % units to sku % would drive available below zero (on_hand %, allocated %)',
      new.qty_units, new.sku_id, v_on_hand, v_allocated
      using errcode = 'check_violation';
  end if;

  update finished_goods
     set on_hand_units = on_hand_units + new.qty_units,
         updated_at    = now()
   where tenant_id = new.tenant_id and sku_id = new.sku_id;

  return new;
end $$;
create trigger fg_ledger_apply after insert on fg_ledger
  for each row execute function _fg_ledger_apply();

-- 6b. _fg_ledger_immutable — append-only: post a reversing movement, never mutate.
create or replace function _fg_ledger_immutable() returns trigger
  language plpgsql set search_path = public
as $$
begin
  raise exception
    'fg_ledger is append-only: % is not permitted — post a reversing movement instead', tg_op
    using errcode = 'restrict_violation';
end $$;
create trigger fg_ledger_no_update before update on fg_ledger
  for each row execute function _fg_ledger_immutable();
create trigger fg_ledger_no_delete before delete on fg_ledger
  for each row execute function _fg_ledger_immutable();

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Command RPCs (SECURITY DEFINER, tenant-clamped, idempotent). The ONLY write door.
-- ════════════════════════════════════════════════════════════════════════════

-- 7a. create_product — mint a roasted-SKU master. Idempotent on the client key.
create or replace function create_product(
  p_slug          text,
  p_name          text,
  p_variety       text,
  p_process       text,
  p_tasting_notes text,
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

  select id into v_id from products where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then return v_id; end if;

  insert into products (tenant_id, slug, name, variety, process, tasting_notes, idempotency_key)
  values (v_tenant, p_slug, p_name, p_variety, p_process, p_tasting_notes, v_key)
  returning id into v_id;

  return v_id;
end $$;
revoke execute on function create_product(text, text, text, text, text, text) from public;
grant   execute on function create_product(text, text, text, text, text, text) to authenticated;

-- 7b. create_sku — mint a lot-linked SKU. VALIDATES the green lot exists in the tenant
--     (invariant 5: a SKU can't claim a lot it isn't backed by), materializes the
--     finished_goods row at on_hand 0, appends a 'sku_created' lot_event on the green
--     lot's chain (so verify_chain covers the bag's commercial birth).
create or replace function create_sku(
  p_product_id      bigint,
  p_green_lot_code  text,
  p_roast_sku_id    bigint,
  p_pack_format     text,
  p_bag_size        text,
  p_price_usd_cents integer,
  p_gtin            text,
  p_stripe_price_id text,
  p_is_reserve_club boolean,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_id     bigint;
  v_exists boolean;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select id into v_id from product_skus where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then return v_id; end if;

  -- INVARIANT 5: the green lot must exist for THIS tenant (the FK enforces it too, but
  -- a clean raise beats a raw constraint error for the picker UI).
  select exists(
    select 1 from green_lots where tenant_id = v_tenant and lot_code = p_green_lot_code
  ) into v_exists;
  if not v_exists then
    raise exception 'SKU lot-backing guard: green lot % does not exist — a SKU cannot claim a lot it is not backed by', p_green_lot_code
      using errcode = 'foreign_key_violation';
  end if;

  -- The product must belong to the tenant.
  if not exists (select 1 from products where id = p_product_id and tenant_id = v_tenant) then
    raise exception 'unknown product %', p_product_id using errcode = 'foreign_key_violation';
  end if;

  -- An optional roast-SKU link must belong to the tenant.
  if p_roast_sku_id is not null
     and not exists (select 1 from roast_skus where id = p_roast_sku_id and tenant_id = v_tenant) then
    raise exception 'unknown roast_sku %', p_roast_sku_id using errcode = 'foreign_key_violation';
  end if;

  insert into product_skus
    (tenant_id, product_id, green_lot_code, roast_sku_id, pack_format, bag_size,
     price_usd_cents, gtin, stripe_price_id, is_reserve_club, idempotency_key)
  values
    (v_tenant, p_product_id, p_green_lot_code, p_roast_sku_id,
     p_pack_format::pack_format, p_bag_size::bag_size,
     p_price_usd_cents, p_gtin, p_stripe_price_id, coalesce(p_is_reserve_club, false), v_key)
  returning id into v_id;

  -- Materialize the finished-goods inventory row (on_hand 0, allocated 0).
  insert into finished_goods (tenant_id, sku_id) values (v_tenant, v_id);

  perform record_lot_event(
    p_green_lot_code, 'sku_created',
    jsonb_build_object('sku_id', v_id, 'product_id', p_product_id, 'roast_sku_id', p_roast_sku_id,
                       'pack_format', p_pack_format, 'bag_size', p_bag_size,
                       'price_usd_cents', p_price_usd_cents, 'is_reserve_club', coalesce(p_is_reserve_club, false)),
    now(), 'server', nextval('lot_code_seq'), v_key || ':sku');

  return v_id;
end $$;
revoke execute on function create_sku(bigint, text, bigint, text, text, integer, text, text, boolean, text) from public;
grant   execute on function create_sku(bigint, text, bigint, text, text, integer, text, text, boolean, text) to authenticated;

-- 7c. record_fg_movement — append a finished-goods movement. The trigger rolls the
--     signed qty into finished_goods and FAILS CLOSED if available would go negative.
--     Idempotent; appends an 'fg_movement' lot_event on the SKU's green lot chain.
create or replace function record_fg_movement(
  p_sku_id          bigint,
  p_qty_units       integer,
  p_reason          text,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_id     bigint;
  v_green  text;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select id into v_id from fg_ledger where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then return v_id; end if;       -- idempotent

  select green_lot_code into v_green
    from product_skus where id = p_sku_id and tenant_id = v_tenant;
  if v_green is null then
    raise exception 'unknown sku %', p_sku_id using errcode = 'foreign_key_violation';
  end if;

  -- The append fires _fg_ledger_apply (advisory lock + available>=0 fail-closed guard).
  insert into fg_ledger (tenant_id, sku_id, qty_units, reason, idempotency_key)
  values (v_tenant, p_sku_id, p_qty_units, p_reason, v_key)
  returning id into v_id;

  perform record_lot_event(
    v_green, 'fg_movement',
    jsonb_build_object('ledger_id', v_id, 'sku_id', p_sku_id, 'qty_units', p_qty_units, 'reason', p_reason),
    now(), 'server', nextval('lot_code_seq'), v_key || ':fg');

  return v_id;
end $$;
revoke execute on function record_fg_movement(bigint, integer, text, text) from public;
grant   execute on function record_fg_movement(bigint, integer, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. Read view — finished_goods_atp (security_invoker; inherits caller RLS).
-- ════════════════════════════════════════════════════════════════════════════
create view finished_goods_atp with (security_invoker = on) as
select
  fg.tenant_id,
  fg.sku_id,
  ps.product_id,
  ps.green_lot_code,
  ps.roast_sku_id,
  ps.pack_format,
  ps.bag_size,
  ps.price_usd_cents,
  ps.is_reserve_club,
  ps.is_active,
  p.slug                 as product_slug,
  p.name                 as product_name,
  fg.on_hand_units,
  fg.allocated_units,
  fg.available_units
from finished_goods fg
join product_skus ps on ps.id = fg.sku_id  and ps.tenant_id = fg.tenant_id
join products     p  on p.id  = ps.product_id and p.tenant_id = fg.tenant_id;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. RLS — tenant-scoped read on every new table. All writes flow through the SECDEF
--    RPCs (they bypass RLS + self-clamp the tenant), so NO insert/update/delete policy.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['products', 'product_skus', 'finished_goods', 'fg_ledger']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'create policy "tenant read" on public.%I for select to authenticated
         using (tenant_id = current_tenant_id());', t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 10. GRANTS (AD-8) — per-object SELECT to authenticated on every table/view (one
--     statement each so the name-anchored static guard matches). anon gets NOTHING.
--     Trigger fns are never granted execute. RPC execute revoked-then-granted above.
-- ════════════════════════════════════════════════════════════════════════════
grant select on products          to authenticated;
grant select on product_skus      to authenticated;
grant select on finished_goods    to authenticated;
grant select on fg_ledger         to authenticated;
grant select on finished_goods_atp to authenticated;

revoke execute on function _fg_ledger_apply()     from public;
revoke execute on function _fg_ledger_immutable() from public;

commit;
