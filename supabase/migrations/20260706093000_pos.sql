-- ════════════════════════════════════════════════════════════════════════════
-- P3-S14 · Offline DGI farm-store/café POS (the $0 non-fiscal path).
-- ════════════════════════════════════════════════════════════════════════════
-- Spec: docs/design/PHASE3-DESIGN.md lines 345-354 (+ §1 cross-slice rails + §0.2
--       inherited facts). The offline café/farm-store POS for the Janson Farm Store
--       and Lagunas Café. A POS SALE *IS* AN ORDER with channel='pos' — so this slice
--       does NOT re-implement totals, tax, allocation, or the oversell guard: it
--       DELEGATES to the shipped P3-S12 create_order (server-computed subtotal / ITBMS
--       7% / total + the S11 fail-closed finished_goods decrement) and layers the POS
--       concerns on top: a terminal, a human POS-NNNN folio, the offline
--       (device_id, device_seq) exactly-once coordinates, and a (later) DGI fiscal
--       stamp seam ($0 path: an internal non-fiscal recibo; the real PAC CUFE call is
--       the P3-S16/S17 paid integration behind a feature flag).
-- Deps: P3-S11 (products / product_skus / finished_goods / record_fg_movement),
--       P3-S12 (orders / order_channel='pos' / create_order), Phase-1 green inventory
--       + record_lot_event + lot_code_seq, the P4-S0 tenant seam (current_tenant_id / RLS).
-- Live max at authoring: 20260706092000_provenance_microsite.sql — this timestamp
--       (20260706093000) is strictly greater; single schema author for the serial lane.
--
-- WHAT THIS SLICE OWNS:
--   * pos_terminals — the registered POS terminals (Janson Farm Store / Lagunas Café).
--   * pos_sales — one row per POS sale, 1:1 with its channel='pos' order. The offline
--       exactly-once coordinate is UNIQUE (tenant_id, device_id, device_seq) — the
--       lot_event D4 replay-safety pattern lifted directly — AND the client
--       idempotency_key is UNIQUE (tenant_id, idempotency_key). A double-sync can never
--       double-charge/double-decrement: the key returns the existing folio; a regenerated
--       key on the same device coordinate fails closed (the whole txn rolls back).
--   * register_pos_terminal / record_pos_sale — the write doors (browser, authenticated).
--   * stamp_pos_dgi_cufe — the later fiscal-stamp seam (service_role only; the paid PAC
--       round-trip lives behind the P3-S16/S17 feature flag, never contacted here).
--   * v_pos_sales_book — the security_invoker read view the /pos history surface reads.
--
-- RAILS HONORED: one write door (SECDEF RPCs, set search_path = public, extensions,
--   idempotent on the tenant-qualified key, append a lot_event in the SAME txn); the
--   money guarantee is REUSED, never rebuilt (record_pos_sale → create_order →
--   record_fg_movement, the S11 fail-closed finished_goods guard — no parallel counter);
--   AD-8/AD-9 grants exactly (per-object select to authenticated; anon NOTHING; revoke
--   execute from public THEN grant to authenticated/service_role on every RPC); server
--   computes the totals (the client supplies no total); tenant_id + current_tenant_id()
--   + RLS on every new table. No untrusted inbound drives a write — a barista (a human)
--   rings the sale; the fiscal stamp (money-shaped) is a separate service_role door.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. pos_terminals — the registered tills. INHERITED tenant idiom.
-- ════════════════════════════════════════════════════════════════════════════
create table pos_terminals (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  code            text    not null,                       -- 'FARM-STORE' / 'CAFE'
  name            text    not null,                       -- 'Janson Farm Store' / 'Lagunas Café'
  location        text,
  is_active       boolean not null default true,
  idempotency_key text,
  created_at      timestamptz not null default now(),
  constraint pos_terminals_tenant_idem_ux unique (tenant_id, idempotency_key),
  constraint pos_terminals_tenant_code_ux unique (tenant_id, code)
);
create index pos_terminals_tenant_idx on pos_terminals (tenant_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. pos_sales — one row per POS sale, 1:1 with its channel='pos' order.
--    The (device_id, device_seq) UNIQUE is the offline exactly-once backstop; the
--    idempotency_key UNIQUE is the primary exactly-once key. dgi_cufe is the fiscal
--    folio, NULL until a (later) PAC stamp ($0 path keeps it NULL / non-fiscal recibo).
-- ════════════════════════════════════════════════════════════════════════════
create table pos_sales (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  order_id        bigint  not null references orders(id),
  terminal_id     bigint  not null references pos_terminals(id),
  sale_no         text    not null,                       -- human folio 'POS-0001'
  device_id       text    not null,                       -- offline device coordinate
  device_seq      bigint  not null,                       -- offline monotonic per device
  cashier         text,
  dgi_cufe        text,                                   -- fiscal folio (NULL ⇒ pending stamp)
  idempotency_key text,
  created_at      timestamptz not null default now(),
  constraint pos_sales_tenant_idem_ux  unique (tenant_id, idempotency_key),
  constraint pos_sales_device_seq_ux   unique (tenant_id, device_id, device_seq),
  constraint pos_sales_order_ux        unique (order_id)
);
create index pos_sales_tenant_idx   on pos_sales (tenant_id);
create index pos_sales_terminal_idx on pos_sales (terminal_id);
create index pos_sales_order_idx    on pos_sales (order_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. register_pos_terminal — the terminal write door. Idempotent on the client key
--    (and a no-op re-register on an existing code returns the existing terminal id).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function register_pos_terminal(
  p_code            text,
  p_name            text,
  p_location        text,
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

  select id into v_id from pos_terminals where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then return v_id; end if;            -- idempotent

  -- A terminal with this code may already exist (re-register from a fresh device): no-op.
  select id into v_id from pos_terminals where tenant_id = v_tenant and code = p_code;
  if v_id is not null then return v_id; end if;

  insert into pos_terminals (tenant_id, code, name, location, idempotency_key)
  values (v_tenant, p_code, p_name, p_location, v_key)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function register_pos_terminal(text, text, text, text) from public;
grant   execute on function register_pos_terminal(text, text, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. record_pos_sale — the POS write door. EXACTLY-ONCE on the client key (a replay
--    returns the existing POS-NNNN folio, like record_cherry_intake). It DELEGATES to
--    the shipped create_order (channel='pos') for server-computed totals + the S11
--    fail-closed finished_goods allocation (the money guarantee REUSED, never rebuilt),
--    then mints a per-tenant POS-NNNN folio and writes the pos_sales row carrying the
--    offline (device_id, device_seq) coordinate. A regenerated key on the SAME device
--    coordinate hits the (tenant, device_id, device_seq) UNIQUE and fails the whole txn
--    closed (no second charge, no second decrement). Returns the sale_no.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function record_pos_sale(
  p_terminal_code   text,
  p_customer_email  text,
  p_customer_name   text,
  p_device_id       text,
  p_device_seq      bigint,
  p_lines           jsonb,
  p_currency        text,
  p_idempotency_key text
) returns text
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant   uuid := current_tenant_id();
  v_key      text;
  v_existing text;
  v_terminal bigint;
  v_order    bigint;
  v_n        bigint;
  v_no       text;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  -- EXACTLY-ONCE (primary): a replay of the same client key returns the existing folio.
  select sale_no into v_existing from pos_sales where tenant_id = v_tenant and idempotency_key = v_key;
  if v_existing is not null then return v_existing; end if;

  select id into v_terminal from pos_terminals
    where tenant_id = v_tenant and code = p_terminal_code and is_active;
  if v_terminal is null then
    raise exception 'unknown or inactive POS terminal %', p_terminal_code using errcode = 'foreign_key_violation';
  end if;

  -- DELEGATE: server-computed totals + ITBMS + the S11 fail-closed finished_goods
  -- allocation. create_order is itself idempotent on the SAME raw key it prefixes, so a
  -- replay here would have short-circuited above; a fresh sale creates a fresh order.
  v_order := create_order(
    coalesce(p_customer_email, 'walkin@pos.local'),
    coalesce(p_customer_name, 'Walk-in'),
    'pos', p_currency, p_lines, p_idempotency_key);

  -- Per-tenant monotonic folio (advisory-locked, like the export-doc number minter).
  perform pg_advisory_xact_lock(hashtext('pos_sale_no:' || v_tenant::text));
  select coalesce(max((regexp_replace(sale_no, '\D', '', 'g'))::bigint), 0) + 1
    into v_n
    from pos_sales
   where tenant_id = v_tenant and sale_no ~ '^POS-[0-9]+$';
  v_no := 'POS-' || lpad(v_n::text, 4, '0');

  -- The offline backstop: the (tenant, device_id, device_seq) UNIQUE fails closed on a
  -- key-regenerated re-sync, rolling back the whole txn (incl. the delegate's decrement).
  insert into pos_sales (tenant_id, order_id, terminal_id, sale_no, device_id, device_seq,
                         cashier, idempotency_key)
  values (v_tenant, v_order, v_terminal, v_no, p_device_id, p_device_seq, p_customer_name, v_key);

  -- Append-only, hash-chained audit of the commercial decision (rail 3), same txn.
  perform record_lot_event(
    'activity', 'pos_sale',
    jsonb_build_object('sale_no', v_no, 'order_id', v_order, 'terminal', p_terminal_code,
                       'device_id', p_device_id, 'device_seq', p_device_seq),
    now(), 'server', nextval('lot_code_seq'), v_key || ':pos');

  return v_no;
end $$;
revoke execute on function record_pos_sale(text, text, text, text, bigint, jsonb, text, text) from public;
grant   execute on function record_pos_sale(text, text, text, text, bigint, jsonb, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. stamp_pos_dgi_cufe — the later fiscal-stamp seam. service_role ONLY (called from
--    the P3-S16/S17 PAC edge function behind a feature flag, NEVER a browser). $0 path:
--    the caller supplies an internal non-fiscal recibo folio; no PAC is contacted here.
--    Idempotent: a re-stamp on an already-stamped sale is a no-op (the first folio wins).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function stamp_pos_dgi_cufe(
  p_sale_id         bigint,
  p_cufe            text,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare v_existing text;
begin
  select dgi_cufe into v_existing from pos_sales where id = p_sale_id;
  if not found then
    raise exception 'unknown POS sale %', p_sale_id using errcode = 'foreign_key_violation';
  end if;
  if v_existing is not null then
    return p_sale_id;                  -- already stamped — idempotent.
  end if;
  update pos_sales set dgi_cufe = p_cufe where id = p_sale_id;
  return p_sale_id;
end $$;
revoke execute on function stamp_pos_dgi_cufe(bigint, text, text) from public;
grant   execute on function stamp_pos_dgi_cufe(bigint, text, text) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. v_pos_sales_book — the /pos history read view (security_invoker; inherits caller
--    RLS). The admin/POS surface reads this for the day's sales + their folios.
-- ════════════════════════════════════════════════════════════════════════════
create view v_pos_sales_book with (security_invoker = on) as
select
  ps.id,
  ps.tenant_id,
  ps.sale_no,
  ps.device_id,
  ps.device_seq,
  ps.dgi_cufe,
  ps.created_at,
  t.code             as terminal_code,
  t.name             as terminal_name,
  o.id               as order_id,
  o.status,
  o.currency,
  o.subtotal_cents,
  o.dgi_tax_cents,
  o.total_cents,
  c.email            as customer_email,
  c.name             as customer_name,
  (select count(*) from order_lines ol where ol.order_id = o.id) as line_count
from pos_sales ps
join pos_terminals t on t.id = ps.terminal_id and t.tenant_id = ps.tenant_id
join orders o        on o.id = ps.order_id   and o.tenant_id = ps.tenant_id
join customers c     on c.id = o.customer_id  and c.tenant_id = o.tenant_id;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. RLS — tenant-scoped read on every new table. ALL writes flow through the SECDEF
--    RPCs (they bypass RLS + self-clamp), so NO insert/update/delete policy.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['pos_terminals', 'pos_sales']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'create policy "tenant read" on public.%I for select to authenticated
         using (tenant_id = current_tenant_id());', t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. GRANTS (AD-8) — per-object SELECT to authenticated (one statement each so the
--    name-anchored static guard matches). anon gets NOTHING. No INSERT/UPDATE/DELETE
--    grant on either table (writes flow only through the SECDEF RPCs above). RPC execute
--    was revoked-then-granted at each definition.
-- ════════════════════════════════════════════════════════════════════════════
grant select on pos_terminals    to authenticated;
grant select on pos_sales        to authenticated;
grant select on v_pos_sales_book to authenticated;

commit;
