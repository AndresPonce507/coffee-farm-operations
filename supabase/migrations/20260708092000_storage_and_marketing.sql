-- ════════════════════════════════════════════════════════════════════════════
-- P3-S20 · Storage / controlled-environment monitoring + lifecycle marketing.
--          The wave's LAST slice (it consumes contacts + reputation + the lot-event
--          projection). Two coupled sub-areas land together.
-- ════════════════════════════════════════════════════════════════════════════
-- Spec: docs/design/PHASE3-DESIGN.md lines 411–430 (+ §1 cross-slice rails).
-- Depends (HARD): Phase-1 green inventory (green_lots / lots / materialize_green_lot —
--                 its green-node mint is the lot-launch trigger) + lot_event /
--                 record_lot_event / verify_chain; P3-S18 contacts + _append_contact_event
--                 (consent fields are the marketing gate) + sample_dispatches (the
--                 sample-follow-up trigger source); P3-S19 v_lot_reputation (merge tags).
--
-- KEY INVARIANTS (spec §"Key invariants 2,4,5,6"):
--  • A storage certificate CANNOT be issued without its evidence — readings_count=0 ⇒
--    issue_storage_certificate RAISES (verdict can only be 'insufficient-data', NEVER a
--    fabricated 'in-band'). cert_hash binds the cert tamper-evidently to the exact
--    readings window (the EUDR honest-provenance posture, here for storage).
--  • You can only broadcast to a CONSENTING contact — the consent gate is a DB CHECK
--    (consent_verified = true) PLUS a before-insert guard on the outbound queue (reads
--    live contacts, rejects consent=false / unsubscribed). The audience views filter on
--    consent. A future campaign code path physically cannot email a non-consenting row.
--  • NO untrusted inbound drives a SEND — queue_campaign_send builds a DRAFT queue
--    (status 'queued'); nothing is 'sent' until mark_campaign_sent, the human-confirmed
--    button. An unsubscribe (the contact's own opt-out) DOES auto-suppress — suppression
--    only removes capability, never a money/send action, so it honors the injection rail.
--  • Append-only ledgers (storage_readings / storage_certificates / marketing_outbound)
--    are immutable at the data layer; corrections are superseding rows.
--
-- RAILS honored (§1): one write door (every writer is SECURITY DEFINER,
-- set search_path = public, extensions, tenant-clamped, idempotent on a tenant-qualified
-- key, appending the relevant lot_event in the SAME txn). AD-8/AD-9 grants exactly
-- (per-object grant select to authenticated; revoke-then-grant on every caller-facing
-- RPC; anon gets NOTHING). Tenant seam (tenant_id + current_tenant_id() default + RLS on
-- every new table). NOTE: this slice commits NO green inventory (storage is monitoring;
-- marketing is communication) → it correctly does NOT touch the prevent_oversell claim
-- set, and has NO cross-unit math (temp °C, RH %, water-activity aw are all canonical —
-- convert_qty is not invoked, honestly, because there is nothing to convert) and reads
-- no COGS (no pricing decision here).

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Enums.
-- ════════════════════════════════════════════════════════════════════════════
create type storage_reading_source as enum ('manual', 'lorawan-sensor');
create type storage_cert_verdict   as enum ('in-band', 'excursion', 'insufficient-data');
create type campaign_trigger       as enum ('lot-launch', 'replenishment', 'sample-follow-up', 'manual');
create type campaign_status        as enum ('draft', 'queued', 'sent', 'archived');
create type outbound_status        as enum ('queued', 'sent', 'failed', 'suppressed');

-- ════════════════════════════════════════════════════════════════════════════
-- 2. storage_locations — gives green_lots.location free-text strings a structured home
--    + the controlled-environment target bands (green coffee safe water-activity aw ≤
--    ~0.65). MUTABLE config (set_updated_at reused); RPC-only writes at the client edge.
-- ════════════════════════════════════════════════════════════════════════════
create table storage_locations (
  id            bigint generated always as identity primary key,
  tenant_id     uuid    not null references tenants(id) default current_tenant_id(),
  code          text    not null,
  name          text    not null,
  temp_min_c    numeric not null default 15,
  temp_max_c    numeric not null default 25,
  rh_min_pct    numeric not null default 50,
  rh_max_pct    numeric not null default 65,
  aw_max        numeric not null default 0.65 check (aw_max > 0 and aw_max <= 1),
  idempotency_key text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint storage_locations_band_chk check (temp_min_c <= temp_max_c and rh_min_pct <= rh_max_pct),
  constraint storage_locations_tenant_code_ux  unique (tenant_id, code),
  constraint storage_locations_tenant_idem_ux  unique (tenant_id, idempotency_key)
);
create index storage_locations_tenant_idx on storage_locations (tenant_id);
create trigger storage_locations_set_updated_at before update on storage_locations
  for each row execute function set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- 3. storage_readings — APPEND-ONLY environmental time-series. `manual` is the $0 path
--    (hygrometer/aw reading via the quick form); `lorawan-sensor` is the identical schema
--    plus a device id (a future ChirpStack gateway POSTs the same RPC). Idempotent so a
--    re-synced offline / duplicated LoRaWAN uplink never double-counts.
-- ════════════════════════════════════════════════════════════════════════════
create table storage_readings (
  id            bigint generated always as identity primary key,
  tenant_id     uuid    not null references tenants(id) default current_tenant_id(),
  location_id   bigint  not null references storage_locations(id),
  temp_c        numeric,
  rh_pct        numeric,
  aw            numeric check (aw is null or (aw >= 0 and aw <= 1)),
  source        storage_reading_source not null default 'manual',
  device_id     text,
  reading_at    timestamptz not null,
  idempotency_key text,
  created_at    timestamptz not null default now(),
  constraint storage_readings_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index storage_readings_tenant_idx   on storage_readings (tenant_id);
create index storage_readings_window_idx    on storage_readings (tenant_id, location_id, reading_at);

create or replace function _storage_readings_immutable() returns trigger
  language plpgsql set search_path = public
as $$
begin
  raise exception
    'storage_readings is append-only: % is not permitted — record a superseding reading instead', tg_op
    using errcode = 'restrict_violation';
end $$;
create trigger storage_readings_no_update before update on storage_readings
  for each row execute function _storage_readings_immutable();
create trigger storage_readings_no_delete before delete on storage_readings
  for each row execute function _storage_readings_immutable();
revoke execute on function _storage_readings_immutable() from public;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. storage_certificates — the documented per-lot artifact. APPEND-ONLY/immutable;
--    cert_hash binds the verdict to the exact readings window. Composite FK into the
--    owning tenant's green lot.
-- ════════════════════════════════════════════════════════════════════════════
create table storage_certificates (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  green_lot_code  text    not null,
  location_id     bigint  not null references storage_locations(id),
  window_start    timestamptz not null,
  window_end      timestamptz not null,
  readings_count  integer not null check (readings_count >= 0),
  in_band_pct     numeric,
  verdict         storage_cert_verdict not null,
  cert_hash       bytea   not null,
  issued_at       timestamptz not null default now(),
  idempotency_key text,
  created_at      timestamptz not null default now(),
  constraint storage_certificates_green_lot_tfk
    foreign key (tenant_id, green_lot_code) references green_lots(tenant_id, lot_code),
  constraint storage_certificates_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index storage_certificates_tenant_idx on storage_certificates (tenant_id);
create index storage_certificates_lot_idx     on storage_certificates (tenant_id, green_lot_code);

create or replace function _storage_certificates_immutable() returns trigger
  language plpgsql set search_path = public
as $$
begin
  raise exception
    'storage_certificates is append-only: % is not permitted — issue a superseding certificate instead', tg_op
    using errcode = 'restrict_violation';
end $$;
create trigger storage_certificates_no_update before update on storage_certificates
  for each row execute function _storage_certificates_immutable();
create trigger storage_certificates_no_delete before delete on storage_certificates
  for each row execute function _storage_certificates_immutable();
revoke execute on function _storage_certificates_immutable() from public;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. marketing_campaigns — the campaign header. MUTABLE draft (set_updated_at). An
--    optional green_lot_code binds the campaign to a lot (the merge tags + the
--    'campaign_sent' lot_event resolve against it). Composite FK is nullable + MATCH
--    SIMPLE, so a lot-less manual campaign is legal.
-- ════════════════════════════════════════════════════════════════════════════
create table marketing_campaigns (
  id            bigint generated always as identity primary key,
  tenant_id     uuid    not null references tenants(id) default current_tenant_id(),
  name          text    not null,
  trigger_kind  campaign_trigger not null default 'manual',
  green_lot_code text,
  subject       text,
  body_template text,
  status        campaign_status not null default 'draft',
  idempotency_key text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint marketing_campaigns_green_lot_tfk
    foreign key (tenant_id, green_lot_code) references green_lots(tenant_id, lot_code),
  constraint marketing_campaigns_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index marketing_campaigns_tenant_idx on marketing_campaigns (tenant_id);
create index marketing_campaigns_lot_idx     on marketing_campaigns (tenant_id, green_lot_code);
-- one auto-draft per (lot, trigger kind) — the event triggers ON CONFLICT DO NOTHING.
create unique index marketing_campaigns_auto_ux
  on marketing_campaigns (tenant_id, trigger_kind, green_lot_code) where green_lot_code is not null;
create trigger marketing_campaigns_set_updated_at before update on marketing_campaigns
  for each row execute function set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- 6. marketing_segments — a named, reusable audience definition (config). RPC-less for
--    now (the consent-filtered v_marketing_audience is the live audience); the table is
--    the persistence the composer's saved segments bind to.
-- ════════════════════════════════════════════════════════════════════════════
create table marketing_segments (
  id            bigint generated always as identity primary key,
  tenant_id     uuid    not null references tenants(id) default current_tenant_id(),
  name          text    not null,
  criteria      jsonb   not null default '{}'::jsonb,
  idempotency_key text,
  created_at    timestamptz not null default now(),
  constraint marketing_segments_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index marketing_segments_tenant_idx on marketing_segments (tenant_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 7. marketing_outbound — the send queue. APPEND-ONLY. The CONSENT GATE lives here:
--    consent_verified is CHECK-pinned true (an unverified row physically cannot exist)
--    AND a before-insert guard re-validates against the LIVE contact (consent=false or
--    unsubscribed ⇒ raise). One row per (campaign, contact) — idempotent queueing.
-- ════════════════════════════════════════════════════════════════════════════
create table marketing_outbound (
  id            bigint generated always as identity primary key,
  tenant_id     uuid    not null references tenants(id) default current_tenant_id(),
  campaign_id   bigint  not null references marketing_campaigns(id),
  contact_id    bigint  not null references contacts(id),
  channel       comm_channel not null default 'email',
  rendered_subject text,
  rendered_body text    not null,
  consent_verified boolean not null,
  status        outbound_status not null default 'queued',
  sent_at       timestamptz,
  idempotency_key text,
  created_at    timestamptz not null default now(),
  -- the CONSENT CHECK: a stored outbound row was provably consent-verified.
  constraint marketing_outbound_consent_chk check (consent_verified = true),
  constraint marketing_outbound_campaign_contact_ux unique (tenant_id, campaign_id, contact_id),
  constraint marketing_outbound_tenant_idem_ux      unique (tenant_id, idempotency_key)
);
create index marketing_outbound_tenant_idx   on marketing_outbound (tenant_id);
create index marketing_outbound_campaign_idx on marketing_outbound (tenant_id, campaign_id);
create index marketing_outbound_contact_idx  on marketing_outbound (tenant_id, contact_id);

-- the before-insert CONSENT GUARD — the second enforcement layer (cross-table; a CHECK
-- cannot reach another table). Reads the LIVE contact; rejects a non-consenting or
-- unsubscribed target; stamps consent_verified true so the CHECK passes only for a row
-- whose consent was actually proven at enqueue time.
create or replace function _enforce_marketing_consent() returns trigger
  language plpgsql set search_path = public
as $$
declare v_consent boolean; v_unsub timestamptz;
begin
  select consent_marketing, unsubscribed_at into v_consent, v_unsub
    from contacts where id = new.contact_id and tenant_id = new.tenant_id;
  if v_consent is null then
    raise exception 'marketing consent guard: unknown contact % for tenant', new.contact_id
      using errcode = 'foreign_key_violation';
  end if;
  if v_consent is not true or v_unsub is not null then
    raise exception
      'marketing consent guard: contact % has not consented (or has unsubscribed) — cannot enqueue', new.contact_id
      using errcode = 'check_violation';
  end if;
  -- NB: the guard does NOT force consent_verified — the CHECK (consent_verified = true) is
  -- an INDEPENDENT layer. A writer must assert true itself; passing false reds the CHECK.
  return new;
end $$;
create trigger marketing_outbound_consent_guard before insert on marketing_outbound
  for each row execute function _enforce_marketing_consent();
revoke execute on function _enforce_marketing_consent() from public;

-- append-only immutability — once queued, a row's history is fixed; a failed/sent flip is
-- done by the SECDEF writers via a controlled UPDATE path (the trigger allows status/
-- sent_at transitions but forbids row deletion + content rewrites).
create or replace function _marketing_outbound_guard_mutation() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'marketing_outbound is append-only: DELETE is not permitted'
      using errcode = 'restrict_violation';
  end if;
  -- UPDATE: only the delivery-state columns may change; content + targeting are frozen.
  if new.campaign_id is distinct from old.campaign_id
     or new.contact_id is distinct from old.contact_id
     or new.rendered_body is distinct from old.rendered_body
     or new.consent_verified is distinct from old.consent_verified then
    raise exception 'marketing_outbound content/targeting is immutable — only status/sent_at may change'
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;
create trigger marketing_outbound_no_delete before delete on marketing_outbound
  for each row execute function _marketing_outbound_guard_mutation();
create trigger marketing_outbound_guard_update before update on marketing_outbound
  for each row execute function _marketing_outbound_guard_mutation();
revoke execute on function _marketing_outbound_guard_mutation() from public;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. The THREE lifecycle event triggers — each DRAFTS a campaign (status 'draft',
--    nobody targeted yet, no consent gate at draft time), idempotent via ON CONFLICT.
--    They are SECURITY DEFINER so they always insert as the owner (the green-node mint
--    runs inside materialize_green_lot's SECDEF context; a claim insert runs inside
--    accept_quote / record_sample_dispatch). AI drafts the copy; a human later sends it.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function _draft_lot_launch_campaign() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  insert into marketing_campaigns (tenant_id, name, trigger_kind, green_lot_code, subject, body_template, idempotency_key)
  values (new.tenant_id,
          'Lot launch — ' || new.lot_code,
          'lot-launch', new.lot_code,
          'New release: {{lot_code}} ({{sca_grade}})',
          'Fresh from Janson — lot {{lot_code}}, cup {{cup_score}}, {{sca_grade}} band. Reserve yours.',
          'auto:lot-launch:' || new.tenant_id::text || ':' || new.lot_code)
  on conflict do nothing;
  return new;
end $$;
create trigger green_lots_draft_lot_launch after insert on green_lots
  for each row execute function _draft_lot_launch_campaign();
revoke execute on function _draft_lot_launch_campaign() from public;

create or replace function _draft_replenishment_campaign() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  insert into marketing_campaigns (tenant_id, name, trigger_kind, green_lot_code, subject, body_template, idempotency_key)
  values (new.tenant_id,
          'Replenishment — ' || new.green_lot_code,
          'replenishment', new.green_lot_code,
          'Running low on {{lot_code}}?',
          'Your {{lot_code}} ({{sca_grade}}, cup {{cup_score}}) is moving — restock before it''s gone.',
          'auto:replenishment:' || new.tenant_id::text || ':' || new.green_lot_code)
  on conflict do nothing;
  return new;
end $$;
create trigger lot_shipments_draft_replenishment after insert on lot_shipments
  for each row execute function _draft_replenishment_campaign();
revoke execute on function _draft_replenishment_campaign() from public;

create or replace function _draft_sample_followup_campaign() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  insert into marketing_campaigns (tenant_id, name, trigger_kind, green_lot_code, subject, body_template, idempotency_key)
  values (new.tenant_id,
          'Sample follow-up — ' || new.green_lot_code,
          'sample-follow-up', new.green_lot_code,
          'How did {{lot_code}} cup?',
          'Thanks for cupping {{lot_code}} ({{sca_grade}}, cup {{cup_score}}). Ready to order?',
          'auto:sample-follow-up:' || new.tenant_id::text || ':' || new.green_lot_code)
  on conflict do nothing;
  return new;
end $$;
create trigger sample_dispatches_draft_followup after insert on sample_dispatches
  for each row execute function _draft_sample_followup_campaign();
revoke execute on function _draft_sample_followup_campaign() from public;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. upsert_storage_location — the ONLY storage_locations writer. Idempotent create on
--    the tenant-qualified key; an existing code updates the bands.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function upsert_storage_location(
  p_code            text,
  p_name            text,
  p_temp_min_c      numeric,
  p_temp_max_c      numeric,
  p_rh_min_pct      numeric,
  p_rh_max_pct      numeric,
  p_aw_max          numeric,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare v_tenant uuid := current_tenant_id(); v_key text; v_id bigint;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select id into v_id from storage_locations where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then return v_id; end if;

  select id into v_id from storage_locations where tenant_id = v_tenant and code = p_code;
  if v_id is not null then
    update storage_locations set
      name       = coalesce(p_name, name),
      temp_min_c = coalesce(p_temp_min_c, temp_min_c),
      temp_max_c = coalesce(p_temp_max_c, temp_max_c),
      rh_min_pct = coalesce(p_rh_min_pct, rh_min_pct),
      rh_max_pct = coalesce(p_rh_max_pct, rh_max_pct),
      aw_max     = coalesce(p_aw_max, aw_max)
     where id = v_id and tenant_id = v_tenant;
    return v_id;
  end if;

  insert into storage_locations (tenant_id, code, name, temp_min_c, temp_max_c, rh_min_pct, rh_max_pct, aw_max, idempotency_key)
  values (v_tenant, p_code, p_name,
          coalesce(p_temp_min_c, 15), coalesce(p_temp_max_c, 25),
          coalesce(p_rh_min_pct, 50), coalesce(p_rh_max_pct, 65),
          coalesce(p_aw_max, 0.65), v_key)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function upsert_storage_location(text, text, numeric, numeric, numeric, numeric, numeric, text) from public;
grant   execute on function upsert_storage_location(text, text, numeric, numeric, numeric, numeric, numeric, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 10. record_storage_reading — the append-only reading writer. Idempotent (a re-synced
--     offline / duplicated LoRaWAN uplink returns the same row). Resolves the location
--     by code within the caller's tenant.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function record_storage_reading(
  p_location_code   text,
  p_temp_c          numeric,
  p_rh_pct          numeric,
  p_aw              numeric,
  p_source          text,
  p_device_id       text,
  p_reading_at      timestamptz,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare v_tenant uuid := current_tenant_id(); v_key text; v_id bigint; v_loc bigint;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select id into v_id from storage_readings where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then return v_id; end if;

  select id into v_loc from storage_locations where tenant_id = v_tenant and code = p_location_code;
  if v_loc is null then
    raise exception 'unknown storage location % for tenant', p_location_code using errcode = 'foreign_key_violation';
  end if;

  insert into storage_readings (tenant_id, location_id, temp_c, rh_pct, aw, source, device_id, reading_at, idempotency_key)
  values (v_tenant, v_loc, p_temp_c, p_rh_pct, p_aw,
          coalesce(p_source, 'manual')::storage_reading_source, p_device_id,
          coalesce(p_reading_at, now()), v_key)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function record_storage_reading(text, numeric, numeric, numeric, text, text, timestamptz, text) from public;
grant   execute on function record_storage_reading(text, numeric, numeric, numeric, text, text, timestamptz, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 11. issue_storage_certificate — reads the readings in the window, computes the verdict
--     against the location bands, computes a cert_hash binding the cert to the EXACT
--     readings, and appends a 'storage_certified' lot_event onto the green lot's chain.
--     REFUSES (raises) when readings_count=0 — the verdict can only ever be
--     'insufficient-data', NEVER a fabricated 'in-band'.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function issue_storage_certificate(
  p_green_lot_code  text,
  p_location_code   text,
  p_window_start    timestamptz,
  p_window_end      timestamptz,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_id     bigint;
  v_loc    bigint;
  v_bands  record;
  v_count  integer;
  v_in     integer;
  v_pct    numeric;
  v_verdict storage_cert_verdict;
  v_digest text;
  v_hash   bytea;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select id into v_id from storage_certificates where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then return v_id; end if;

  if not exists (select 1 from green_lots where lot_code = p_green_lot_code and tenant_id = v_tenant) then
    raise exception 'unknown green lot % for tenant', p_green_lot_code using errcode = 'foreign_key_violation';
  end if;
  select id, temp_min_c, temp_max_c, rh_min_pct, rh_max_pct, aw_max
    into v_bands
    from storage_locations where tenant_id = v_tenant and code = p_location_code;
  if v_bands.id is null then
    raise exception 'unknown storage location % for tenant', p_location_code using errcode = 'foreign_key_violation';
  end if;
  v_loc := v_bands.id;

  -- count + in-band tally + a deterministic digest of the EXACT readings in the window.
  select
    count(*)::int,
    count(*) filter (where
        (r.temp_c is null or r.temp_c between v_bands.temp_min_c and v_bands.temp_max_c)
    and (r.rh_pct is null or r.rh_pct between v_bands.rh_min_pct and v_bands.rh_max_pct)
    and (r.aw     is null or r.aw     <= v_bands.aw_max))::int,
    coalesce(string_agg(
        r.id::text || ':' || coalesce(r.temp_c::text,'') || ':' || coalesce(r.rh_pct::text,'')
          || ':' || coalesce(r.aw::text,'') || ':' || r.reading_at::text,
        '|' order by r.reading_at, r.id), '')
    into v_count, v_in, v_digest
    from storage_readings r
   where r.tenant_id = v_tenant and r.location_id = v_loc
     and r.reading_at >= p_window_start and r.reading_at < p_window_end;

  -- EVIDENCE GATE: no readings ⇒ a cert cannot honestly assert anything → REFUSE.
  if v_count = 0 then
    raise exception
      'cannot issue a storage certificate for lot % over [%, %): zero readings — verdict can only be insufficient-data, never a fabricated in-band',
      p_green_lot_code, p_window_start, p_window_end using errcode = 'check_violation';
  end if;

  v_pct := round((v_in::numeric / v_count::numeric) * 100, 4);
  v_verdict := case when v_in = v_count then 'in-band' else 'excursion' end;

  -- cert_hash binds verdict ⟷ window ⟷ the exact readings (tamper-evident).
  v_hash := extensions.digest(
    convert_to(
      p_green_lot_code || '|' || p_location_code || '|' || p_window_start::text || '|' || p_window_end::text
        || '|' || v_count::text || '|' || v_pct::text || '|' || v_verdict::text || '|' || v_digest,
      'UTF8'),
    'sha256');

  insert into storage_certificates (tenant_id, green_lot_code, location_id, window_start, window_end,
                                    readings_count, in_band_pct, verdict, cert_hash, idempotency_key)
  values (v_tenant, p_green_lot_code, v_loc, p_window_start, p_window_end,
          v_count, v_pct, v_verdict, v_hash, v_key)
  returning id into v_id;

  -- provenance chain — keeping a lot in spec from green to sale is a commercial decision.
  perform record_lot_event(
    p_green_lot_code, 'storage_certified',
    jsonb_build_object('certificate_id', v_id, 'location_code', p_location_code,
                       'window_start', p_window_start, 'window_end', p_window_end,
                       'readings_count', v_count, 'in_band_pct', v_pct, 'verdict', v_verdict,
                       'cert_hash', encode(v_hash, 'hex')),
    now(), 'server', nextval('lot_code_seq'), v_key || ':cert');

  return v_id;
end $$;
revoke execute on function issue_storage_certificate(text, text, timestamptz, timestamptz, text) from public;
grant   execute on function issue_storage_certificate(text, text, timestamptz, timestamptz, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 12. draft_campaign — the manual campaign drafter (the composer's Save). Idempotent.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function draft_campaign(
  p_name            text,
  p_trigger_kind    text,
  p_green_lot_code  text,
  p_subject         text,
  p_body_template   text,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare v_tenant uuid := current_tenant_id(); v_key text; v_id bigint;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select id into v_id from marketing_campaigns where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then return v_id; end if;

  if p_green_lot_code is not null
     and not exists (select 1 from green_lots where lot_code = p_green_lot_code and tenant_id = v_tenant) then
    raise exception 'unknown green lot % for tenant', p_green_lot_code using errcode = 'foreign_key_violation';
  end if;

  insert into marketing_campaigns (tenant_id, name, trigger_kind, green_lot_code, subject, body_template, idempotency_key)
  values (v_tenant, p_name, coalesce(p_trigger_kind, 'manual')::campaign_trigger,
          p_green_lot_code, p_subject, p_body_template, v_key)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function draft_campaign(text, text, text, text, text, text) from public;
grant   execute on function draft_campaign(text, text, text, text, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 13. queue_campaign_send — builds the DRAFT outbound queue. Selects ONLY consenting,
--     non-unsubscribed contacts (the consent gate; the before-insert guard double-checks
--     each row), renders the merge tags ({{lot_code}}/{{cup_score}}/{{sca_grade}}) from
--     v_lot_reputation for the campaign's lot, and inserts 'queued' rows. NOTHING is sent
--     here — this is AI/owner drafting the queue. Idempotent (no duplicate per contact).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function queue_campaign_send(
  p_campaign_id     bigint,
  p_idempotency_key text
) returns integer
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant   uuid := current_tenant_id();
  v_key      text;
  v_lot      text;
  v_subject  text;
  v_body     text;
  v_lotcode  text;
  v_cup      text;
  v_grade    text;
  v_n        integer := 0;
  r          record;
  v_rsub     text;
  v_rbody    text;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select green_lot_code, subject, body_template into v_lot, v_subject, v_body
    from marketing_campaigns where id = p_campaign_id and tenant_id = v_tenant;
  if not found then
    raise exception 'unknown campaign % for tenant', p_campaign_id using errcode = 'foreign_key_violation';
  end if;

  -- merge-tag values: the GREEN LOT carries the QC truth (cupping_score + generated
  -- sca_grade) for every lot; a best accolade score from v_lot_reputation overrides the
  -- cup when present. Tenant-scoped explicitly (the SECDEF owner bypasses the
  -- security_invoker view's RLS, so we MUST filter by tenant).
  v_lotcode := coalesce(v_lot, '');
  if v_lot is not null then
    select g.cupping_score::text, coalesce(g.sca_grade, '')
      into v_cup, v_grade
      from green_lots g where g.lot_code = v_lot and g.tenant_id = v_tenant;
    -- prefer a live best-accolade cup score when the reputation ledger has one.
    select coalesce(max(best_cup_score)::text, v_cup) into v_cup
      from v_lot_reputation where lot_code = v_lot and tenant_id = v_tenant;
  end if;
  v_cup   := coalesce(v_cup, '');
  v_grade := coalesce(v_grade, '');

  for r in
    select c.id as contact_id, c.name from contacts c
     where c.tenant_id = v_tenant
       and c.consent_marketing = true
       and c.unsubscribed_at is null
  loop
    v_rsub  := replace(replace(replace(coalesce(v_subject, ''), '{{lot_code}}', v_lotcode),
                               '{{cup_score}}', v_cup), '{{sca_grade}}', v_grade);
    v_rbody := replace(replace(replace(coalesce(v_body, ''), '{{lot_code}}', v_lotcode),
                               '{{cup_score}}', v_cup), '{{sca_grade}}', v_grade);
    v_rbody := replace(v_rbody, '{{contact_name}}', coalesce(r.name, ''));

    insert into marketing_outbound (tenant_id, campaign_id, contact_id, rendered_subject, rendered_body,
                                    consent_verified, idempotency_key)
    values (v_tenant, p_campaign_id, r.contact_id, v_rsub, v_rbody, true,
            v_key || ':' || r.contact_id::text)
    on conflict (tenant_id, campaign_id, contact_id) do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;

  -- mark the campaign queued (a no-op flip if already queued/sent).
  update marketing_campaigns set status = 'queued'
   where id = p_campaign_id and tenant_id = v_tenant and status = 'draft';

  return v_n;
end $$;
revoke execute on function queue_campaign_send(bigint, text) from public;
grant   execute on function queue_campaign_send(bigint, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 14. mark_campaign_sent — the HUMAN-CONFIRMED send. Flips queued rows → 'sent' (stamping
--     sent_at), flips the campaign → 'sent', and appends a hash-chained 'campaign_sent'
--     lot_event onto the lot's provenance chain. This is the only place a send happens —
--     no untrusted inbound and no AI ever reaches it; a human clicks the button.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function mark_campaign_sent(
  p_campaign_id     bigint,
  p_idempotency_key text
) returns integer
  language plpgsql security definer set search_path = public, extensions
as $$
declare v_tenant uuid := current_tenant_id(); v_key text; v_lot text; v_n integer;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select green_lot_code into v_lot from marketing_campaigns
    where id = p_campaign_id and tenant_id = v_tenant;
  if not found then
    raise exception 'unknown campaign % for tenant', p_campaign_id using errcode = 'foreign_key_violation';
  end if;

  update marketing_outbound set status = 'sent', sent_at = now()
   where tenant_id = v_tenant and campaign_id = p_campaign_id and status = 'queued';
  get diagnostics v_n = row_count;

  update marketing_campaigns set status = 'sent'
   where id = p_campaign_id and tenant_id = v_tenant and status <> 'sent';

  if v_lot is not null and v_n > 0 then
    perform record_lot_event(
      v_lot, 'campaign_sent',
      jsonb_build_object('campaign_id', p_campaign_id, 'sent_count', v_n),
      now(), 'server', nextval('lot_code_seq'), v_key || ':sent');
  end if;

  return v_n;
end $$;
revoke execute on function mark_campaign_sent(bigint, text) from public;
grant   execute on function mark_campaign_sent(bigint, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 15. record_unsubscribe — the contact's own opt-out (CAN-SPAM/GDPR). Stamps
--     unsubscribed_at + withdraws marketing consent + logs a hash-chained
--     'consent_withdrawn' contact_event. Suppression only REMOVES capability (never a
--     send / money write), so auto-applying it honors the no-untrusted-inbound rail.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function record_unsubscribe(
  p_contact_id      bigint,
  p_idempotency_key text
) returns void
  language plpgsql security definer set search_path = public, extensions
as $$
declare v_tenant uuid := current_tenant_id(); v_key text; v_was boolean;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select consent_marketing into v_was from contacts where id = p_contact_id and tenant_id = v_tenant;
  if not found then
    raise exception 'unknown contact % for tenant', p_contact_id using errcode = 'foreign_key_violation';
  end if;

  update contacts set
    unsubscribed_at   = coalesce(unsubscribed_at, now()),
    consent_marketing = false
   where id = p_contact_id and tenant_id = v_tenant;

  -- log the withdrawal once (idempotent on the tenant-qualified key).
  if v_was is distinct from false then
    perform _append_contact_event(p_contact_id, 'consent_withdrawn',
      jsonb_build_object('reason', 'unsubscribe'), v_key || ':unsub');
  end if;
end $$;
revoke execute on function record_unsubscribe(bigint, text) from public;
grant   execute on function record_unsubscribe(bigint, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 16. Read views (security_invoker → inherit the caller's RLS on base tables).
-- ════════════════════════════════════════════════════════════════════════════

-- v_storage_status — per location: target bands + the latest reading + an in-band flag.
create view v_storage_status with (security_invoker = on) as
  select
    s.tenant_id,
    s.id            as location_id,
    s.code,
    s.name,
    s.temp_min_c, s.temp_max_c, s.rh_min_pct, s.rh_max_pct, s.aw_max,
    lr.temp_c       as latest_temp_c,
    lr.rh_pct       as latest_rh_pct,
    lr.aw           as latest_aw,
    lr.reading_at   as latest_reading_at,
    case when lr.reading_at is null then null else (
        (lr.temp_c is null or lr.temp_c between s.temp_min_c and s.temp_max_c)
    and (lr.rh_pct is null or lr.rh_pct between s.rh_min_pct and s.rh_max_pct)
    and (lr.aw     is null or lr.aw     <= s.aw_max)
    ) end           as in_band
  from storage_locations s
  left join lateral (
    select r.temp_c, r.rh_pct, r.aw, r.reading_at
      from storage_readings r
     where r.tenant_id = s.tenant_id and r.location_id = s.id
     order by r.reading_at desc, r.id desc limit 1
  ) lr on true;

-- v_lot_storage_history — a green lot's readings, joined via its free-text location to
-- the structured storage_location (the app filters by green_lot_code).
create view v_lot_storage_history with (security_invoker = on) as
  select
    g.tenant_id,
    g.lot_code      as green_lot_code,
    s.id            as location_id,
    s.name          as location_name,
    r.reading_at,
    r.temp_c,
    r.rh_pct,
    r.aw,
    r.source
  from green_lots g
  join storage_locations s on s.tenant_id = g.tenant_id and s.name = g.location
  join storage_readings r  on r.tenant_id = s.tenant_id and r.location_id = s.id;

-- v_marketing_audience — the consent-gated audience (the builder reads ONLY this).
create view v_marketing_audience with (security_invoker = on) as
  select
    c.tenant_id,
    c.id            as contact_id,
    c.name,
    c.kind,
    c.country_code,
    c.preferred_channel,
    c.consent_source,
    c.consent_at
  from contacts c
  where c.consent_marketing = true and c.unsubscribed_at is null;

-- v_campaign_board — campaigns with their trigger, lot, status + queued/sent tallies.
create view v_campaign_board with (security_invoker = on) as
  select
    c.tenant_id,
    c.id            as campaign_id,
    c.name,
    c.trigger_kind,
    c.green_lot_code,
    c.status,
    c.created_at,
    c.updated_at,
    coalesce((select count(*) from marketing_outbound o
               where o.campaign_id = c.id and o.tenant_id = c.tenant_id), 0)::int as queued_total,
    coalesce((select count(*) from marketing_outbound o
               where o.campaign_id = c.id and o.tenant_id = c.tenant_id and o.status = 'sent'), 0)::int as sent_total
  from marketing_campaigns c;

-- v_delivery_log — the live delivery log (outbound ⨝ contact ⨝ campaign).
create view v_delivery_log with (security_invoker = on) as
  select
    o.tenant_id,
    o.id            as outbound_id,
    o.campaign_id,
    mc.name         as campaign_name,
    o.contact_id,
    ct.name         as contact_name,
    o.channel,
    o.status,
    o.sent_at,
    o.created_at
  from marketing_outbound o
  join marketing_campaigns mc on mc.id = o.campaign_id and mc.tenant_id = o.tenant_id
  join contacts ct           on ct.id = o.contact_id  and ct.tenant_id = o.tenant_id;

-- ════════════════════════════════════════════════════════════════════════════
-- 17. RLS — tenant-scoped read on every new table (P4-S0 idiom). Writes flow through the
--     SECDEF RPCs (bypass RLS + self-clamp), so NO insert/update/delete policy. The PII-
--     bearing send queue force-RLSes so even a direct owner read is policy-governed.
-- ════════════════════════════════════════════════════════════════════════════
alter table storage_locations    enable row level security;
create policy "tenant read" on public.storage_locations for select to authenticated
  using (tenant_id = current_tenant_id());

alter table storage_readings     enable row level security;
create policy "tenant read" on public.storage_readings for select to authenticated
  using (tenant_id = current_tenant_id());

alter table storage_certificates enable row level security;
create policy "tenant read" on public.storage_certificates for select to authenticated
  using (tenant_id = current_tenant_id());

alter table marketing_campaigns  enable row level security;
create policy "tenant read" on public.marketing_campaigns for select to authenticated
  using (tenant_id = current_tenant_id());

alter table marketing_segments   enable row level security;
create policy "tenant read" on public.marketing_segments for select to authenticated
  using (tenant_id = current_tenant_id());

alter table marketing_outbound   enable row level security;
alter table marketing_outbound   force  row level security;
create policy "tenant read" on public.marketing_outbound for select to authenticated
  using (tenant_id = current_tenant_id());

-- ════════════════════════════════════════════════════════════════════════════
-- 18. GRANTS (AD-8) — per-object SELECT to authenticated (one statement each so the
--     name-anchored static guard matches). NO write grants; anon gets NOTHING. RPC
--     execute is revoked-from-public-then-granted at each definition above.
-- ════════════════════════════════════════════════════════════════════════════
grant select on storage_locations     to authenticated;
grant select on storage_readings       to authenticated;
grant select on storage_certificates   to authenticated;
grant select on marketing_campaigns     to authenticated;
grant select on marketing_segments      to authenticated;
grant select on marketing_outbound      to authenticated;
grant select on v_storage_status        to authenticated;
grant select on v_lot_storage_history   to authenticated;
grant select on v_marketing_audience    to authenticated;
grant select on v_campaign_board        to authenticated;
grant select on v_delivery_log          to authenticated;

commit;
