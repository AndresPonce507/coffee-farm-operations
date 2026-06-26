-- ════════════════════════════════════════════════════════════════════════════
-- P3-S16 · Accounting schema — the revenue ledger + AR docs + payments + FX SSOT.
--          THE books' spine: the financial sink every commerce slice drains into.
-- ════════════════════════════════════════════════════════════════════════════
-- Spec: docs/design/PHASE3-DESIGN.md lines 355–366 (+ §1 cross-slice rails).
--
-- This does NOT build double-entry bookkeeping (that is the BUY/INTEGRATE QBO/Xero +
-- a PAC seam, P3-S17). It builds ONLY the coffee-native financial layer:
--   * revenue_entry — the REVENUE-SIDE mirror of cost_entry (the journal source).
--     Per-lot realized margin = revenue_entry ⨝ mv_lot_cost (closes the Phase-1 loop).
--   * fx_rate — the canonical daily-rate SSOT: one place a rate lives, never hardcoded.
--   * ar_doc / ar_doc_line / ar_payment — the AR instrument + its append-only cash.
--   * fx_gain_loss_entry — the distinct realized-FX P&L line, traceable to two rates.
--
-- The S16 write door is record_fx_rate (the only fx_rate writer). The AR mint/settle
-- RPCs (issue_ar_doc / settle_ar_payment) are P3-S17; this slice ships the SCHEMA +
-- the data-layer invariants that hold no matter which RPC writes:
--   * append-only immutability (cost_entry_immutable() style) on every ledger;
--   * a revenue row's USD = amount_doc × fx_rate_used (CHECK) AND fx_rate_used must be
--     an ON-BOOK rate (existence trigger) — no off-book rate;
--   * an AR doc can NEVER be overpaid (Σ ar_payment ≤ total + ε) and its status is a
--     DETERMINISTIC function of the paid sum — never a manual 'paid' flip;
--   * a realized FX gain MUST equal amount_doc × (rate_at_receipt − rate_at_issue).
--
-- Rails honored:
--   * One write door — fx_rate writes only via record_fx_rate (SECURITY DEFINER,
--     set search_path = public, extensions, tenant-clamped, idempotent). revenue_entry
--     mirrors cost_entry's append posture (direct INSERT, append-only — the journal
--     source the commerce slices post through). No client UPDATE/DELETE on any ledger.
--   * AD-8/AD-9 grants — per-object `grant select … to authenticated`; on the RPC
--     `revoke execute … from public` THEN `grant … to authenticated`. anon gets NOTHING.
--   * Tenant seam — every new table carries tenant_id + current_tenant_id() default +
--     RLS `using (tenant_id = current_tenant_id())`; registered in tenantTables.ts.
--   * Conversions/FX route through the canonical fx_rate table, never an off-book rate.
--   * Margin floor / cost truth — v_lot_margin reads mv_lot_cost_secure.cost_per_kg_green;
--     NULL cost ⇒ NULL margin (flagged, never a fabricated number).

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 0. Enums.
-- ════════════════════════════════════════════════════════════════════════════
create type ar_doc_kind   as enum ('proforma', 'commercial_invoice', 'credit_note', 'dtc_receipt');
create type ar_doc_status as enum ('draft', 'issued', 'partially_paid', 'paid', 'void');
create type payment_method as enum ('wire', 'ach', 'card', 'cash', 'yappy', 'check');

-- ════════════════════════════════════════════════════════════════════════════
-- 1. fx_rate — the canonical daily rate SSOT (one place a rate lives). One row per
--    (tenant, as_of_date, base, quote). Append-only; written only via record_fx_rate.
-- ════════════════════════════════════════════════════════════════════════════
create table fx_rate (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  as_of_date      date    not null,
  base            text    not null,                         -- e.g. 'EUR'
  quote           text    not null default 'USD',
  rate            numeric not null check (rate > 0),         -- base→quote
  source          text    not null default 'manual',        -- 'ecb' | 'manual'
  idempotency_key text,
  created_at      timestamptz not null default now()
);
create index fx_rate_tenant_idx on fx_rate (tenant_id);
create unique index fx_rate_tenant_pair_ux on fx_rate (tenant_id, as_of_date, base, quote);
create unique index fx_rate_tenant_idem_ux
  on fx_rate (tenant_id, idempotency_key) where idempotency_key is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. revenue_entry — the REVENUE-SIDE mirror of cost_entry. The journal source +
--    the per-lot margin half (revenue_entry ⨝ mv_lot_cost). green_lot_code is
--    un-FK'd (like cost_entry.target_code) so revenue can name a lot without a hard
--    FK fight. amount_usd = amount_doc × fx_rate_used (CHECK); reversals are negative.
-- ════════════════════════════════════════════════════════════════════════════
create table revenue_entry (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  source_kind     text    not null check (source_kind in
                    ('green_sale','auction','dtc_order','subscription','pos_sale','milling_service','tour')),
  green_lot_code  text,                                      -- un-FK'd, like cost_entry.target_code
  amount_doc      numeric not null,                          -- signed: a reversal is negative
  currency        text    not null default 'USD',
  amount_usd      numeric not null,                          -- = amount_doc × fx_rate_used
  fx_rate_used    numeric not null default 1 check (fx_rate_used > 0),
  reverses_id     bigint  references revenue_entry(id),
  memo            text,
  occurred_at     timestamptz not null default now(),
  idempotency_key text,
  created_at      timestamptz not null default now(),
  -- a reversal is a negative-amount row; an original is non-negative.
  constraint revenue_entry_reversal_sign_chk check (
    (reverses_id is null and amount_doc >= 0) or (reverses_id is not null and amount_doc <= 0)
  ),
  -- NO OFF-BOOK RATE (the books invariant): the USD value MUST be the doc amount at the
  -- resolved FX rate. A 0.01 tolerance absorbs numeric rounding only.
  constraint revenue_entry_fx_consistency_chk check (abs(amount_usd - amount_doc * fx_rate_used) <= 0.01),
  -- a USD-settled row carries the identity rate.
  constraint revenue_entry_usd_identity_chk check (currency <> 'USD' or fx_rate_used = 1)
);
create index revenue_entry_tenant_idx on revenue_entry (tenant_id);
create index revenue_entry_lot_idx    on revenue_entry (green_lot_code);
create unique index revenue_entry_tenant_idem_ux
  on revenue_entry (tenant_id, idempotency_key) where idempotency_key is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. ar_doc — the AR instrument (gap-free per-kind doc_number minted by the S17 RPC).
--    status flows draft→issued→partially_paid→paid (or void) via the cap/recompute
--    triggers + the S17 RPCs — NEVER a manual client UPDATE (no UPDATE grant).
-- ════════════════════════════════════════════════════════════════════════════
create table ar_doc (
  id               bigint generated always as identity primary key,
  tenant_id        uuid    not null references tenants(id) default current_tenant_id(),
  kind             ar_doc_kind   not null,
  doc_number       text    not null,
  status           ar_doc_status not null default 'draft',
  incoterm         text,
  buyer_ref        text,                                     -- soft-ref to the B2B buyer (P3-S1)
  contract_ref     text,                                     -- soft-ref to the sales contract (P3-S1)
  total_doc        numeric not null check (total_doc >= 0),
  currency         text    not null default 'USD',
  total_usd        numeric not null check (total_usd >= 0),
  fx_rate_at_issue numeric not null default 1 check (fx_rate_at_issue > 0),
  issued_at        timestamptz not null default now(),
  idempotency_key  text,
  created_at       timestamptz not null default now(),
  -- gap-free per-kind numbering is per tenant.
  constraint ar_doc_tenant_kind_number_ux unique (tenant_id, kind, doc_number),
  -- composite key so children prove same-tenant by FK (the tenant-composite idiom).
  constraint ar_doc_id_tenant_uq unique (id, tenant_id)
);
create index ar_doc_tenant_idx on ar_doc (tenant_id);
create unique index ar_doc_tenant_idem_ux
  on ar_doc (tenant_id, idempotency_key) where idempotency_key is not null;

-- ar_doc_line — the line items (append-only; written at issue by the S17 RPC).
create table ar_doc_line (
  id             bigint generated always as identity primary key,
  tenant_id      uuid    not null references tenants(id) default current_tenant_id(),
  ar_doc_id      bigint  not null,
  green_lot_code text,
  description    text    not null,
  kg             numeric check (kg >= 0),
  unit_price_doc numeric not null check (unit_price_doc >= 0),
  amount_doc     numeric not null check (amount_doc >= 0),
  created_at     timestamptz not null default now(),
  constraint ar_doc_line_doc_tfk foreign key (ar_doc_id, tenant_id) references ar_doc(id, tenant_id)
);
create index ar_doc_line_tenant_idx on ar_doc_line (tenant_id);
create index ar_doc_line_doc_idx    on ar_doc_line (ar_doc_id);

-- ar_payment — append-only inbound cash. amount_usd_at_receipt snapshots the rate the
-- day the cash landed; the cap trigger forbids overpayment; the recompute trigger
-- derives ar_doc.status from Σ payments. The Stripe/Yappy webhook → settle RPC (S17)
-- calls with the gateway event id as the idempotency_key.
create table ar_payment (
  id                    bigint generated always as identity primary key,
  tenant_id             uuid    not null references tenants(id) default current_tenant_id(),
  ar_doc_id             bigint  not null,
  method                payment_method not null,
  amount_doc            numeric not null check (amount_doc > 0),
  currency              text    not null default 'USD',
  amount_usd_at_receipt numeric not null check (amount_usd_at_receipt > 0),
  fx_rate_at_receipt    numeric not null default 1 check (fx_rate_at_receipt > 0),
  received_at           timestamptz not null default now(),
  idempotency_key       text,
  created_at            timestamptz not null default now(),
  constraint ar_payment_doc_tfk foreign key (ar_doc_id, tenant_id) references ar_doc(id, tenant_id),
  constraint ar_payment_fx_consistency_chk check (abs(amount_usd_at_receipt - amount_doc * fx_rate_at_receipt) <= 0.01),
  constraint ar_payment_usd_identity_chk check (currency <> 'USD' or fx_rate_at_receipt = 1)
);
create index ar_payment_tenant_idx on ar_payment (tenant_id);
create index ar_payment_doc_idx    on ar_payment (ar_doc_id);
create unique index ar_payment_tenant_idem_ux
  on ar_payment (tenant_id, idempotency_key) where idempotency_key is not null;

-- fx_gain_loss_entry — append-only realized FX, the distinct P&L line. The booked
-- gain MUST trace to two rates (issue vs receipt) — a CHECK, not an honor system.
create table fx_gain_loss_entry (
  id                 bigint generated always as identity primary key,
  tenant_id          uuid    not null references tenants(id) default current_tenant_id(),
  ar_doc_id          bigint  not null,
  amount_doc         numeric not null,
  fx_rate_at_issue   numeric not null check (fx_rate_at_issue > 0),
  fx_rate_at_receipt numeric not null check (fx_rate_at_receipt > 0),
  gain_usd           numeric not null,
  occurred_at        timestamptz not null default now(),
  idempotency_key    text,
  created_at         timestamptz not null default now(),
  constraint fx_gain_loss_doc_tfk foreign key (ar_doc_id, tenant_id) references ar_doc(id, tenant_id),
  -- TWO-RATE TRACE: gain = amount × (receipt − issue). 0.01 tolerance for rounding only.
  constraint fx_gain_loss_two_rate_chk check (
    abs(gain_usd - amount_doc * (fx_rate_at_receipt - fx_rate_at_issue)) <= 0.01
  ),
  constraint fx_gain_loss_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index fx_gain_loss_tenant_idx on fx_gain_loss_entry (tenant_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Append-only immutability triggers (cost_entry_immutable() style). NOT security
--    definer (they run as the table owner via the trigger mechanism) — so they are
--    excluded from the AD-8 revoke/grant requirement for caller-facing RPCs.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function _accounting_ledger_immutable() returns trigger
  language plpgsql set search_path = public
as $$
begin
  raise exception
    '% is append-only: % is not permitted — post a correcting/reversing row instead',
    tg_table_name, tg_op
    using errcode = 'restrict_violation';
end $$;
revoke execute on function _accounting_ledger_immutable() from public;

create trigger fx_rate_no_update            before update on fx_rate            for each row execute function _accounting_ledger_immutable();
create trigger fx_rate_no_delete            before delete on fx_rate            for each row execute function _accounting_ledger_immutable();
create trigger revenue_entry_no_update      before update on revenue_entry      for each row execute function _accounting_ledger_immutable();
create trigger revenue_entry_no_delete      before delete on revenue_entry      for each row execute function _accounting_ledger_immutable();
create trigger ar_doc_line_no_update        before update on ar_doc_line        for each row execute function _accounting_ledger_immutable();
create trigger ar_doc_line_no_delete        before delete on ar_doc_line        for each row execute function _accounting_ledger_immutable();
create trigger ar_payment_no_update         before update on ar_payment         for each row execute function _accounting_ledger_immutable();
create trigger ar_payment_no_delete         before delete on ar_payment         for each row execute function _accounting_ledger_immutable();
create trigger fx_gain_loss_no_update       before update on fx_gain_loss_entry for each row execute function _accounting_ledger_immutable();
create trigger fx_gain_loss_no_delete       before delete on fx_gain_loss_entry for each row execute function _accounting_ledger_immutable();

-- ════════════════════════════════════════════════════════════════════════════
-- 5. revenue_entry off-book-rate guard — fx_rate_used must be an ON-BOOK rate for a
--    non-USD currency (no off-book rate enters the journal). Fires on EVERY insert
--    path, so the guard is the data layer, not just the (future S17) RPC.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function _revenue_entry_fx_on_book() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if new.currency is distinct from 'USD' then
    if not exists (
      select 1 from fx_rate r
       where r.tenant_id = new.tenant_id
         and r.base = new.currency and r.quote = 'USD'
         and abs(r.rate - new.fx_rate_used) <= 1e-9
    ) then
      raise exception
        'off-book FX: no fx_rate row for %→USD at rate % (record the rate first)',
        new.currency, new.fx_rate_used
        using errcode = 'foreign_key_violation';
    end if;
  end if;
  return new;
end $$;
revoke execute on function _revenue_entry_fx_on_book() from public;
create trigger revenue_entry_fx_on_book before insert on revenue_entry
  for each row execute function _revenue_entry_fx_on_book();

-- ════════════════════════════════════════════════════════════════════════════
-- 6. ar_payment cap + deterministic status. The cap trigger forbids Σ payments from
--    exceeding the doc total (a scarce-invoice can't be double-collected); the
--    recompute trigger DERIVES ar_doc.status from the paid sum — there is no manual
--    'paid' path (clients hold no UPDATE grant on ar_doc).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function _ar_payment_cap() returns trigger
  language plpgsql set search_path = public
as $$
declare
  v_total  numeric;
  v_status ar_doc_status;
  v_paid   numeric;
begin
  select total_doc, status into v_total, v_status
    from ar_doc where id = new.ar_doc_id and tenant_id = new.tenant_id;
  if not found then
    raise exception 'unknown ar_doc % for tenant', new.ar_doc_id using errcode = 'foreign_key_violation';
  end if;
  if v_status = 'void' then
    raise exception 'ar_doc % is void — it cannot accept a payment', new.ar_doc_id
      using errcode = 'check_violation';
  end if;
  select coalesce(sum(amount_doc), 0) into v_paid
    from ar_payment where ar_doc_id = new.ar_doc_id and tenant_id = new.tenant_id;
  if v_paid + new.amount_doc > v_total + 0.01 then
    raise exception
      'overpayment: paid % + % would exceed doc total %', v_paid, new.amount_doc, v_total
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke execute on function _ar_payment_cap() from public;
create trigger ar_payment_cap before insert on ar_payment
  for each row execute function _ar_payment_cap();

create or replace function _ar_payment_recompute_status() returns trigger
  language plpgsql set search_path = public
as $$
declare
  v_total numeric;
  v_paid  numeric;
begin
  select total_doc into v_total from ar_doc where id = new.ar_doc_id and tenant_id = new.tenant_id;
  select coalesce(sum(amount_doc), 0) into v_paid
    from ar_payment where ar_doc_id = new.ar_doc_id and tenant_id = new.tenant_id;
  update ar_doc
     set status = case
                    when v_paid >= v_total - 0.01 then 'paid'
                    when v_paid > 0               then 'partially_paid'
                    else 'issued'
                  end::ar_doc_status
   where id = new.ar_doc_id and tenant_id = new.tenant_id;
  return new;
end $$;
revoke execute on function _ar_payment_recompute_status() from public;
create trigger ar_payment_recompute_status after insert on ar_payment
  for each row execute function _ar_payment_recompute_status();

-- ════════════════════════════════════════════════════════════════════════════
-- 7. record_fx_rate — the ONLY fx_rate writer. SECURITY DEFINER, tenant-clamped,
--    idempotent on a tenant-qualified key. The free ECB daily feed (a Supabase
--    scheduled fn, NOT a paid FX API) calls this; manual entry is the $0 fallback.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function record_fx_rate(
  p_as_of           date,
  p_base            text,
  p_quote           text,
  p_rate            numeric,
  p_source          text,
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
  select id into v_id from fx_rate where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then
    return v_id;                                  -- exactly-once replay
  end if;
  insert into fx_rate (tenant_id, as_of_date, base, quote, rate, source, idempotency_key)
  values (v_tenant, p_as_of, p_base, coalesce(p_quote, 'USD'), p_rate, coalesce(p_source, 'manual'), v_key)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function record_fx_rate(date, text, text, numeric, text, text) from public;
grant   execute on function record_fx_rate(date, text, text, numeric, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. Read views + fx_attribution (security_invoker — inherit caller RLS).
-- ════════════════════════════════════════════════════════════════════════════

-- 8a. v_ar_aging — per AR doc: total, paid, balance, days outstanding, aging bucket.
create view v_ar_aging with (security_invoker = on) as
  select
    d.tenant_id,
    d.id                                                as ar_doc_id,
    d.kind,
    d.doc_number,
    d.status,
    d.total_usd,
    coalesce((select sum(p.amount_usd_at_receipt) from ar_payment p
               where p.ar_doc_id = d.id and p.tenant_id = d.tenant_id), 0) as paid_usd,
    d.total_usd
      - coalesce((select sum(p.amount_usd_at_receipt) from ar_payment p
                   where p.ar_doc_id = d.id and p.tenant_id = d.tenant_id), 0) as balance_usd,
    d.issued_at,
    greatest(0, (extract(epoch from (now() - d.issued_at)) / 86400)::int) as days_outstanding,
    case
      when extract(epoch from (now() - d.issued_at)) / 86400 <= 30  then '0-30'
      when extract(epoch from (now() - d.issued_at)) / 86400 <= 60  then '31-60'
      when extract(epoch from (now() - d.issued_at)) / 86400 <= 90  then '61-90'
      else '90+'
    end                                                 as aging_bucket
  from ar_doc d;

-- 8b. v_lot_margin — THE number that closes the loop: realized $/kg-green margin =
--     Σ revenue_usd / green-kg − cost_per_kg_green. Reads mv_lot_cost_secure (the
--     tenant-filtered COGS surface). NULL cost ⇒ NULL margin (flagged, never faked).
create view v_lot_margin with (security_invoker = on) as
  with rev as (
    select tenant_id, green_lot_code, sum(amount_usd) as revenue_usd
      from revenue_entry
     where green_lot_code is not null
     group by tenant_id, green_lot_code
  )
  select
    r.tenant_id,
    r.green_lot_code,
    r.revenue_usd,
    m.green_kg,
    m.total_cost,
    m.cost_per_kg_green,
    case when m.green_kg is null or m.green_kg = 0 then null
         else r.revenue_usd / m.green_kg end                              as revenue_per_kg_green,
    case when m.cost_per_kg_green is null or m.green_kg is null or m.green_kg = 0 then null
         else (r.revenue_usd / m.green_kg) - m.cost_per_kg_green end       as margin_per_kg_green,
    case when m.total_cost is null then null
         else r.revenue_usd - m.total_cost end                            as margin_usd
  from rev r
  left join mv_lot_cost_secure m
    on m.tenant_id = r.tenant_id and m.green_lot_code = r.green_lot_code;

-- 8c. fx_attribution(from, to) — the realized FX P&L over a window. security_invoker
--     + an explicit current_tenant_id() clamp (defence-in-depth over RLS).
create or replace function fx_attribution(p_from date, p_to date)
  returns table(period_from date, period_to date, realized_fx_gain_usd numeric, entries integer)
  language sql security invoker stable set search_path = public
as $$
  select p_from, p_to,
         coalesce(sum(gain_usd), 0)::numeric,
         count(*)::int
    from fx_gain_loss_entry
   where tenant_id = current_tenant_id()
     and occurred_at::date between p_from and p_to;
$$;
revoke execute on function fx_attribution(date, date) from public;
grant   execute on function fx_attribution(date, date) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. RLS — tenant-scoped read on every new table (mirrors the P4-S0 idiom). The AR
--    instrument tables are RPC-only writes (P3-S17), so NO insert/update/delete
--    policy. revenue_entry mirrors cost_entry's append posture — a "tenant insert"
--    policy gives the commerce slices the direct journal-append door.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array[
    'fx_rate','revenue_entry','ar_doc','ar_doc_line','ar_payment','fx_gain_loss_entry'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'create policy "tenant read" on public.%I for select to authenticated
         using (tenant_id = current_tenant_id());', t);
  end loop;
end $$;

-- revenue_entry is the journal source the commerce slices append through (mirrors
-- cost_entry's INSERT posture) — a tenant-scoped insert policy + grant; the
-- immutability trigger blocks UPDATE/DELETE even for the owner.
create policy "tenant append" on public.revenue_entry for insert to authenticated
  with check (tenant_id = current_tenant_id());

-- ════════════════════════════════════════════════════════════════════════════
-- 10. GRANTS (AD-8) — per-object SELECT to authenticated on every table/view (one
--     statement each so the name-anchored static guard matches). revenue_entry also
--     gets INSERT (the one legal append). anon gets NOTHING.
-- ════════════════════════════════════════════════════════════════════════════
grant select on fx_rate            to authenticated;
grant select on revenue_entry      to authenticated;
grant select on ar_doc             to authenticated;
grant select on ar_doc_line        to authenticated;
grant select on ar_payment         to authenticated;
grant select on fx_gain_loss_entry to authenticated;
grant select on v_ar_aging         to authenticated;
grant select on v_lot_margin       to authenticated;

grant insert on revenue_entry to authenticated;

commit;
