-- ════════════════════════════════════════════════════════════════════════════
-- P3-S3 · Export shipments + export-doc-pack engine — THE HEADLINE SLICE.
-- ════════════════════════════════════════════════════════════════════════════
-- Spec: docs/design/PHASE3-DESIGN.md lines 225–241 (+ §1 cross-slice rails).
-- Depends (HARD): P3-S1 (sales_contracts / contract_lines / sign_sales_contract),
--                 P3-S2 (samples — the reserve sign gate), Phase-1 EUDR
--                 (eudr_lot_status / lot_origin_plots), Phase-1 green inventory
--                 (green_lots / green_lots_atp / lot_shipments / prevent_oversell),
--                 lot_event / record_lot_event, convert_qty. BUILD LAST in the B2B trunk.
--
-- THE HEADLINE INVARIANT — an export doc can't issue without its prerequisites:
--   (1) The gate is AUDITABLE DATA, not buried code: export_doc_prereqs is a
--       declarative table (one row per (doc_kind, prerequisite)). The prereq checker
--       export_doc_prereqs_unmet(shipment, kind) evaluates each row against LIVE state
--       and returns the unmet labels (empty = clear). issue_export_doc — THE GATED
--       WRITER — raises with the EXACT missing list when it is non-empty; it NEVER
--       renders a blank doc (the eudr_lot_status 'incomplete-with-names' posture).
--   (2) A non-deforestation-free lot physically cannot get a Certificate of Origin
--       (its prereq = bool_and(eudr_lot_status(lot)='compliant') over the loaded lots,
--       REUSING the Phase-1 EUDR verdict). The B/L's prereq = all four other docs
--       issued — the keystone, the UNIQUE partial index making "issued" unambiguous.
--   (3) Each export_shipment_line ALSO inserts a lot_shipments row (net_kg = bags ×
--       bag_weight) so the EXISTING prevent_oversell trigger guards physical
--       over-shipment for free — no parallel counter; green_lots_atp.shipped_kg stays
--       the single truth.
--   (4) export_documents is an APPEND-ONLY legal ledger: the payload snapshot is
--       FROZEN at issue (only the supersession pointer may change); re-issue = a
--       superseding row; the partial unique index keeps exactly one LIVE doc per kind.
--
-- Rails honored: one write door (SECDEF RPCs, set search_path = public, extensions,
-- tenant-clamped, idempotent on a tenant-qualified key, lot_event in the same txn);
-- AD-8/AD-9 grants exactly (per-object grant select; revoke execute from public THEN
-- grant to authenticated on every RPC; anon gets NOTHING); the money guarantee is
-- REUSED (lot_shipments insert → prevent_oversell), never rebuilt; bag/grams unit math
-- routes through arithmetic on the declared bag_weight (no magic constant); the EUDR
-- verdict is reused, not re-derived; tenant_id + current_tenant_id() + RLS on every new
-- tenant table (export_doc_prereqs is GLOBAL trade-rule reference data, like units /
-- statutory_rates — RLS using(true), registered EXEMPT in tenantTables.ts).

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. export_doc_kind enum — the five mandated trade documents.
-- ════════════════════════════════════════════════════════════════════════════
create type export_doc_kind as enum
  ('commercial_invoice', 'certificate_of_origin', 'phytosanitary', 'packing_list', 'bill_of_lading');

-- ════════════════════════════════════════════════════════════════════════════
-- 2. export_shipments — one consignment per contract. INHERITED tenant (via the
--    contract). shipment_no minted JC-S-NNNN per tenant under an advisory lock.
--    status walks building → docs_issued → departed → arrived → closed.
-- ════════════════════════════════════════════════════════════════════════════
create table export_shipments (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  contract_id     bigint  not null references sales_contracts(id),
  shipment_no     text    not null,
  port_of_loading text    not null default 'Balboa, PA',
  bag_weight_kg   numeric not null default 30 check (bag_weight_kg > 0),
  status          text    not null default 'building'
                    check (status in ('building', 'docs_issued', 'departed', 'arrived', 'closed')),
  departed_at     timestamptz,
  idempotency_key text,
  created_at      timestamptz not null default now(),
  constraint export_shipments_no_ux         unique (tenant_id, shipment_no),
  constraint export_shipments_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index export_shipments_tenant_idx   on export_shipments (tenant_id);
create index export_shipments_contract_idx on export_shipments (tenant_id, contract_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. export_shipment_lines — which contract_lines load, with bag counts. Each line
--    ALSO carries the lot_shipments claim (lot_shipment_id) so prevent_oversell
--    guards physical over-shipment. INHERITED tenant (via the shipment / green lot).
-- ════════════════════════════════════════════════════════════════════════════
create table export_shipment_lines (
  id               bigint generated always as identity primary key,
  tenant_id        uuid    not null references tenants(id) default current_tenant_id(),
  shipment_id      bigint  not null references export_shipments(id),
  contract_line_id bigint  not null references contract_lines(id),
  green_lot_code   text    not null,
  bags             integer not null check (bags > 0),
  net_kg           numeric not null check (net_kg > 0),
  lot_shipment_id  bigint  references lot_shipments(id),     -- the ATP claim that guarded this load
  idempotency_key  text,
  created_at       timestamptz not null default now(),
  constraint export_shipment_lines_green_lot_tfk
    foreign key (tenant_id, green_lot_code) references green_lots(tenant_id, lot_code),
  constraint export_shipment_lines_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index export_shipment_lines_tenant_idx   on export_shipment_lines (tenant_id);
create index export_shipment_lines_shipment_idx on export_shipment_lines (tenant_id, shipment_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 4. export_documents — the APPEND-ONLY issued-doc ledger. payload = the rendered
--    snapshot FROZEN at issue (consignee, lots, EUDR statuses, net/gross kg);
--    superseded_by points a re-issued doc's predecessor at its replacement. The
--    partial UNIQUE index = exactly one LIVE doc of each kind per shipment.
--    INHERITED tenant (via the shipment).
-- ════════════════════════════════════════════════════════════════════════════
create table export_documents (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  shipment_id     bigint  not null references export_shipments(id),
  doc_kind        export_doc_kind not null,
  doc_no          text    not null,
  payload         jsonb   not null,                          -- frozen rendered snapshot
  superseded_by   bigint  references export_documents(id),   -- non-null => no longer the live doc
  issued_at       timestamptz not null default now(),
  idempotency_key text,
  created_at      timestamptz not null default now(),
  constraint export_documents_no_ux          unique (tenant_id, doc_no),
  constraint export_documents_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index export_documents_tenant_idx   on export_documents (tenant_id);
create index export_documents_shipment_idx on export_documents (tenant_id, shipment_id);
-- exactly ONE live doc of each kind per shipment (the "issued" liveness the B/L
-- prereq and the readiness traffic-light read).
create unique index export_documents_one_live_ux
  on export_documents (tenant_id, shipment_id, doc_kind)
  where superseded_by is null;

-- 4a. Append-only freeze trigger. DELETE is never permitted; an UPDATE may change
--     ONLY superseded_by (the supersession pointer) — the issued payload is frozen,
--     so a "correction" is a NEW superseding doc, never an in-place edit. (This is
--     stricter than the green_samples posture and looser than the all-blocking
--     cup_scores trigger: it must permit the supersession pointer to be set.)
create or replace function _export_documents_freeze() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'export_documents is append-only: DELETE is not permitted — issue a superseding doc instead'
      using errcode = 'restrict_violation';
  end if;
  -- UPDATE: every column EXCEPT superseded_by must be unchanged (the frozen payload).
  if (new.id, new.tenant_id, new.shipment_id, new.doc_kind, new.doc_no,
      new.payload, new.issued_at, new.idempotency_key, new.created_at)
     is distinct from
     (old.id, old.tenant_id, old.shipment_id, old.doc_kind, old.doc_no,
      old.payload, old.issued_at, old.idempotency_key, old.created_at) then
    raise exception
      'export_documents is append-only: only the supersession pointer may change — the issued payload is frozen'
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;
create trigger export_documents_freeze before update or delete on export_documents
  for each row execute function _export_documents_freeze();
revoke execute on function _export_documents_freeze() from public;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. export_doc_prereqs — the DECLARATIVE prerequisite table (the gate is auditable
--    DATA, not buried code). GLOBAL trade-rule reference data (the prerequisites are
--    the same for every estate — MIDA / ICO / Incoterms rules), so — like units /
--    statutory_rates — it carries NO tenant_id and reads `using(true)`; it is
--    registered EXEMPT in src/test/db/tenantTables.ts. Seeded below.
--      prereq_kind: 'contract_signed' | 'eudr_compliant' | 'doc_issued'
--      required_doc_kind: the dependency doc (for 'doc_issued' prereqs only).
-- ════════════════════════════════════════════════════════════════════════════
create table export_doc_prereqs (
  id                bigint generated always as identity primary key,
  doc_kind          export_doc_kind not null,
  prereq_label      text not null,                            -- the auditor-honest unmet label
  prereq_kind       text not null check (prereq_kind in ('contract_signed', 'eudr_compliant', 'doc_issued')),
  required_doc_kind export_doc_kind,                          -- set iff prereq_kind = 'doc_issued'
  created_at        timestamptz not null default now(),
  constraint export_doc_prereqs_ux unique (doc_kind, prereq_label),
  constraint export_doc_prereqs_dep_chk
    check ((prereq_kind = 'doc_issued') = (required_doc_kind is not null))
);

-- The seeded gate (spec §227): commercial_invoice ⇐ contract signed; CO ⇐ EUDR
-- compliant; phyto ⇐ packing list; B/L ⇐ all four other docs (the keystone).
-- packing_list has NO prerequisite — it is always issuable.
insert into export_doc_prereqs (doc_kind, prereq_label, prereq_kind, required_doc_kind) values
  ('commercial_invoice',    'contract signed',                    'contract_signed', null),
  ('certificate_of_origin', 'all loaded lots EUDR-compliant',     'eudr_compliant',  null),
  ('phytosanitary',         'packing list issued',                'doc_issued',      'packing_list'),
  ('bill_of_lading',        'commercial invoice issued',          'doc_issued',      'commercial_invoice'),
  ('bill_of_lading',        'certificate of origin issued',       'doc_issued',      'certificate_of_origin'),
  ('bill_of_lading',        'phytosanitary certificate issued',   'doc_issued',      'phytosanitary'),
  ('bill_of_lading',        'packing list issued',                'doc_issued',      'packing_list');

-- ════════════════════════════════════════════════════════════════════════════
-- 6. export_doc_prereqs_unmet — the STABLE security_invoker prereq checker. Returns
--    the array of unmet prerequisite labels for a (shipment, doc_kind) evaluated
--    against LIVE state (empty array = clear to issue). It reuses eudr_lot_status
--    directly. security_invoker so it reads the caller's tenant-scoped rows under RLS;
--    when called inside the SECDEF issue_export_doc (owner context) it reads the
--    already-tenant-validated shipment's rows.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function export_doc_prereqs_unmet(p_shipment_id bigint, p_doc_kind text)
  returns text[]
  language plpgsql
  stable
  security invoker
  set search_path = public, extensions
as $$
declare
  v_unmet    text[] := '{}';
  v_contract bigint;
  v_status   text;
  r          record;
  v_ok       boolean;
  v_lines    bigint;
begin
  select contract_id into v_contract from export_shipments where id = p_shipment_id;

  for r in select * from export_doc_prereqs where doc_kind = p_doc_kind::export_doc_kind loop
    if r.prereq_kind = 'contract_signed' then
      select status into v_status from sales_contracts where id = v_contract;
      if v_status is null or v_status in ('draft', 'cancelled') then
        v_unmet := array_append(v_unmet, r.prereq_label);
      end if;

    elsif r.prereq_kind = 'eudr_compliant' then
      -- EVERY loaded lot must read 'compliant' (and there must be ≥1 loaded lot).
      select count(*), bool_and(eudr_lot_status(green_lot_code) = 'compliant')
        into v_lines, v_ok
        from export_shipment_lines where shipment_id = p_shipment_id;
      if coalesce(v_lines, 0) = 0 or not coalesce(v_ok, false) then
        v_unmet := array_append(v_unmet, r.prereq_label);
      end if;

    elsif r.prereq_kind = 'doc_issued' then
      if not exists (
        select 1 from export_documents
         where shipment_id = p_shipment_id
           and doc_kind = r.required_doc_kind
           and superseded_by is null
      ) then
        v_unmet := array_append(v_unmet, r.prereq_label);
      end if;
    end if;
  end loop;

  return v_unmet;
end $$;
revoke execute on function export_doc_prereqs_unmet(bigint, text) from public;
grant   execute on function export_doc_prereqs_unmet(bigint, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Read views (security_invoker — inherit the caller's RLS on the base tables).
-- ════════════════════════════════════════════════════════════════════════════

-- 7a. v_export_pack_readiness — the traffic-light source: per shipment × every
--     doc_kind, is there a live issued doc, and (if not) which prereqs are unmet.
create view v_export_pack_readiness with (security_invoker = on) as
  select
    s.tenant_id,
    s.id                                         as shipment_id,
    k.doc_kind,
    exists(select 1 from export_documents d
            where d.shipment_id = s.id and d.doc_kind = k.doc_kind and d.superseded_by is null)
                                                 as issued,
    (select d.id from export_documents d
       where d.shipment_id = s.id and d.doc_kind = k.doc_kind and d.superseded_by is null
       limit 1)                                  as live_doc_id,
    export_doc_prereqs_unmet(s.id, k.doc_kind::text) as unmet_prereqs
  from export_shipments s
  cross join (select unnest(enum_range(null::export_doc_kind)) as doc_kind) k;

-- 7b. v_export_doc_pack — the LIVE issued docs + their frozen payloads (PDF source).
create view v_export_doc_pack with (security_invoker = on) as
  select
    d.tenant_id,
    d.shipment_id,
    d.id        as doc_id,
    d.doc_kind,
    d.doc_no,
    d.payload,
    d.issued_at
  from export_documents d
  where d.superseded_by is null;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. Command RPCs — the ONLY write doors. SECURITY DEFINER, tenant-clamped,
--    idempotent on a tenant-qualified key, lot_event in the same txn.
-- ════════════════════════════════════════════════════════════════════════════

-- 8a. build_export_shipment — mints the JC-S-NNNN consignment number (per tenant,
--     advisory-locked so concurrent mints queue) for a contract.
create or replace function build_export_shipment(
  p_contract_id     bigint,
  p_port_of_loading text,
  p_bag_weight_kg   numeric,
  p_idempotency_key text
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
  select id into v_id from export_shipments where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then
    return v_id;                                   -- exactly-once replay
  end if;

  if not exists (select 1 from sales_contracts where id = p_contract_id and tenant_id = v_tenant) then
    raise exception 'unknown contract % for tenant', p_contract_id using errcode = 'foreign_key_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext('shipment_no:' || v_tenant::text));
  select coalesce(max((regexp_replace(shipment_no, '\D', '', 'g'))::bigint), 0) + 1
    into v_n
    from export_shipments
   where tenant_id = v_tenant and shipment_no ~ '^JC-S-[0-9]+$';
  v_no := 'JC-S-' || lpad(v_n::text, 4, '0');

  insert into export_shipments (tenant_id, contract_id, shipment_no, port_of_loading,
                                bag_weight_kg, idempotency_key)
  values (v_tenant, p_contract_id, v_no, coalesce(p_port_of_loading, 'Balboa, PA'),
          coalesce(p_bag_weight_kg, 30), v_key)
  returning id into v_id;

  return v_id;
end $$;
revoke execute on function build_export_shipment(bigint, text, numeric, text) from public;
grant   execute on function build_export_shipment(bigint, text, numeric, text) to authenticated;

-- 8b. add_shipment_line — net_kg = bags × the shipment's bag_weight. Inserts the
--     lot_shipments CLAIM FIRST (so prevent_oversell + the held-lot guard fire before
--     anything commits — no parallel counter), then the line carrying lot_shipment_id.
--     The contract line must belong to the SAME contract as the shipment (invariant 4:
--     a shipment can't load a lot it didn't reserve). Requires status 'building'.
create or replace function add_shipment_line(
  p_shipment_id     bigint,
  p_contract_line_id bigint,
  p_bags            integer,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant   uuid := current_tenant_id();
  v_key      text;
  v_id       bigint;
  v_ship     record;
  v_line     record;
  v_net      numeric;
  v_ship_no  text;
  v_lsid     bigint;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;
  select id into v_id from export_shipment_lines where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then
    return v_id;                                   -- exactly-once replay (no second draw)
  end if;

  select * into v_ship from export_shipments where id = p_shipment_id and tenant_id = v_tenant;
  if not found then
    raise exception 'unknown shipment % for tenant', p_shipment_id using errcode = 'foreign_key_violation';
  end if;
  if v_ship.status <> 'building' then
    raise exception 'shipment % is % — cannot load more lines (must be building)', v_ship.shipment_no, v_ship.status
      using errcode = 'check_violation';
  end if;

  select * into v_line from contract_lines where id = p_contract_line_id and tenant_id = v_tenant;
  if not found then
    raise exception 'unknown contract line % for tenant', p_contract_line_id using errcode = 'foreign_key_violation';
  end if;
  if v_line.contract_id <> v_ship.contract_id then
    raise exception 'contract line % does not belong to shipment %''s contract — cannot load a lot it did not reserve',
      p_contract_line_id, v_ship.shipment_no using errcode = 'check_violation';
  end if;

  v_net := p_bags * v_ship.bag_weight_kg;

  -- The money guarantee, REUSED: insert the lot_shipments claim FIRST so the EXISTING
  -- prevent_oversell trigger fires (no parallel counter). destination tags the export.
  insert into lot_shipments (tenant_id, green_lot_code, destination, kg)
  values (v_tenant, v_line.green_lot_code, 'export:' || v_ship.shipment_no, v_net)
  returning id into v_lsid;

  insert into export_shipment_lines (tenant_id, shipment_id, contract_line_id, green_lot_code,
                                     bags, net_kg, lot_shipment_id, idempotency_key)
  values (v_tenant, p_shipment_id, p_contract_line_id, v_line.green_lot_code,
          p_bags, v_net, v_lsid, v_key)
  returning id into v_id;

  return v_id;
end $$;
revoke execute on function add_shipment_line(bigint, bigint, integer, text) from public;
grant   execute on function add_shipment_line(bigint, bigint, integer, text) to authenticated;

-- 8c. issue_export_doc — THE GATED WRITER. Evaluates export_doc_prereqs_unmet; on a
--     non-empty result raises with the EXACT missing-prerequisite list (auditor-honest,
--     never a blank doc). On pass: renders the frozen payload snapshot from live data +
--     each lot's eudr_lot_status, mints the doc_no, supersedes any prior live doc of
--     that kind, inserts export_documents, appends 'export_doc_issued' per loaded green
--     lot (so verify_chain(lot) covers the export), and flips the shipment to
--     'docs_issued' when the B/L (the final doc) lands.
create or replace function issue_export_doc(
  p_shipment_id     bigint,
  p_doc_kind        text,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant  uuid := current_tenant_id();
  v_key     text;
  v_id      bigint;
  v_kind    export_doc_kind;
  v_ship    record;
  v_unmet   text[];
  v_old     bigint;
  v_n       bigint;
  v_no      text;
  v_payload jsonb;
  r         record;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key  := v_tenant::text || ':' || p_idempotency_key;
  v_kind := p_doc_kind::export_doc_kind;

  select id into v_id from export_documents where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then
    return v_id;                                   -- exactly-once replay (no second issue)
  end if;

  select * into v_ship from export_shipments where id = p_shipment_id and tenant_id = v_tenant;
  if not found then
    raise exception 'unknown shipment % for tenant', p_shipment_id using errcode = 'foreign_key_violation';
  end if;

  -- THE HEADLINE GATE: prerequisites evaluated against LIVE state. Fail closed with
  -- the EXACT unmet list — never an empty/false document.
  v_unmet := export_doc_prereqs_unmet(p_shipment_id, p_doc_kind);
  if array_length(v_unmet, 1) > 0 then
    raise exception 'export doc % blocked — unmet prerequisites: %',
      p_doc_kind, array_to_string(v_unmet, '; ')
      using errcode = 'check_violation';
  end if;

  -- render the frozen payload snapshot from live data (consignee, lots, EUDR verdicts,
  -- net/gross kg). gross = net here (no separately-tracked tare — the $0 posture).
  select jsonb_build_object(
           'doc_kind',        p_doc_kind,
           'shipment_no',     v_ship.shipment_no,
           'port_of_loading', v_ship.port_of_loading,
           'contract_no',     c.contract_no,
           'incoterm',        c.incoterm,
           'consignee',       jsonb_build_object('name', b.name, 'country_code', b.country_code),
           'issued_at',       now(),
           'total_bags',      coalesce((select sum(bags)   from export_shipment_lines where shipment_id = p_shipment_id), 0),
           'total_net_kg',    coalesce((select sum(net_kg) from export_shipment_lines where shipment_id = p_shipment_id), 0),
           'lines', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'green_lot_code', l.green_lot_code,
                      'bags',           l.bags,
                      'net_kg',         l.net_kg,
                      'eudr_status',    eudr_lot_status(l.green_lot_code))
                      order by l.id)
               from export_shipment_lines l where l.shipment_id = p_shipment_id), '[]'::jsonb)
         )
    into v_payload
    from sales_contracts c
    join b2b_buyers b on b.id = c.buyer_id and b.tenant_id = c.tenant_id
   where c.id = v_ship.contract_id and c.tenant_id = v_tenant;

  -- mint the doc number (per tenant, advisory-locked).
  perform pg_advisory_xact_lock(hashtext('export_doc_no:' || v_tenant::text));
  select coalesce(max((regexp_replace(doc_no, '\D', '', 'g'))::bigint), 0) + 1
    into v_n
    from export_documents
   where tenant_id = v_tenant and doc_no ~ '^JC-XD-[0-9]+$';
  v_no := 'JC-XD-' || lpad(v_n::text, 4, '0');

  -- supersession: if a live doc of this kind already exists, tombstone it FIRST (point
  -- it at ITSELF transiently) so the partial unique index frees the live slot, insert
  -- the new doc, then repoint the old doc at the new one. The freeze trigger permits
  -- these superseded_by-only updates; the payload of neither row is ever rewritten.
  select id into v_old from export_documents
   where tenant_id = v_tenant and shipment_id = p_shipment_id and doc_kind = v_kind
     and superseded_by is null;
  if v_old is not null then
    update export_documents set superseded_by = id where id = v_old;   -- transient self-tombstone
  end if;

  insert into export_documents (tenant_id, shipment_id, doc_kind, doc_no, payload, idempotency_key)
  values (v_tenant, p_shipment_id, v_kind, v_no, v_payload, v_key)
  returning id into v_id;

  if v_old is not null then
    update export_documents set superseded_by = v_id where id = v_old; -- final pointer
  end if;

  -- append 'export_doc_issued' per distinct loaded green lot (verify_chain coverage).
  for r in
    select distinct green_lot_code from export_shipment_lines where shipment_id = p_shipment_id
  loop
    perform record_lot_event(
      r.green_lot_code, 'export_doc_issued',
      jsonb_build_object('shipment_id', p_shipment_id, 'shipment_no', v_ship.shipment_no,
                         'doc_kind', p_doc_kind, 'doc_no', v_no, 'doc_id', v_id),
      now(), 'server', nextval('lot_code_seq'), v_key || ':' || r.green_lot_code);
  end loop;

  -- the B/L is the final instrument: once it issues the pack is complete.
  if v_kind = 'bill_of_lading' then
    update export_shipments set status = 'docs_issued'
     where id = p_shipment_id and tenant_id = v_tenant and status = 'building';
  end if;

  return v_id;
end $$;
revoke execute on function issue_export_doc(bigint, text, text) from public;
grant   execute on function issue_export_doc(bigint, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. RLS — tenant-scoped read on the three tenant tables; export_doc_prereqs is
--    global reference data (read by everyone). Writes flow through the SECDEF RPCs
--    (which bypass RLS + self-clamp the tenant), so NO insert/update/delete policy.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['export_shipments','export_shipment_lines','export_documents']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'create policy "tenant read" on public.%I for select to authenticated
         using (tenant_id = current_tenant_id());', t);
  end loop;
end $$;

-- export_doc_prereqs — GLOBAL trade-rule reference (units / statutory_rates posture).
alter table export_doc_prereqs enable row level security;
create policy "reference read" on public.export_doc_prereqs for select to authenticated
  using (true);

-- ════════════════════════════════════════════════════════════════════════════
-- 10. GRANTS (AD-8) — per-object SELECT to authenticated on every table/view (one
--     statement each so the name-anchored static guard matches). NO write grants;
--     anon gets NOTHING. RPC execute is revoked-from-public-then-granted above.
-- ════════════════════════════════════════════════════════════════════════════
grant select on export_shipments        to authenticated;
grant select on export_shipment_lines   to authenticated;
grant select on export_documents        to authenticated;
grant select on export_doc_prereqs      to authenticated;
grant select on v_export_pack_readiness to authenticated;
grant select on v_export_doc_pack       to authenticated;

commit;
