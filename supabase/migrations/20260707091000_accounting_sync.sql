-- ════════════════════════════════════════════════════════════════════════════
-- P3-S17 · AR docs + payment settlement + the QBO/Xero/PAC sync seam.
--          The commercial mint/settle door on top of the S16 accounting spine,
--          plus the IDEMPOTENT, APPEND-ONLY bridge to the buyer's books.
-- ════════════════════════════════════════════════════════════════════════════
-- Spec: docs/design/PHASE3-DESIGN.md lines 369–388 (+ §1 cross-slice rails).
-- Deps: P3-S16 (accounting schema), P3-S1 (contracts — soft-ref), P3-S3 (export gate).
--
-- This does NOT rebuild bookkeeping. QBO/Xero/PAC are MOCK seams ($0, no certified
-- PAC, no real sync): we MAP our coffee-native ledger (cost_entry.allocation_rule /
-- revenue_entry.source_kind) onto the buyer's chart of accounts (account_map) and
-- queue idempotent posts (sync_outbox) a worker Edge Function drains to a sandbox.
--
-- What this slice ships:
--   * account_map     — our-ledger → buyer-account-code mapping (config; RPC-edited).
--   * sync_outbox     — the IDEMPOTENT append-only post queue (content-hash key UNIQUE,
--                       ON CONFLICT DO NOTHING). Only state/external_id/attempts move.
--   * sync_inbound    — the append-only log of pulls FROM QBO/Xero (idempotent on
--                       (target, external_id); never blind-trusts the external system).
--   * issue_ar_doc    — ONE txn: mint gap-free doc_number, COMMIT each line's kg by
--                       writing a lot_shipments row (the EXISTING prevent_oversell is
--                       the money guarantee — the invoice + the inventory commitment
--                       are one atomic act), resolve fx, write ar_doc + ar_doc_line,
--                       append revenue_entry, enqueue sync_outbox per target, append
--                       the 'ar_issued' lot_event. A dgi_pac doc stays 'draft' until
--                       the PAC stamps a CUFE (the fiscal gate).
--   * settle_ar_payment — resolve receipt fx, write ar_payment (S16 cap + status
--                       triggers fire), on 'paid' book the two-rate fx_gain_loss_entry,
--                       enqueue the payment sync, append 'ar_paid'. p_enqueue_sync=false
--                       suppresses the push when the payment came FROM the external sys.
--   * void_ar_doc     — reverse the revenue_entry (negative rows, never a delete),
--                       enqueue a void sync, append 'ar_voided'.
--   * claim_sync_batch / mark_sync_result — the worker drain (FOR UPDATE SKIP LOCKED so
--                       two workers never grab one row); a dgi_pac CUFE flips the doc
--                       to 'issued'.
--   * apply_sync_inbound — idempotently applies an external payment/void via the SAME
--                       settle/void path (no privileged backdoor) WITHOUT echoing back.
--   * v_sync_health / v_cash_runway / v_preharvest_finance — the cockpit reads.
--
-- Rails honored (§1):
--   * ONE WRITE DOOR — every mutation is a SECURITY DEFINER RPC (set search_path =
--     public, extensions; tenant-clamped; idempotent on a tenant-qualified key). No
--     client UPDATE/DELETE grant on any ledger; corrections are superseding/reversing
--     rows. record_lot_event appends in the SAME txn (hash-chained audit).
--   * MONEY GUARANTEE REUSED — issue_ar_doc commits inventory by inserting lot_shipments
--     so prevent_oversell (+ the QC-hold seam) fires. NEVER a parallel counter.
--   * EXACTLY-ONCE SYNC — sync_outbox.idempotency_key UNIQUE + ON CONFLICT DO NOTHING;
--     inbound idempotent on (target, external_id).
--   * AD-8/AD-9 grants — per-object `grant select … to authenticated`; on each RPC
--     `revoke execute … from public` THEN `grant … to authenticated`. anon gets NOTHING.
--   * Tenant seam — tenant_id + current_tenant_id() default + RLS on every new table;
--     registered in tenantTables.ts (DIRECT_TENANT_TABLES).
--   * FX through the canonical fx_rate table (record_fx_rate / on-book lookup) — never
--     an off-book or hardcoded rate.

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 0. Enums.
-- ════════════════════════════════════════════════════════════════════════════
create type sync_target as enum ('qbo', 'xero', 'dgi_pac');
create type sync_state  as enum ('pending', 'claimed', 'synced', 'failed');

-- ════════════════════════════════════════════════════════════════════════════
-- 1. account_map — maps OUR ledger keys onto the buyer's chart of accounts. This is
--    why we never rebuild bookkeeping: we MAP, not mirror. Config (RPC-edited via
--    set_account_map); no client write grant. One mapping per (tenant,target,kind,key).
-- ════════════════════════════════════════════════════════════════════════════
create table account_map (
  id           bigint generated always as identity primary key,
  tenant_id    uuid    not null references tenants(id) default current_tenant_id(),
  target       sync_target not null,
  entry_kind   text    not null check (entry_kind in ('cost', 'revenue')),
  match_key    text    not null,                  -- allocation_rule (cost) | source_kind (revenue)
  account_code text    not null,                  -- the QBO/Xero account code
  account_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint account_map_unique unique (tenant_id, target, entry_kind, match_key)
);
create index account_map_tenant_idx on account_map (tenant_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. sync_outbox — the IDEMPOTENT append-only post queue. idempotency_key is content-
--    hash-derived (target||':'||entity_kind||':'||entity_ref||':'||content_hash) so the
--    SAME doc/payment never double-posts even under retry/crash. Only state/external_id/
--    attempts/last_error are mutable (the worker RPC); everything else is frozen.
-- ════════════════════════════════════════════════════════════════════════════
create table sync_outbox (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  target          sync_target not null,
  entity_kind     text    not null check (entity_kind in ('ar_doc', 'ar_payment', 'ar_void')),
  entity_ref      text    not null,               -- doc_number | payment id
  ar_doc_id       bigint,                          -- soft link for the cockpit + the fiscal gate
  content_hash    text    not null,
  payload         jsonb   not null,
  state           sync_state not null default 'pending',
  external_id     text,                            -- the QBO/Xero/PAC doc id (CUFE for dgi_pac)
  attempts        int     not null default 0,
  last_error      text,
  idempotency_key text    not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint sync_outbox_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index sync_outbox_tenant_idx on sync_outbox (tenant_id);
create index sync_outbox_drain_idx  on sync_outbox (tenant_id, target, state);
create index sync_outbox_doc_idx    on sync_outbox (ar_doc_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. sync_inbound — the append-only log of pulls FROM QBO/Xero (a payment/void entered
--    directly there). Idempotent on (target, external_id) — a re-pull is a no-op; we
--    never blind-trust the external system twice. applied/applied_ref flip once applied.
-- ════════════════════════════════════════════════════════════════════════════
create table sync_inbound (
  id          bigint generated always as identity primary key,
  tenant_id   uuid    not null references tenants(id) default current_tenant_id(),
  target      sync_target not null,
  external_id text    not null,
  event_kind  text    not null check (event_kind in ('payment', 'void')),
  payload     jsonb   not null,
  applied     boolean not null default false,
  applied_ref text,                                -- our ar_payment id / void marker
  received_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  constraint sync_inbound_target_extid_ux unique (tenant_id, target, external_id)
);
create index sync_inbound_tenant_idx on sync_inbound (tenant_id);

-- A soft back-reference from revenue_entry to the AR doc it journals (so void_ar_doc
-- can find exactly the rows to reverse). Additive nullable column over the S16 table.
alter table revenue_entry add column if not exists ar_doc_id bigint;
create index if not exists revenue_entry_ar_doc_idx on revenue_entry (ar_doc_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Append-only / restricted-mutation triggers.
--    sync_outbox: DELETE forbidden; UPDATE may touch ONLY state/external_id/attempts/
--    last_error/updated_at. sync_inbound: DELETE forbidden; UPDATE only applied/
--    applied_ref. NOT security definer (they run as owner via the trigger mechanism).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function _sync_outbox_restrict() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'sync_outbox is append-only: DELETE is not permitted'
      using errcode = 'restrict_violation';
  end if;
  -- UPDATE: every column EXCEPT the worker-mutable set must be unchanged.
  if new.id          <> old.id
     or new.tenant_id    is distinct from old.tenant_id
     or new.target       is distinct from old.target
     or new.entity_kind  is distinct from old.entity_kind
     or new.entity_ref   is distinct from old.entity_ref
     or new.ar_doc_id    is distinct from old.ar_doc_id
     or new.content_hash is distinct from old.content_hash
     or new.payload::text is distinct from old.payload::text
     or new.idempotency_key is distinct from old.idempotency_key
     or new.created_at   is distinct from old.created_at then
    raise exception
      'sync_outbox: only state/external_id/attempts/last_error are mutable (content is frozen)'
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;
revoke execute on function _sync_outbox_restrict() from public;
create trigger sync_outbox_no_delete before delete on sync_outbox
  for each row execute function _sync_outbox_restrict();
create trigger sync_outbox_restrict_update before update on sync_outbox
  for each row execute function _sync_outbox_restrict();

create or replace function _sync_inbound_restrict() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'sync_inbound is append-only: DELETE is not permitted'
      using errcode = 'restrict_violation';
  end if;
  if new.id <> old.id
     or new.tenant_id   is distinct from old.tenant_id
     or new.target      is distinct from old.target
     or new.external_id is distinct from old.external_id
     or new.event_kind  is distinct from old.event_kind
     or new.payload::text is distinct from old.payload::text
     or new.received_at is distinct from old.received_at
     or new.created_at  is distinct from old.created_at then
    raise exception 'sync_inbound: only applied/applied_ref are mutable'
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;
revoke execute on function _sync_inbound_restrict() from public;
create trigger sync_inbound_no_delete before delete on sync_inbound
  for each row execute function _sync_inbound_restrict();
create trigger sync_inbound_restrict_update before update on sync_inbound
  for each row execute function _sync_inbound_restrict();

-- ════════════════════════════════════════════════════════════════════════════
-- 5. _resolve_fx_rate — the canonical on-book lookup (NEVER hardcoded). USD→1; any
--    other doc currency must have an on-book fx_rate row or the post fails closed.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function _resolve_fx_rate(p_tenant uuid, p_currency text)
  returns numeric
  language plpgsql stable set search_path = public
as $$
declare v_rate numeric;
begin
  if p_currency = 'USD' then
    return 1;
  end if;
  select rate into v_rate
    from fx_rate
   where tenant_id = p_tenant and base = p_currency and quote = 'USD'
   order by as_of_date desc, id desc
   limit 1;
  if v_rate is null then
    raise exception
      'off-book FX: no fx_rate for %→USD on the books; record the rate first', p_currency
      using errcode = 'foreign_key_violation';
  end if;
  return v_rate;
end $$;
revoke execute on function _resolve_fx_rate(uuid, text) from public;
grant   execute on function _resolve_fx_rate(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. set_account_map — the only account_map writer (upsert). SECURITY DEFINER,
--    tenant-clamped.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function set_account_map(
  p_target       sync_target,
  p_entry_kind   text,
  p_match_key    text,
  p_account_code text,
  p_account_name text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_id     bigint;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  insert into account_map (tenant_id, target, entry_kind, match_key, account_code, account_name)
  values (v_tenant, p_target, p_entry_kind, p_match_key, p_account_code, p_account_name)
  on conflict (tenant_id, target, entry_kind, match_key)
    do update set account_code = excluded.account_code,
                  account_name = excluded.account_name,
                  updated_at   = now()
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function set_account_map(sync_target, text, text, text, text) from public;
grant   execute on function set_account_map(sync_target, text, text, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. issue_ar_doc — the AR mint. ONE atomic txn: mint number, COMMIT inventory (the
--    money guarantee reused), append revenue, enqueue the sync per target, audit.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function issue_ar_doc(
  p_kind            ar_doc_kind,
  p_currency        text,
  p_lines           jsonb,                         -- [{green_lot_code, description, kg, unit_price_doc, amount_doc, source_kind}]
  p_buyer_ref       text,
  p_contract_ref    text,
  p_incoterm        text,
  p_targets         text[],
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant   uuid := current_tenant_id();
  v_key      text;
  v_doc_id   bigint;
  v_no       text;
  v_n        bigint;
  v_prefix   text;
  v_rate     numeric;
  v_total    numeric := 0;
  v_status   ar_doc_status;
  v_line     jsonb;
  v_lot      text;
  v_kg       numeric;
  v_amt      numeric;
  v_unit     numeric;
  v_src      text;
  v_t        text;
  v_hash     text;
  v_payload  jsonb;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  -- idempotency early-return.
  select id into v_doc_id from ar_doc where tenant_id = v_tenant and idempotency_key = v_key;
  if v_doc_id is not null then
    return v_doc_id;
  end if;

  -- export-doc gate (shared with P3-S3): a commercial invoice needs its contract + Incoterm.
  if p_kind = 'commercial_invoice' and (p_contract_ref is null or p_incoterm is null) then
    raise exception
      'export gate: a commercial_invoice requires a contract reference and an Incoterm'
      using errcode = 'check_violation';
  end if;

  v_rate := _resolve_fx_rate(v_tenant, coalesce(p_currency, 'USD'));

  -- doc total from the lines (pre-aggregate so ar_doc lands with its real total).
  select coalesce(sum((l ->> 'amount_doc')::numeric), 0)
    into v_total
    from jsonb_array_elements(p_lines) l;

  -- the fiscal gate: a DGI factura is NOT 'issued' until the PAC stamps a CUFE.
  v_status := case when 'dgi_pac' = any(coalesce(p_targets, array[]::text[]))
                   then 'draft' else 'issued' end::ar_doc_status;

  -- mint the gap-free per-kind doc number (per tenant, advisory-locked).
  v_prefix := case p_kind
                when 'proforma' then 'JC-PF'
                when 'commercial_invoice' then 'JC-CI'
                when 'credit_note' then 'JC-CN'
                else 'JC-RC' end;
  perform pg_advisory_xact_lock(hashtext('ar_doc_no:' || v_tenant::text || ':' || p_kind::text));
  select coalesce(max((regexp_replace(doc_number, '\D', '', 'g'))::bigint), 0) + 1
    into v_n
    from ar_doc
   where tenant_id = v_tenant and kind = p_kind and doc_number ~ ('^' || v_prefix || '-[0-9]+$');
  v_no := v_prefix || '-' || lpad(v_n::text, 4, '0');

  insert into ar_doc (tenant_id, kind, doc_number, status, incoterm, buyer_ref, contract_ref,
                      total_doc, currency, total_usd, fx_rate_at_issue, idempotency_key)
  values (v_tenant, p_kind, v_no, v_status, p_incoterm, p_buyer_ref, p_contract_ref,
          v_total, coalesce(p_currency, 'USD'), round(v_total * v_rate, 2), v_rate, v_key)
  returning id into v_doc_id;

  -- lines: write the line, COMMIT the inventory (prevent_oversell fires), append revenue.
  for v_line in select l from jsonb_array_elements(p_lines) l loop
    v_lot  := nullif(v_line ->> 'green_lot_code', '');
    v_kg   := nullif(v_line ->> 'kg', '')::numeric;
    v_amt  := (v_line ->> 'amount_doc')::numeric;
    v_unit := coalesce((v_line ->> 'unit_price_doc')::numeric, 0);
    v_src  := coalesce(nullif(v_line ->> 'source_kind', ''), 'green_sale');

    insert into ar_doc_line (tenant_id, ar_doc_id, green_lot_code, description, kg, unit_price_doc, amount_doc)
    values (v_tenant, v_doc_id, v_lot, coalesce(v_line ->> 'description', 'line'), v_kg, v_unit, v_amt);

    -- THE MONEY GUARANTEE: the invoice and the inventory commitment are ONE act. The
    -- existing prevent_oversell (+ the QC-hold seam) rejects a line that would double-
    -- sell a scarce lot. No parallel counter — the lot_shipments row IS the commitment.
    if v_lot is not null and v_kg is not null then
      insert into lot_shipments (tenant_id, green_lot_code, destination, kg)
      values (v_tenant, v_lot, 'AR ' || v_no, v_kg);
    end if;

    -- append the revenue journal (the off-book-rate guard fires on insert).
    insert into revenue_entry (tenant_id, source_kind, green_lot_code, amount_doc, currency,
                               amount_usd, fx_rate_used, ar_doc_id, memo, idempotency_key)
    values (v_tenant, v_src, v_lot, v_amt, coalesce(p_currency, 'USD'),
            round(v_amt * v_rate, 2), v_rate, v_doc_id, 'ar:' || v_no,
            v_key || ':rev:' || coalesce(v_lot, 'noLot') || ':' || v_amt::text);
  end loop;

  -- enqueue one idempotent outbox post per target (exactly-once under retry/crash).
  v_payload := jsonb_build_object('doc_id', v_doc_id, 'doc_number', v_no, 'kind', p_kind,
                                  'currency', coalesce(p_currency, 'USD'), 'total_doc', v_total,
                                  'total_usd', round(v_total * v_rate, 2), 'buyer_ref', p_buyer_ref,
                                  'contract_ref', p_contract_ref, 'lines', p_lines);
  foreach v_t in array coalesce(p_targets, array['qbo']) loop
    v_hash := md5(v_payload::text);
    insert into sync_outbox (tenant_id, target, entity_kind, entity_ref, ar_doc_id,
                             content_hash, payload, idempotency_key)
    values (v_tenant, v_t::sync_target, 'ar_doc', v_no, v_doc_id, v_hash, v_payload,
            v_t || ':ar_doc:' || v_no || ':' || v_hash)
    on conflict (tenant_id, idempotency_key) do nothing;
  end loop;

  -- hash-chained audit: 'ar_issued' per distinct invoiced green lot.
  for v_lot in
    select distinct nullif(l ->> 'green_lot_code', '')
      from jsonb_array_elements(p_lines) l
     where nullif(l ->> 'green_lot_code', '') is not null
  loop
    perform record_lot_event(
      v_lot, 'ar_issued',
      jsonb_build_object('doc_id', v_doc_id, 'doc_number', v_no, 'kind', p_kind,
                         'currency', coalesce(p_currency, 'USD'), 'total_doc', v_total),
      now(), 'server', nextval('lot_code_seq'), v_key || ':issued:' || v_lot);
  end loop;

  return v_doc_id;
end $$;
revoke execute on function issue_ar_doc(ar_doc_kind, text, jsonb, text, text, text, text[], text) from public;
grant   execute on function issue_ar_doc(ar_doc_kind, text, jsonb, text, text, text, text[], text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. settle_ar_payment — inbound cash. The S16 cap + recompute triggers do the heavy
--    lifting (overpayment guard, deterministic status). On 'paid' we book the realized
--    two-rate FX. p_enqueue_sync=false suppresses the push when the payment came FROM
--    the external system (apply_sync_inbound) — the asymmetric source-of-truth rule.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function settle_ar_payment(
  p_ar_doc_id       bigint,
  p_method          payment_method,
  p_amount_doc      numeric,
  p_currency        text,
  p_idempotency_key text,
  p_enqueue_sync    boolean default true
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant   uuid := current_tenant_id();
  v_key      text;
  v_pay_id   bigint;
  v_doc      record;
  v_rate     numeric;
  v_amt_usd  numeric;
  v_t        text;
  v_hash     text;
  v_payload  jsonb;
  v_lot      text;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select id into v_pay_id from ar_payment where tenant_id = v_tenant and idempotency_key = v_key;
  if v_pay_id is not null then
    return v_pay_id;                                 -- exactly-once (the gateway event id)
  end if;

  select * into v_doc from ar_doc where id = p_ar_doc_id and tenant_id = v_tenant;
  if not found then
    raise exception 'unknown ar_doc %', p_ar_doc_id using errcode = 'foreign_key_violation';
  end if;

  v_rate    := _resolve_fx_rate(v_tenant, coalesce(p_currency, 'USD'));
  v_amt_usd := round(p_amount_doc * v_rate, 2);

  -- the cap + recompute-status triggers (S16) fire here.
  insert into ar_payment (tenant_id, ar_doc_id, method, amount_doc, currency,
                          amount_usd_at_receipt, fx_rate_at_receipt, idempotency_key)
  values (v_tenant, p_ar_doc_id, p_method, p_amount_doc, coalesce(p_currency, 'USD'),
          v_amt_usd, v_rate, v_key)
  returning id into v_pay_id;

  -- on full settlement, book the realized two-rate FX (gain = total × (receipt − issue)).
  if exists (select 1 from ar_doc where id = p_ar_doc_id and tenant_id = v_tenant and status = 'paid') then
    insert into fx_gain_loss_entry (tenant_id, ar_doc_id, amount_doc, fx_rate_at_issue,
                                    fx_rate_at_receipt, gain_usd, idempotency_key)
    values (v_tenant, p_ar_doc_id, v_doc.total_doc, v_doc.fx_rate_at_issue, v_rate,
            round(v_doc.total_doc * (v_rate - v_doc.fx_rate_at_issue), 2), v_key || ':fxgl')
    on conflict (tenant_id, idempotency_key) do nothing;
  end if;

  -- enqueue the payment sync to each target the doc was issued to (unless inbound).
  if p_enqueue_sync then
    v_payload := jsonb_build_object('payment_id', v_pay_id, 'ar_doc_id', p_ar_doc_id,
                                    'doc_number', v_doc.doc_number, 'method', p_method,
                                    'amount_doc', p_amount_doc, 'currency', coalesce(p_currency, 'USD'),
                                    'amount_usd', v_amt_usd);
    for v_t in
      select distinct target::text from sync_outbox
       where tenant_id = v_tenant and ar_doc_id = p_ar_doc_id and entity_kind = 'ar_doc'
    loop
      v_hash := md5(v_payload::text);
      insert into sync_outbox (tenant_id, target, entity_kind, entity_ref, ar_doc_id,
                               content_hash, payload, idempotency_key)
      values (v_tenant, v_t::sync_target, 'ar_payment', v_pay_id::text, p_ar_doc_id, v_hash, v_payload,
              v_t || ':ar_payment:' || v_pay_id::text || ':' || v_hash)
      on conflict (tenant_id, idempotency_key) do nothing;
    end loop;
  end if;

  -- hash-chained audit: 'ar_paid' per distinct invoiced green lot.
  for v_lot in
    select distinct green_lot_code from ar_doc_line
     where ar_doc_id = p_ar_doc_id and tenant_id = v_tenant and green_lot_code is not null
  loop
    perform record_lot_event(
      v_lot, 'ar_paid',
      jsonb_build_object('payment_id', v_pay_id, 'ar_doc_id', p_ar_doc_id,
                         'doc_number', v_doc.doc_number, 'amount_doc', p_amount_doc,
                         'currency', coalesce(p_currency, 'USD')),
      now(), 'server', nextval('lot_code_seq'), v_key || ':paid:' || v_lot);
  end loop;

  return v_pay_id;
end $$;
revoke execute on function settle_ar_payment(bigint, payment_method, numeric, text, text, boolean) from public;
grant   execute on function settle_ar_payment(bigint, payment_method, numeric, text, text, boolean) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. void_ar_doc — reverse the revenue (negative rows, never a delete), enqueue a void
--    sync, audit. A doc with payments cannot be voided (issue a credit note instead).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function void_ar_doc(
  p_ar_doc_id       bigint,
  p_reason          text,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant  uuid := current_tenant_id();
  v_key     text;
  v_doc     record;
  v_rev     record;
  v_t       text;
  v_hash    text;
  v_payload jsonb;
  v_lot     text;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select * into v_doc from ar_doc where id = p_ar_doc_id and tenant_id = v_tenant;
  if not found then
    raise exception 'unknown ar_doc %', p_ar_doc_id using errcode = 'foreign_key_violation';
  end if;
  if v_doc.status = 'void' then
    return v_doc.id;                                 -- idempotent
  end if;
  if v_doc.status in ('partially_paid', 'paid') then
    raise exception 'ar_doc % has payments — issue a credit note, do not void', p_ar_doc_id
      using errcode = 'check_violation';
  end if;

  update ar_doc set status = 'void' where id = p_ar_doc_id and tenant_id = v_tenant;

  -- reverse every original revenue_entry of this doc (append-only correction path).
  for v_rev in
    select * from revenue_entry
     where tenant_id = v_tenant and ar_doc_id = p_ar_doc_id and reverses_id is null
  loop
    insert into revenue_entry (tenant_id, source_kind, green_lot_code, amount_doc, currency,
                               amount_usd, fx_rate_used, reverses_id, ar_doc_id, memo, idempotency_key)
    values (v_tenant, v_rev.source_kind, v_rev.green_lot_code, -v_rev.amount_doc, v_rev.currency,
            -v_rev.amount_usd, v_rev.fx_rate_used, v_rev.id, p_ar_doc_id,
            'void: ' || coalesce(p_reason, ''), v_key || ':rev-rev:' || v_rev.id::text);
  end loop;

  -- enqueue a void sync per target the doc was issued to.
  v_payload := jsonb_build_object('ar_doc_id', p_ar_doc_id, 'doc_number', v_doc.doc_number,
                                  'reason', p_reason);
  for v_t in
    select distinct target::text from sync_outbox
     where tenant_id = v_tenant and ar_doc_id = p_ar_doc_id and entity_kind = 'ar_doc'
  loop
    v_hash := md5(v_payload::text);
    insert into sync_outbox (tenant_id, target, entity_kind, entity_ref, ar_doc_id,
                             content_hash, payload, idempotency_key)
    values (v_tenant, v_t::sync_target, 'ar_void', v_doc.doc_number, p_ar_doc_id, v_hash, v_payload,
            v_t || ':ar_void:' || v_doc.doc_number || ':' || v_hash)
    on conflict (tenant_id, idempotency_key) do nothing;
  end loop;

  for v_lot in
    select distinct green_lot_code from ar_doc_line
     where ar_doc_id = p_ar_doc_id and tenant_id = v_tenant and green_lot_code is not null
  loop
    perform record_lot_event(
      v_lot, 'ar_voided',
      jsonb_build_object('ar_doc_id', p_ar_doc_id, 'doc_number', v_doc.doc_number, 'reason', p_reason),
      now(), 'server', nextval('lot_code_seq'), v_key || ':voided:' || v_lot);
  end loop;

  return v_doc.id;
end $$;
revoke execute on function void_ar_doc(bigint, text, text) from public;
grant   execute on function void_ar_doc(bigint, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 10. claim_sync_batch / mark_sync_result — the worker drain. SELECT … FOR UPDATE SKIP
--     LOCKED so two workers never grab one row. A dgi_pac CUFE flips the doc 'issued'.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function claim_sync_batch(p_target sync_target, p_limit int)
  returns setof sync_outbox
  language plpgsql security definer set search_path = public, extensions
as $$
declare v_tenant uuid := current_tenant_id();
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  return query
    update sync_outbox o
       set state = 'claimed', attempts = o.attempts + 1, updated_at = now()
     where o.id in (
       select c.id from sync_outbox c
        where c.tenant_id = v_tenant and c.target = p_target and c.state in ('pending', 'failed')
        order by c.id
        limit greatest(p_limit, 0)
        for update skip locked
     )
    returning o.*;
end $$;
revoke execute on function claim_sync_batch(sync_target, int) from public;
grant   execute on function claim_sync_batch(sync_target, int) to authenticated;

create or replace function mark_sync_result(
  p_outbox_id   bigint,
  p_success     boolean,
  p_external_id text,
  p_error       text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_row    record;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  update sync_outbox
     set state       = case when p_success then 'synced' else 'failed' end::sync_state,
         external_id = coalesce(p_external_id, external_id),
         last_error  = case when p_success then null else p_error end,
         updated_at  = now()
   where id = p_outbox_id and tenant_id = v_tenant
  returning * into v_row;
  if not found then
    raise exception 'unknown sync_outbox %', p_outbox_id using errcode = 'foreign_key_violation';
  end if;

  -- THE FISCAL GATE: a DGI factura cannot claim 'issued' until the PAC stamps a CUFE.
  if p_success and v_row.target = 'dgi_pac' and v_row.entity_kind = 'ar_doc'
     and v_row.ar_doc_id is not null then
    update ar_doc set status = 'issued'
     where id = v_row.ar_doc_id and tenant_id = v_tenant and status = 'draft';
  end if;

  return v_row.id;
end $$;
revoke execute on function mark_sync_result(bigint, boolean, text, text) from public;
grant   execute on function mark_sync_result(bigint, boolean, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 11. apply_sync_inbound — idempotently apply an external payment/void via the SAME
--     settle/void path (no privileged backdoor) WITHOUT echoing the post back out.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function apply_sync_inbound(
  p_target     sync_target,
  p_external_id text,
  p_event_kind text,
  p_payload    jsonb
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_in_id  bigint;
  v_ref    text;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;

  -- idempotent on (target, external_id): a re-pull is a no-op.
  select id into v_in_id from sync_inbound
   where tenant_id = v_tenant and target = p_target and external_id = p_external_id;
  if v_in_id is not null then
    return v_in_id;
  end if;

  insert into sync_inbound (tenant_id, target, external_id, event_kind, payload)
  values (v_tenant, p_target, p_external_id, p_event_kind, p_payload)
  returning id into v_in_id;

  if p_event_kind = 'payment' then
    -- p_enqueue_sync = false: the payment already lives in the external system; pushing
    -- it back would echo forever. OUR ledger is authoritative only for what WE issue.
    v_ref := settle_ar_payment(
               (p_payload ->> 'ar_doc_id')::bigint,
               (p_payload ->> 'method')::payment_method,
               (p_payload ->> 'amount_doc')::numeric,
               coalesce(p_payload ->> 'currency', 'USD'),
               'inbound:' || p_target::text || ':' || p_external_id,
               false)::text;
  elsif p_event_kind = 'void' then
    v_ref := void_ar_doc(
               (p_payload ->> 'ar_doc_id')::bigint,
               coalesce(p_payload ->> 'reason', 'external void'),
               'inbound:' || p_target::text || ':' || p_external_id)::text;
  end if;

  update sync_inbound set applied = true, applied_ref = v_ref where id = v_in_id;
  return v_in_id;
end $$;
revoke execute on function apply_sync_inbound(sync_target, text, text, jsonb) from public;
grant   execute on function apply_sync_inbound(sync_target, text, text, jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 12. Cockpit read views (security_invoker — inherit caller RLS).
-- ════════════════════════════════════════════════════════════════════════════

-- 12a. v_sync_health — the dead-guard alarm: outbox depth/failures/oldest pending.
create view v_sync_health with (security_invoker = on) as
  select
    tenant_id,
    target,
    count(*) filter (where state = 'pending')          as pending,
    count(*) filter (where state = 'claimed')          as in_flight,
    count(*) filter (where state = 'failed')           as failed,
    count(*) filter (where state = 'synced')           as synced,
    max(attempts) filter (where state = 'failed')      as max_attempts_failed,
    min(created_at) filter (where state in ('pending', 'failed')) as oldest_unsynced_at
  from sync_outbox
  group by tenant_id, target;

-- 12b. v_cash_runway — the only place both ledgers net: AR due − committed cost.
--      (Phase-2 payroll forecast + scheduled milling/freight join here in a later pass.)
create view v_cash_runway with (security_invoker = on) as
  with ar as (
    select tenant_id, coalesce(sum(balance_usd), 0) as ar_outstanding_usd
      from v_ar_aging where status <> 'void' group by tenant_id
  ),
  cost as (
    select tenant_id, coalesce(sum(amount_usd), 0) as committed_cost_usd
      from cost_entry group by tenant_id
  )
  select
    coalesce(ar.tenant_id, cost.tenant_id)                                            as tenant_id,
    coalesce(ar.ar_outstanding_usd, 0)                                                as ar_outstanding_usd,
    coalesce(cost.committed_cost_usd, 0)                                              as committed_cost_usd,
    coalesce(ar.ar_outstanding_usd, 0) - coalesce(cost.committed_cost_usd, 0)         as net_position_usd
  from ar full join cost on ar.tenant_id = cost.tenant_id;

-- 12c. v_preharvest_finance — the financing gap BEFORE the picking crew shows up:
--      pre-sold reservations vs the open por-obra labor liability.
create view v_preharvest_finance with (security_invoker = on) as
  with presold as (
    select tenant_id, coalesce(sum(kg), 0) as presold_kg
      from lot_reservations group by tenant_id
  ),
  labor as (
    select tenant_id,
           count(*)                  as active_por_obra_contracts,
           coalesce(sum(rate_usd), 0) as indicative_labor_rate_usd
      from por_obra_contracts
     where superseded_by is null and (effective_to is null or effective_to >= current_date)
     group by tenant_id
  )
  select
    coalesce(p.tenant_id, l.tenant_id)              as tenant_id,
    coalesce(p.presold_kg, 0)                       as presold_kg,
    coalesce(l.active_por_obra_contracts, 0)        as active_por_obra_contracts,
    coalesce(l.indicative_labor_rate_usd, 0)        as indicative_labor_rate_usd
  from presold p full join labor l on p.tenant_id = l.tenant_id;

-- ════════════════════════════════════════════════════════════════════════════
-- 13. RLS — tenant-scoped read on every new table. All three are RPC-only writes
--     (no insert/update/delete policy); the SECDEF RPCs run as owner and bypass RLS.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['account_map', 'sync_outbox', 'sync_inbound']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'create policy "tenant read" on public.%I for select to authenticated
         using (tenant_id = current_tenant_id());', t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 14. GRANTS (AD-8) — per-object SELECT to authenticated on every table/view (one
--     statement each so the name-anchored static guard matches). anon gets NOTHING.
-- ════════════════════════════════════════════════════════════════════════════
grant select on account_map          to authenticated;
grant select on sync_outbox          to authenticated;
grant select on sync_inbound         to authenticated;
grant select on v_sync_health        to authenticated;
grant select on v_cash_runway        to authenticated;
grant select on v_preharvest_finance to authenticated;

commit;
