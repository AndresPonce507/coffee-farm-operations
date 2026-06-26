-- ════════════════════════════════════════════════════════════════════════════
-- P3-S18 · Direct-trade CRM — contacts + append-only relationship ledger +
--          sample dispatches (the trust backbone).
-- ════════════════════════════════════════════════════════════════════════════
-- Spec: docs/design/PHASE3-DESIGN.md lines 389–402 (+ §1 cross-slice rails).
-- Depends (HARD): Phase-1 green inventory (green_lots / green_lots_atp /
--                 lot_reservations / lot_shipments / prevent_oversell /
--                 lots_conserve_mass_vs_claims); lot_event / record_lot_event /
--                 lot_event_canonical_bytes / verify_chain; convert_qty; P3-S1
--                 b2b_buyers (the CRM additively EXTENDS the B2B master).
-- Soft: qc_holds / _prevent_held_lot_commit (a held lot is also un-sampleable).
--
-- THIS SLICE DOES THREE LOAD-BEARING THINGS, all test-first:
--
--  1. EXTRACTS event_set_hash() ADDITIVELY. The hash-chain digest formula was
--     inlined inside lot_event_set_hash (and its tenant siblings). This slice is the
--     first that needs a SECOND lot-style ledger (contact_events), so it lifts the
--     digest into a shared event_set_hash() util and re-points lot_event_set_hash at
--     it. The recomputation is BYTE-IDENTICAL (same canonical bytes, same sha256), so
--     every historical lot_event chain + verify_chain keeps passing — NOT a rewrite.
--
--  2. EXTENDS THE MONEY GUARANTEE to a THIRD claim term. A B2B sample is real green
--     leaving inventory, so sample_dispatches is a first-class oversell-guarded claim
--     table ALONGSIDE lot_reservations + lot_shipments. prevent_oversell,
--     lots_conserve_mass_vs_claims, and green_lots_atp ALL gain the third coalesce-sum.
--     The Phase-1 guarantee is REUSED (the same per-lot advisory lock serializes; the
--     same _prevent_held_lot_commit fires) — NO parallel counter. A free sample can
--     never silently consume inventory a paid buyer reserved; ATP never goes negative.
--
--  3. ADDS A PII-BEARING, HASH-CHAINED RELATIONSHIP LEDGER (contact_events) with its
--     own RLS surface + its own verify_chain branch ('contact:%'), and the mutable
--     contacts anchor (consent fields — GDPR/CAN-SPAM lawful basis; lifetime_value
--     DERIVED in v_contact_directory, never a stored counter).
--
-- Rails honored (§1): one write door (upsert_contact / record_contact_event /
-- record_sample_dispatch / record_sample_feedback are SECURITY DEFINER,
-- set search_path = public, extensions, tenant-clamped, idempotent on a
-- tenant-qualified key, appending the relevant event in the SAME txn). AD-8/AD-9
-- grants exactly (per-object grant select to authenticated; revoke-then-grant on every
-- caller-facing RPC; anon gets NOTHING). Tenant seam (tenant_id + current_tenant_id()
-- default + RLS on every new table). grams→kg via convert_qty (never a hardcoded /1000).
-- No untrusted inbound drives a write — the inbound adapter would only ever call
-- record_contact_event (evidence), never the money-shaped record_sample_dispatch.

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Enums — the CRM vocabulary.
-- ════════════════════════════════════════════════════════════════════════════
create type contact_kind as enum
  ('roaster', 'importer', 'agent', 'distributor', 'retailer', 'press', 'individual', 'other');
create type contact_status as enum
  ('lead', 'prospect', 'active', 'dormant', 'lost');
create type comm_channel as enum
  ('email', 'phone', 'whatsapp', 'meeting', 'event', 'other');
create type contact_event_kind as enum
  ('inquiry', 'sample_requested', 'sample_sent', 'sample_feedback', 'quote_sent',
   'meeting', 'call', 'note', 'consent_granted', 'consent_withdrawn');

-- ════════════════════════════════════════════════════════════════════════════
-- 2. event_set_hash — the GENERALIZED hash-chain digest, extracted ADDITIVELY.
--    Pure (immutable) so it is safe in any context; the canonical bytes + sha256 are
--    IDENTICAL to the formula previously inlined in lot_event_set_hash, so re-pointing
--    that trigger at it produces byte-identical hashes (verify_chain unchanged). It is
--    NOT security definer (no table access) → it carries a revoke-from-public for
--    hygiene but no grant (used only by trigger fns running as the owner).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function event_set_hash(
  p_prev_hash   bytea,
  p_stream_key  text,
  p_kind        text,
  p_payload     jsonb,
  p_occurred_at timestamptz,
  p_device_id   text,
  p_device_seq  bigint
) returns bytea
  language sql
  immutable
  set search_path = public, extensions
as $$
  select extensions.digest(
    coalesce(p_prev_hash, ''::bytea)
      || lot_event_canonical_bytes(p_stream_key, p_kind, p_payload,
                                   p_occurred_at, p_device_id, p_device_seq),
    'sha256');
$$;
revoke execute on function event_set_hash(bytea, text, text, jsonb, timestamptz, text, bigint) from public;

-- Re-point lot_event_set_hash at the shared util (ADDITIVE — the tenant assert + the
-- tenant-scoped head-select from P4-S0 are PRESERVED verbatim; only the digest line
-- now delegates). Byte-identical output ⇒ all existing lot_event chains still verify.
create or replace function lot_event_set_hash() returns trigger
  language plpgsql
  set search_path = public, extensions
as $$
declare head bytea;
begin
  if new.tenant_id is distinct from current_tenant_id() then
    raise exception 'ledger tenant_id % does not match session tenant', new.tenant_id
      using errcode = 'insufficient_privilege';
  end if;
  select e.hash into head from lot_event e
   where e.stream_key = new.stream_key and e.tenant_id = new.tenant_id
   order by e.device_seq desc limit 1;
  new.prev_hash := head;
  new.hash := event_set_hash(new.prev_hash, new.stream_key, new.kind, new.payload,
                             new.occurred_at, new.device_id, new.device_seq);
  return new;
end $$;
revoke execute on function lot_event_set_hash() from public;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. contacts — the MUTABLE CRM anchor (set_updated_at reused). RPC-only writes at
--    the client boundary (no insert/update grant). buyer_id binds the contact to the
--    P3-S1 b2b_buyers master (the reviewer reconciliation point). Consent fields carry
--    the GDPR/CAN-SPAM lawful basis; a true marketing-consent MUST carry a source
--    (data-layer CHECK, not an honor system). lifetime_value_usd is DERIVED in
--    v_contact_directory — never stored here.
-- ════════════════════════════════════════════════════════════════════════════
create table contacts (
  id                bigint generated always as identity primary key,
  tenant_id         uuid    not null references tenants(id) default current_tenant_id(),
  buyer_id          bigint  references b2b_buyers(id),          -- the b2b master link
  name              text    not null,
  kind              contact_kind   not null,
  status            contact_status not null default 'lead',
  country_code      text,
  email             text,
  phone             text,
  preferred_channel comm_channel,
  consent_marketing boolean not null default false,
  consent_source    text,
  consent_at        timestamptz,
  unsubscribed_at   timestamptz,
  idempotency_key   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- lawful basis: a marketing-consent=true row MUST name its consent_source.
  constraint contacts_consent_complete_chk
    check (consent_marketing = false or consent_source is not null),
  constraint contacts_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index contacts_tenant_idx on contacts (tenant_id);
create index contacts_buyer_idx  on contacts (tenant_id, buyer_id);
create trigger contacts_set_updated_at before update on contacts
  for each row execute function set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- 4. contact_events — the APPEND-ONLY, HASH-CHAINED relationship ledger (PII-bearing).
--    Mirrors lot_event's column shape; its hash trigger uses the shared event_set_hash.
--    Its own stream namespace 'contact:<id>' (verify_chain gains a 'contact:%' branch).
-- ════════════════════════════════════════════════════════════════════════════
create table contact_events (
  event_uid       uuid        primary key default gen_random_uuid(),
  tenant_id       uuid        not null references tenants(id) default current_tenant_id(),
  contact_id      bigint      not null references contacts(id),
  idempotency_key text        unique,
  stream_key      text        not null,                 -- 'contact:<contact_id>'
  kind            contact_event_kind not null,
  payload         jsonb       not null default '{}'::jsonb
                    check (octet_length(payload::text) < 4096),
  occurred_at     timestamptz not null,
  recorded_at     timestamptz not null default now(),
  device_id       text        not null,
  device_seq      bigint      not null,
  prev_hash       bytea,
  hash            bytea,
  unique (device_id, device_seq)                        -- replay safety
);
create index contact_events_tenant_idx on contact_events (tenant_id);
create index contact_events_stream_idx on contact_events (stream_key, device_seq);
create index contact_events_contact_idx on contact_events (tenant_id, contact_id);
create unique index contact_events_tenant_idem_ux
  on contact_events (tenant_id, idempotency_key) where idempotency_key is not null;

-- hash trigger (tenant assert + tenant-scoped head-select; delegates to event_set_hash).
create or replace function _contact_event_set_hash() returns trigger
  language plpgsql
  set search_path = public, extensions
as $$
declare head bytea;
begin
  if new.tenant_id is distinct from current_tenant_id() then
    raise exception 'ledger tenant_id % does not match session tenant', new.tenant_id
      using errcode = 'insufficient_privilege';
  end if;
  select e.hash into head from contact_events e
   where e.stream_key = new.stream_key and e.tenant_id = new.tenant_id
   order by e.device_seq desc limit 1;
  new.prev_hash := head;
  new.hash := event_set_hash(new.prev_hash, new.stream_key, new.kind::text, new.payload,
                             new.occurred_at, new.device_id, new.device_seq);
  return new;
end $$;
create trigger contact_events_set_hash before insert on contact_events
  for each row execute function _contact_event_set_hash();
revoke execute on function _contact_event_set_hash() from public;

-- immutability — append-only at the data layer (even the owner cannot mutate; a
-- correction is a superseding event). Leading-underscore trigger fn (no grant).
create or replace function _contact_events_immutable() returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  raise exception
    'contact_events is append-only: % is not permitted — post a superseding event instead', tg_op
    using errcode = 'restrict_violation';
end $$;
create trigger contact_events_no_update before update on contact_events
  for each row execute function _contact_events_immutable();
create trigger contact_events_no_delete before delete on contact_events
  for each row execute function _contact_events_immutable();
revoke execute on function _contact_events_immutable() from public;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. sample_dispatches — the THIRD oversell-guarded claim table. A B2B sample is real
--    green leaving inventory, so kg is an ATP claim (grams→kg via convert_qty). Mirrors
--    lot_shipments; prevent_oversell + _prevent_held_lot_commit fire on it (triggers
--    attached in §7 once the recreated functions count it). RPC-only writes; append-only
--    at the client boundary. Composite FK into the owning tenant's green lot.
-- ════════════════════════════════════════════════════════════════════════════
create table sample_dispatches (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  green_lot_code  text    not null,
  contact_id      bigint  not null references contacts(id),
  destination     text    not null,
  grams           numeric not null check (grams > 0),
  kg              numeric not null check (kg > 0),               -- the ATP draw
  courier         text,
  tracking_no     text,
  dispatched_at   timestamptz not null default now(),
  idempotency_key text,
  created_at      timestamptz not null default now(),
  constraint sample_dispatches_green_lot_tfk
    foreign key (tenant_id, green_lot_code) references green_lots(tenant_id, lot_code),
  constraint sample_dispatches_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index sample_dispatches_tenant_idx  on sample_dispatches (tenant_id);
create index sample_dispatches_lot_idx      on sample_dispatches (tenant_id, green_lot_code);
create index sample_dispatches_contact_idx  on sample_dispatches (tenant_id, contact_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Progressive binding (additive, nullable) — bind the free-text buyer/destination
--    on the Phase-1 claim tables to a structured contact. FLAG: a full FK-required
--    cutover (NOT NULL contact_id everywhere) is a later gated change; here the column
--    is nullable groundwork that lets lifetime_value_usd derive off accepted quotes.
-- ════════════════════════════════════════════════════════════════════════════
alter table lot_reservations add column contact_id bigint references contacts(id);
alter table lot_shipments    add column contact_id bigint references contacts(id);

-- ════════════════════════════════════════════════════════════════════════════
-- 7. EXTEND THE MONEY GUARANTEE — recreate the Phase-1 oversell family to count
--    sample_dispatches as a THIRD claim term. The bodies are the P4-S0 tenant-clamped
--    versions PLUS one coalesce-sum; the per-lot advisory lock already serializes all
--    three claim tables. NOT a parallel counter — the SAME guard, one term wider.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function prevent_oversell() returns trigger
  language plpgsql
  set search_path = public
as $$
declare avail numeric; committed numeric;
begin
  perform pg_advisory_xact_lock(
    hashtext('green_lot:' || new.tenant_id::text || ':' || new.green_lot_code));
  select coalesce(current_kg, origin_kg) into avail
    from lots where code = new.green_lot_code and tenant_id = new.tenant_id;
  if avail is null then
    raise exception
      'oversell guard: green lot % has no declared mass; cannot commit % kg',
      new.green_lot_code, new.kg using errcode = 'check_violation';
  end if;
  select
    coalesce((select sum(kg) from lot_reservations
               where green_lot_code = new.green_lot_code and tenant_id = new.tenant_id
                 and not (tg_table_name = 'lot_reservations' and tg_op = 'UPDATE' and id = new.id)), 0)
  + coalesce((select sum(kg) from lot_shipments
               where green_lot_code = new.green_lot_code and tenant_id = new.tenant_id
                 and not (tg_table_name = 'lot_shipments' and tg_op = 'UPDATE' and id = new.id)), 0)
  + coalesce((select sum(kg) from sample_dispatches
               where green_lot_code = new.green_lot_code and tenant_id = new.tenant_id
                 and not (tg_table_name = 'sample_dispatches' and tg_op = 'UPDATE' and id = new.id)), 0)
    into committed;
  if committed + new.kg > avail + 1e-9 then
    raise exception
      'oversell guard: committing % kg to green lot % would exceed its % kg available-to-promise (% already committed)',
      new.kg, new.green_lot_code, avail, committed using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke execute on function prevent_oversell() from public;

create or replace function lots_conserve_mass_vs_claims() returns trigger
  language plpgsql
  set search_path = public
as $$
declare new_kg numeric; committed numeric;
begin
  new_kg := coalesce(new.current_kg, new.origin_kg);
  select
    coalesce((select sum(kg) from lot_reservations
               where green_lot_code = new.code and tenant_id = new.tenant_id), 0)
  + coalesce((select sum(kg) from lot_shipments
               where green_lot_code = new.code and tenant_id = new.tenant_id), 0)
  + coalesce((select sum(kg) from sample_dispatches
               where green_lot_code = new.code and tenant_id = new.tenant_id), 0)
    into committed;
  if committed <= 1e-9 then return new; end if;
  if new_kg is null then
    raise exception
      'oversell guard: cannot clear green lot %''s mass while % kg is committed against it',
      new.code, committed using errcode = 'check_violation';
  end if;
  if new_kg < committed - 1e-9 then
    raise exception
      'oversell guard: cannot lower green lot %''s mass to % kg — % kg is already committed against it (would oversell)',
      new.code, new_kg, committed using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke execute on function lots_conserve_mass_vs_claims() from public;

-- Attach BOTH Phase-1 guards to the new claim table (the family is now three tables).
create trigger sample_dispatches_prevent_oversell
  before insert or update on sample_dispatches
  for each row execute function prevent_oversell();
create trigger sample_dispatches_prevent_held_commit
  before insert or update on sample_dispatches
  for each row execute function _prevent_held_lot_commit();

-- green_lots_atp — same first 7 columns (so create-or-replace is legal), atp now nets
-- the sample draw too, and a new sampled_kg column is appended.
create or replace view green_lots_atp with (security_invoker = on) as
  select
    g.lot_code                                          as green_lot_code,
    g.sca_grade,
    g.location,
    coalesce(l.current_kg, l.origin_kg, 0)::numeric     as current_kg,
    coalesce((select sum(kg) from lot_reservations r
               where r.green_lot_code = g.lot_code and r.tenant_id = g.tenant_id), 0)::numeric as reserved_kg,
    coalesce((select sum(kg) from lot_shipments s
               where s.green_lot_code = g.lot_code and s.tenant_id = g.tenant_id), 0)::numeric as shipped_kg,
    (coalesce(l.current_kg, l.origin_kg, 0)
       - coalesce((select sum(kg) from lot_reservations r where r.green_lot_code = g.lot_code and r.tenant_id = g.tenant_id), 0)
       - coalesce((select sum(kg) from lot_shipments    s where s.green_lot_code = g.lot_code and s.tenant_id = g.tenant_id), 0)
       - coalesce((select sum(kg) from sample_dispatches d where d.green_lot_code = g.lot_code and d.tenant_id = g.tenant_id), 0)
    )::numeric                                          as atp,
    coalesce((select sum(kg) from sample_dispatches d
               where d.green_lot_code = g.lot_code and d.tenant_id = g.tenant_id), 0)::numeric as sampled_kg
  from green_lots g
  join lots l on l.code = g.lot_code and l.tenant_id = g.tenant_id;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. verify_chain — gains a 'contact:%' branch (additive; all other branches verbatim)
--    so a contact's relationship timeline is chain-verifiable just like a lot stream.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function verify_chain(stream_key text)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = public, extensions
as $$
declare
  v_tenant    uuid := current_tenant_id();
  r           record;
  expect_prev bytea := null;
  recomputed  bytea;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  if verify_chain.stream_key like 'attendance:%' then
    for r in
      select * from attendance_event e
       where e.stream_key = verify_chain.stream_key and e.tenant_id = v_tenant
       order by e.device_seq
    loop
      if r.prev_hash is distinct from expect_prev then return false; end if;
      recomputed := event_set_hash(r.prev_hash, r.stream_key, r.event_kind, r.payload,
                                   r.occurred_at, r.device_id, r.device_seq);
      if recomputed is distinct from r.hash then return false; end if;
      expect_prev := recomputed;
    end loop;
    return true;
  elsif verify_chain.stream_key like 'worker:%' then
    for r in
      select * from worker_stream_event e
       where e.stream_key = verify_chain.stream_key and e.tenant_id = v_tenant
       order by e.device_seq
    loop
      if r.prev_hash is distinct from expect_prev then return false; end if;
      recomputed := event_set_hash(r.prev_hash, r.stream_key, r.kind, r.payload,
                                   r.occurred_at, r.device_id, r.device_seq);
      if recomputed is distinct from r.hash then return false; end if;
      expect_prev := recomputed;
    end loop;
    return true;
  elsif verify_chain.stream_key like 'contact:%' then
    for r in
      select * from contact_events e
       where e.stream_key = verify_chain.stream_key and e.tenant_id = v_tenant
       order by e.device_seq
    loop
      if r.prev_hash is distinct from expect_prev then return false; end if;
      recomputed := event_set_hash(r.prev_hash, r.stream_key, r.kind::text, r.payload,
                                   r.occurred_at, r.device_id, r.device_seq);
      if recomputed is distinct from r.hash then return false; end if;
      expect_prev := recomputed;
    end loop;
    return true;
  else
    for r in
      select * from lot_event e
       where e.stream_key = verify_chain.stream_key and e.tenant_id = v_tenant
       order by e.device_seq
    loop
      if r.prev_hash is distinct from expect_prev then return false; end if;
      recomputed := event_set_hash(r.prev_hash, r.stream_key, r.kind, r.payload,
                                   r.occurred_at, r.device_id, r.device_seq);
      if recomputed is distinct from r.hash then return false; end if;
      expect_prev := recomputed;
    end loop;
    return true;
  end if;
end $$;
revoke execute on function verify_chain(text) from public;
grant   execute on function verify_chain(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. _append_contact_event — the internal contact-ledger writer (owner-only; never a
--    caller-facing RPC). Idempotent on the (already tenant-qualified) key supplied by
--    the command RPCs; stamps device_id='server' + a global lot_code_seq device_seq.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function _append_contact_event(
  p_contact_id      bigint,
  p_kind            text,
  p_payload         jsonb,
  p_idempotency_key text
) returns uuid
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  v_tenant   uuid := current_tenant_id();
  v_existing uuid;
  v_uid      uuid;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  select event_uid into v_existing from contact_events
   where idempotency_key = p_idempotency_key and tenant_id = v_tenant;
  if v_existing is not null then return v_existing; end if;

  insert into contact_events (tenant_id, contact_id, stream_key, kind, payload,
                              occurred_at, device_id, device_seq, idempotency_key)
  values (v_tenant, p_contact_id, 'contact:' || p_contact_id::text, p_kind::contact_event_kind,
          coalesce(p_payload, '{}'::jsonb), now(), 'server', nextval('lot_code_seq'),
          p_idempotency_key)
  on conflict (idempotency_key) do nothing
  returning event_uid into v_uid;
  if v_uid is null then
    select event_uid into v_uid from contact_events
     where idempotency_key = p_idempotency_key and tenant_id = v_tenant;
  end if;
  return v_uid;
end $$;
revoke execute on function _append_contact_event(bigint, text, jsonb, text) from public;

-- ════════════════════════════════════════════════════════════════════════════
-- 10. upsert_contact — the ONLY contacts writer. Create (p_contact_id null) or update.
--     Idempotent create on the tenant-qualified key. consent_marketing=true REQUIRES a
--     consent_source; a consent FLIP appends a 'consent_granted'/'consent_withdrawn'
--     event (the auditable lawful-basis trail).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function upsert_contact(
  p_contact_id        bigint,
  p_name              text,
  p_kind              text,
  p_status            text,
  p_country_code      text,
  p_email             text,
  p_phone             text,
  p_buyer_id          bigint,
  p_consent_marketing boolean,
  p_consent_source    text,
  p_idempotency_key   text
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  v_tenant      uuid := current_tenant_id();
  v_key         text;
  v_id          bigint;
  v_old_consent boolean;
  v_consent     boolean := coalesce(p_consent_marketing, false);
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  -- idempotent create: a replay with the same key returns the original contact.
  select id into v_id from contacts where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then return v_id; end if;

  if v_consent and (p_consent_source is null or btrim(p_consent_source) = '') then
    raise exception 'marketing consent requires a consent_source (lawful basis)'
      using errcode = 'check_violation';
  end if;
  if p_buyer_id is not null
     and not exists (select 1 from b2b_buyers where id = p_buyer_id and tenant_id = v_tenant) then
    raise exception 'unknown buyer % for tenant', p_buyer_id using errcode = 'foreign_key_violation';
  end if;

  if p_contact_id is null then
    insert into contacts (tenant_id, buyer_id, name, kind, status, country_code, email, phone,
                          consent_marketing, consent_source, consent_at, idempotency_key)
    values (v_tenant, p_buyer_id, p_name, p_kind::contact_kind,
            coalesce(p_status, 'lead')::contact_status, p_country_code, p_email, p_phone,
            v_consent, p_consent_source,
            case when v_consent then now() else null end, v_key)
    returning id into v_id;
    if v_consent then
      perform _append_contact_event(v_id, 'consent_granted',
        jsonb_build_object('consent_source', p_consent_source), v_key || ':consent');
    end if;
  else
    select consent_marketing into v_old_consent
      from contacts where id = p_contact_id and tenant_id = v_tenant;
    if not found then
      raise exception 'unknown contact % for tenant', p_contact_id using errcode = 'foreign_key_violation';
    end if;
    update contacts set
      name              = p_name,
      kind              = p_kind::contact_kind,
      status            = coalesce(p_status, status::text)::contact_status,
      country_code      = p_country_code,
      email             = p_email,
      phone             = p_phone,
      buyer_id          = p_buyer_id,
      consent_marketing = v_consent,
      consent_source    = case when v_consent then p_consent_source else consent_source end,
      consent_at        = case when v_consent and not v_old_consent then now() else consent_at end,
      unsubscribed_at   = case when v_old_consent and not v_consent then now() else unsubscribed_at end
     where id = p_contact_id and tenant_id = v_tenant;
    v_id := p_contact_id;
    if v_consent and not v_old_consent then
      perform _append_contact_event(v_id, 'consent_granted',
        jsonb_build_object('consent_source', p_consent_source), v_key || ':consent');
    elsif v_old_consent and not v_consent then
      perform _append_contact_event(v_id, 'consent_withdrawn', '{}'::jsonb, v_key || ':consent');
    end if;
  end if;

  return v_id;
end $$;
revoke execute on function upsert_contact(bigint, text, text, text, text, text, text, bigint, boolean, text, text) from public;
grant   execute on function upsert_contact(bigint, text, text, text, text, text, text, bigint, boolean, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 11. record_contact_event — log a relationship event onto the contact's timeline.
--     Consent kinds are REFUSED here (consent state can only change via upsert_contact,
--     which flips the contacts flag AND appends the event — never forged independently).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function record_contact_event(
  p_contact_id      bigint,
  p_kind            text,
  p_payload         jsonb,
  p_idempotency_key text
) returns uuid
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare v_tenant uuid := current_tenant_id(); v_key text;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  if p_kind in ('consent_granted', 'consent_withdrawn') then
    raise exception 'consent events are written only via upsert_contact, not record_contact_event'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from contacts where id = p_contact_id and tenant_id = v_tenant) then
    raise exception 'unknown contact % for tenant', p_contact_id using errcode = 'foreign_key_violation';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;
  return _append_contact_event(p_contact_id, p_kind, p_payload, v_key);
end $$;
revoke execute on function record_contact_event(bigint, text, jsonb, text) from public;
grant   execute on function record_contact_event(bigint, text, jsonb, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 12. record_sample_dispatch — the money-shaped write door. Inserts the oversell-
--     guarded dispatch (grams→kg via convert_qty → prevent_oversell + held-lot guard
--     fire for free), appends a 'sample_dispatched' lot_event onto the GREEN LOT's
--     provenance chain AND a 'sample_sent' event onto the CONTACT's timeline — all in
--     one txn. Idempotent on the tenant-qualified key.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function record_sample_dispatch(
  p_green_lot_code  text,
  p_contact_id      bigint,
  p_grams           numeric,
  p_courier         text,
  p_tracking_no     text,
  p_idempotency_key text
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_id     bigint;
  v_kg     numeric;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select id into v_id from sample_dispatches
   where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then return v_id; end if;

  if not exists (select 1 from contacts where id = p_contact_id and tenant_id = v_tenant) then
    raise exception 'unknown contact % for tenant', p_contact_id using errcode = 'foreign_key_violation';
  end if;
  if not exists (select 1 from green_lots where lot_code = p_green_lot_code and tenant_id = v_tenant) then
    raise exception 'unknown green lot % for tenant', p_green_lot_code using errcode = 'foreign_key_violation';
  end if;

  v_kg := convert_qty(p_grams, 'g', 'kg');   -- never a hardcoded /1000

  -- The oversell-guarded claim INSERT (prevent_oversell + _prevent_held_lot_commit fire).
  insert into sample_dispatches (tenant_id, green_lot_code, contact_id, destination,
                                 grams, kg, courier, tracking_no, idempotency_key)
  values (v_tenant, p_green_lot_code, p_contact_id,
          'sample:contact:' || p_contact_id::text, p_grams, v_kg, p_courier, p_tracking_no, v_key)
  returning id into v_id;

  -- lot provenance chain (green leaving inventory is a lot-level commercial event).
  perform record_lot_event(
    p_green_lot_code, 'sample_dispatched',
    jsonb_build_object('sample_dispatch_id', v_id, 'contact_id', p_contact_id,
                       'grams', p_grams, 'kg', v_kg, 'courier', p_courier,
                       'tracking_no', p_tracking_no),
    now(), 'server', nextval('lot_code_seq'), v_key || ':sample');

  -- CRM relationship timeline.
  perform _append_contact_event(p_contact_id, 'sample_sent',
    jsonb_build_object('sample_dispatch_id', v_id, 'green_lot_code', p_green_lot_code,
                       'grams', p_grams, 'courier', p_courier, 'tracking_no', p_tracking_no),
    v_key || ':sent');

  return v_id;
end $$;
revoke execute on function record_sample_dispatch(text, bigint, numeric, text, text, text) from public;
grant   execute on function record_sample_dispatch(text, bigint, numeric, text, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 13. record_sample_feedback — the buyer's cup verdict on a dispatched sample. Recorded
--     as an APPEND-ONLY 'sample_feedback' event on the contact timeline (the dispatch
--     row is immutable; a verdict is new evidence, not a column rewrite). Idempotent.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function record_sample_feedback(
  p_sample_dispatch_id bigint,
  p_score              numeric,
  p_verdict            text,
  p_notes              text,
  p_idempotency_key    text
) returns uuid
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  v_tenant  uuid := current_tenant_id();
  v_key     text;
  v_contact bigint;
  v_lot     text;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  if p_verdict not in ('approved', 'rejected', 'counter') then
    raise exception 'invalid sample verdict % (approved|rejected|counter)', p_verdict
      using errcode = 'check_violation';
  end if;
  select contact_id, green_lot_code into v_contact, v_lot
    from sample_dispatches where id = p_sample_dispatch_id and tenant_id = v_tenant;
  if v_contact is null then
    raise exception 'unknown sample dispatch % for tenant', p_sample_dispatch_id
      using errcode = 'foreign_key_violation';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  return _append_contact_event(v_contact, 'sample_feedback',
    jsonb_build_object('sample_dispatch_id', p_sample_dispatch_id, 'green_lot_code', v_lot,
                       'score', p_score, 'verdict', p_verdict, 'notes', p_notes),
    v_key || ':feedback');
end $$;
revoke execute on function record_sample_feedback(bigint, numeric, text, text, text) from public;
grant   execute on function record_sample_feedback(bigint, numeric, text, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 14. Read views (security_invoker → inherit the caller's RLS on base tables).
-- ════════════════════════════════════════════════════════════════════════════

-- v_contact_directory — the roster. lifetime_value_usd is DERIVED from accepted price
-- quotes whose reservation is bound to the contact (never a stored counter).
create view v_contact_directory with (security_invoker = on) as
  select
    c.tenant_id,
    c.id            as contact_id,
    c.name,
    c.kind,
    c.status,
    c.country_code,
    c.preferred_channel,
    c.buyer_id,
    b.name          as buyer_name,
    c.consent_marketing,
    c.consent_source,
    c.consent_at,
    c.unsubscribed_at,
    (select max(e.occurred_at) from contact_events e
      where e.contact_id = c.id and e.tenant_id = c.tenant_id)        as last_event_at,
    (select count(*)::int from contact_events e
      where e.contact_id = c.id and e.tenant_id = c.tenant_id)        as event_count,
    coalesce((
      select sum(q.unit_price * q.kg * coalesce(q.fx_rate_to_usd, 1))
        from price_quotes q
        join lot_reservations r on r.id = q.reservation_id and r.tenant_id = q.tenant_id
       where r.contact_id = c.id and q.tenant_id = c.tenant_id and q.status = 'accepted'
    ), 0)::numeric                                                    as lifetime_value_usd
  from contacts c
  left join b2b_buyers b on b.id = c.buyer_id and b.tenant_id = c.tenant_id;

-- v_contact_timeline — the append-only relationship ledger, per contact (the app
-- filters by contact_id; each stream is chain-verifiable via verify_chain('contact:<id>')).
create view v_contact_timeline with (security_invoker = on) as
  select
    e.tenant_id,
    e.contact_id,
    e.event_uid,
    e.stream_key,
    e.kind,
    e.payload,
    e.occurred_at,
    e.recorded_at,
    e.device_id,
    e.device_seq
  from contact_events e;

-- v_sample_dispatch_pipeline — open sample dispatches ⨝ contact ⨝ green-lot grade, with
-- the latest feedback verdict (NULL = awaiting the buyer's cup). Distinct from P3-S2's
-- v_sample_pipeline (green_samples → b2b_buyers); this is the CRM dispatch path.
create view v_sample_dispatch_pipeline with (security_invoker = on) as
  select
    d.tenant_id,
    d.id            as sample_id,
    d.green_lot_code,
    d.contact_id,
    c.name          as contact_name,
    d.grams,
    d.kg,
    d.courier,
    d.tracking_no,
    d.dispatched_at,
    g.sca_grade,
    g.cupping_score,
    (select e.payload->>'verdict' from contact_events e
      where e.tenant_id = d.tenant_id and e.contact_id = d.contact_id
        and e.kind = 'sample_feedback'
        and (e.payload->>'sample_dispatch_id')::bigint = d.id
      order by e.occurred_at desc, e.device_seq desc limit 1)         as latest_verdict
  from sample_dispatches d
  join contacts c   on c.id = d.contact_id    and c.tenant_id = d.tenant_id
  join green_lots g on g.lot_code = d.green_lot_code and g.tenant_id = d.tenant_id;

-- ════════════════════════════════════════════════════════════════════════════
-- 15. RLS — tenant-scoped read on every new table (P4-S0 idiom). Writes flow through
--     the SECDEF RPCs (which bypass RLS + self-clamp), so NO insert/update/delete
--     policy — read-only at the policy layer (RPC-only-write). The PII ledger
--     force-RLSes so even a direct owner-role read is policy-governed in prod.
-- ════════════════════════════════════════════════════════════════════════════
alter table contacts          enable row level security;
create policy "tenant read" on public.contacts for select to authenticated
  using (tenant_id = current_tenant_id());

alter table contact_events    enable row level security;
alter table contact_events    force  row level security;
create policy "tenant read" on public.contact_events for select to authenticated
  using (tenant_id = current_tenant_id());

alter table sample_dispatches enable row level security;
create policy "tenant read" on public.sample_dispatches for select to authenticated
  using (tenant_id = current_tenant_id());

-- ════════════════════════════════════════════════════════════════════════════
-- 16. GRANTS (AD-8) — per-object SELECT to authenticated (one statement each so the
--     name-anchored static guard matches). NO write grants; anon gets NOTHING. RPC
--     execute is revoked-from-public-then-granted at each definition above.
-- ════════════════════════════════════════════════════════════════════════════
grant select on contacts                   to authenticated;
grant select on contact_events             to authenticated;
grant select on sample_dispatches          to authenticated;
grant select on green_lots_atp             to authenticated;   -- re-granted (recreated here)
grant select on v_contact_directory        to authenticated;
grant select on v_contact_timeline         to authenticated;
grant select on v_sample_dispatch_pipeline to authenticated;

commit;
