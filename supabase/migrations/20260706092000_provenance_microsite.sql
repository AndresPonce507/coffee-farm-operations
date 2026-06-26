-- ════════════════════════════════════════════════════════════════════════════
-- P3-S13 · PUBLIC per-lot QR provenance microsite (GS1 Digital Link).
-- ════════════════════════════════════════════════════════════════════════════
-- Spec: docs/design/PHASE3-DESIGN.md lines 327-344 (+ §1 cross-slice rails + §0.2
--       inherited facts). THE SECURITY-CRITICAL SLICE — it opens the ONE anon door
--       in all of Phase 3: a curated, PUBLISHED-only projection of a green lot's
--       story, served on jansoncoffee.com behind a bag QR (GS1 Digital Link).
-- Deps: P3-S11 (product_skus / products, 20260706090000), Phase-1 lot graph
--       (lots / lot_edges / green_lots / lot_origin_plots / eudr_lot_status /
--       harvests / plots / workers), record_lot_event / lot_code_seq, the P4-S0
--       tenant seam (current_tenant_id / RLS).
-- Live max at authoring: 20260706091000_storefront_orders_subs.sql — this timestamp
--       (20260706092000) is strictly greater; single schema author for the serial lane.
--
-- ── THE KEYSTONE INVARIANT (the slice's, and the phase's) ──────────────────────
--   NO PUBLIC PII / COST / OVERSELL / UNPUBLISHED LEAK. Enforced by, together:
--     (a) the `is_published` curation gate inside BOTH the public view and the
--         definer resolver — nothing reaches anon until the owner publishes;
--     (b) the projection selects LITERAL whitelisted columns, NEVER `select *` and
--         NEVER a column that could carry worker phone/wage, COGS, a buyer, or the
--         warehouse location (cupping_score + sca_grade are the ONLY green-lot facts
--         exposed; the picker is reduced to an anonymized CREW label);
--     (c) a static guard test (s13_provenance_microsite.db.test.ts) asserts anon's
--         table/view SELECT surface == EXACTLY {sku_provenance_public} and that anon
--         can reach NOTHING else — any future migration widening it fails CI (the
--         dead-guard-is-an-incident discipline).
--
-- §1 RAILS HONORED:
--   * ONE write door — publish/unpublish flow through SECURITY DEFINER, tenant-
--     clamped, idempotent RPCs; NO client INSERT/UPDATE/DELETE grant on the curation
--     table (its single mutation path is the definer RPC, exactly like eudr_declare_plot).
--   * AD-8/AD-9 grants EXACTLY — per-object `grant select ... to authenticated` (one
--     statement each); every RPC `revoke execute ... from public` THEN grant. The ONLY
--     anon grants in the whole phase live HERE: `select on sku_provenance_public to anon`
--     and `execute on resolve_provenance to anon`. Nothing else touches anon.
--   * HASH-CHAINED AUDIT — publish/unpublish append a lot_event on the green lot's
--     chain via record_lot_event in the same txn, so verify_chain covers the bag's
--     public-life decisions too.
--   * MARGIN/COST TRUTH UNTOUCHED, OVERSELL UNTOUCHED — this slice commits NO green
--     inventory and reads NO cost; it is a pure read-projection + curation gate.
--   * tenant_id + current_tenant_id() + RLS on the new table.
-- Paid gate: GS1 GTIN allocation has an annual fee — the $0 path uses internal/
--   unlicensed identifiers in the Digital Link URL; the resolver does not care.
--
-- FUTURE ANON DOORS (S19 accolade strip `v_lot_reputation_public`, S20 storage-cert
--   projection): those slices leave a TODO marker; when they land they add their
--   single anon grant HERE and extend the static guard's expected set. They do NOT
--   exist on disk yet, so this migration grants anon exactly the two objects above.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. provenance_pages — the per-SKU curation record. NOT a ledger: `is_published`
--    toggles and `curated_story` is editable, so it is a mutable config row written
--    ONLY through the definer RPCs (no client UPDATE/DELETE grant — the RPC bypasses
--    RLS and self-clamps). `slug` is GLOBALLY unique so the anon resolver can find a
--    page tenant-lessly (a public visitor carries no JWT / no tenant). INHERITED
--    tenant idiom (tenant_id default current_tenant_id() + the partial idem index).
-- ════════════════════════════════════════════════════════════════════════════
create table provenance_pages (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  sku_id          bigint  not null references product_skus(id),
  slug            text    not null,                 -- GS1 Digital Link path segment
  gtin            text,                             -- GS1 bag identity (may be unlicensed)
  is_published    boolean not null default false,   -- THE curation gate (false until published)
  curated_story   text,
  idempotency_key text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint provenance_pages_tenant_idem_ux unique (tenant_id, idempotency_key),
  constraint provenance_pages_tenant_sku_ux  unique (tenant_id, sku_id),
  constraint provenance_pages_slug_ux        unique (slug)
);
create index provenance_pages_tenant_idx on provenance_pages (tenant_id);
create index provenance_pages_sku_idx     on provenance_pages (sku_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. sku_provenance_public — THE hardened curated projection (the anon-readable
--    door). DELIBERATELY a DEFINER view (NO security_invoker): it runs as the view
--    owner so an anonymous caller — who has no RLS read on any source table — still
--    sees published rows, while the WHERE clause and the LITERAL whitelisted column
--    list are the wall. It exposes ONLY: the page's slug/gtin/curated_story, the
--    retail product facts, the green-lot code, and the TWO permitted quality facts
--    (cupping_score, sca_grade). It NEVER selects green_lots.location, any cost,
--    any reservation/buyer, or any worker column. `where is_published` is the gate.
--    (This is the single intentional exception to the §1 "every view is
--     security_invoker" convention — annotated so the anomaly is auditable.)
-- ════════════════════════════════════════════════════════════════════════════
create view sku_provenance_public as
select
  pp.slug,
  pp.gtin,
  pp.curated_story,
  ps.green_lot_code,
  ps.pack_format,
  ps.bag_size,
  pr.name        as product_name,
  pr.variety,
  pr.process,
  gl.cupping_score,           -- permitted quality fact
  gl.sca_grade,               -- permitted quality fact (generated band)
  l.is_single_origin
from provenance_pages pp
join product_skus ps on ps.id = pp.sku_id and ps.tenant_id = pp.tenant_id
join products     pr on pr.id = ps.product_id and pr.tenant_id = pp.tenant_id
join green_lots   gl on gl.tenant_id = pp.tenant_id and gl.lot_code = ps.green_lot_code
join lots         l  on l.tenant_id  = pp.tenant_id and l.code     = gl.lot_code
where pp.is_published;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. resolve_provenance(slug) — THE anon door fn. SECURITY DEFINER, search_path
--    pinned, returns the ASSEMBLED public JSON for a PUBLISHED slug ONLY (NULL for
--    unpublished/unknown). It reads ONLY the whitelisted projection + the EUDR /
--    origin-plot / anonymized-crew facts — it can never reach workers.phone/wage,
--    cost_entry, mv_lot_cost, lot_reservations, or an unpublished SKU. The is_published
--    gate is the FIRST thing it checks; an unpublished or unknown slug short-circuits
--    to NULL before any join runs.
--
--    Origin/EUDR: lot_origin_plots (security_invoker, but runs as THIS definer's owner
--    here, so it sees the rows) + eudr_lot_status() supply the plot names, geolocation
--    and deforestation-free verdict. The picker is collapsed to the distinct CREW
--    labels of the lot's harvests — never a name, phone, or wage. The processing
--    timeline exposes ONLY each lot_event's kind + occurred_at (NEVER the free-form
--    payload, which could carry anything) — a leak-safe ferment/dry chronology.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function resolve_provenance(p_slug text) returns jsonb
  language plpgsql security definer stable set search_path = public, extensions
as $$
declare
  v_tenant uuid;
  v_green  text;
  v_result jsonb;
begin
  -- Curation gate FIRST: only a PUBLISHED page resolves. Unknown/unpublished ⇒ NULL.
  select pp.tenant_id, ps.green_lot_code
    into v_tenant, v_green
    from provenance_pages pp
    join product_skus ps on ps.id = pp.sku_id and ps.tenant_id = pp.tenant_id
   where pp.slug = p_slug and pp.is_published
   limit 1;
  if v_green is null then
    return null;
  end if;

  select to_jsonb(spp) - 'curated_story'
         || jsonb_build_object(
              'curated_story', spp.curated_story,
              'eudr_status',   eudr_lot_status(v_green),
              'origin_plots',  coalesce((
                  select jsonb_agg(jsonb_build_object(
                           'plot_name',          op.plot_name,
                           'established_year',   op.established_year,
                           'centroid',           op.centroid,
                           'geolocated',         op.geolocated,
                           'deforestation_free', op.deforestation_free)
                         order by op.plot_name)
                    from lot_origin_plots op
                   where op.green_lot_code = v_green), '[]'::jsonb),
              'crew_labels',   coalesce((
                  -- anonymized: the crew LABEL only — never a worker name/phone/wage.
                  select jsonb_agg(distinct w.crew)
                    from lot_origin_plots op
                    join harvests h on h.plot_id = op.plot_id
                    join workers  w on w.id = h.worker_id
                   where op.green_lot_code = v_green), '[]'::jsonb),
              'processing_timeline', coalesce((
                  -- leak-safe: kind + occurred_at ONLY; the payload is never projected.
                  select jsonb_agg(jsonb_build_object('kind', e.kind, 'occurred_at', e.occurred_at)
                         order by e.occurred_at)
                    from lot_event e
                   where e.stream_key = v_green), '[]'::jsonb))
    into v_result
    from sku_provenance_public spp
   where spp.slug = p_slug;

  return v_result;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. publish_provenance — the owner curation writer. SECURITY DEFINER, tenant-
--    clamped, idempotent on the client key. UPSERTS the page for the SKU and flips
--    is_published = true. Validates the SKU belongs to the tenant (a page can never
--    be minted for another tenant's bag). Appends a 'provenance_published' lot_event
--    on the green lot's chain in the same txn.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function publish_provenance(
  p_sku_id          bigint,
  p_slug            text,
  p_gtin            text,
  p_curated_story   text,
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

  -- Idempotent replay: this exact command already applied ⇒ return the same page.
  select id into v_id from provenance_pages
   where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then return v_id; end if;

  -- The SKU must belong to this tenant (and yields the green lot for the audit event).
  select green_lot_code into v_green
    from product_skus where id = p_sku_id and tenant_id = v_tenant;
  if v_green is null then
    raise exception 'unknown sku % for this tenant', p_sku_id using errcode = 'foreign_key_violation';
  end if;

  insert into provenance_pages
    (tenant_id, sku_id, slug, gtin, is_published, curated_story, idempotency_key, updated_at)
  values
    (v_tenant, p_sku_id, p_slug, p_gtin, true, p_curated_story, v_key, now())
  on conflict (tenant_id, sku_id) do update
    set slug            = excluded.slug,
        gtin            = excluded.gtin,
        is_published    = true,
        curated_story   = excluded.curated_story,
        idempotency_key = excluded.idempotency_key,
        updated_at      = now()
  returning id into v_id;

  perform record_lot_event(
    v_green, 'provenance_published',
    jsonb_build_object('sku_id', p_sku_id, 'page_id', v_id, 'slug', p_slug),
    now(), 'server', nextval('lot_code_seq'), v_key || ':published');

  return v_id;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. unpublish_provenance — take a page back down (is_published = false). Same
--    definer/tenant-clamp/idempotent posture; appends 'provenance_unpublished'.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function unpublish_provenance(
  p_sku_id          bigint,
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

  select id into v_id from provenance_pages
   where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then return v_id; end if;  -- idempotent replay

  update provenance_pages
     set is_published = false, idempotency_key = v_key, updated_at = now()
   where tenant_id = v_tenant and sku_id = p_sku_id
  returning id into v_id;
  if v_id is null then
    raise exception 'no provenance page for sku % in this tenant', p_sku_id
      using errcode = 'foreign_key_violation';
  end if;

  select green_lot_code into v_green
    from product_skus where id = p_sku_id and tenant_id = v_tenant;
  perform record_lot_event(
    v_green, 'provenance_unpublished',
    jsonb_build_object('sku_id', p_sku_id, 'page_id', v_id),
    now(), 'server', nextval('lot_code_seq'), v_key || ':unpublished');

  return v_id;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. RLS — tenant-scoped read on provenance_pages for the OWNER admin UI (anon gets
--    NO policy and NO grant here — it only ever sees the published view). All writes
--    flow through the SECDEF RPCs (they bypass RLS + self-clamp), so NO insert/update/
--    delete policy.
-- ════════════════════════════════════════════════════════════════════════════
alter table provenance_pages enable row level security;
create policy "tenant read" on public.provenance_pages for select to authenticated
  using (tenant_id = current_tenant_id());

-- ════════════════════════════════════════════════════════════════════════════
-- 7. GRANTS.
--    AD-8 — per-object SELECT to authenticated (one statement each).
--    THE ONE ANON DOOR IN ALL OF PHASE 3 — and nothing more: anon gets SELECT on the
--    published-only curated view and EXECUTE on the definer resolver. anon gets
--    NOTHING on provenance_pages or any source table.
-- ════════════════════════════════════════════════════════════════════════════
grant select on provenance_pages     to authenticated;
grant select on sku_provenance_public to authenticated;

-- ↓↓↓ the curated public surface — the SINGLE intentional anon grant of the phase ↓↓↓
grant select on sku_provenance_public to anon;

-- RPCs: slam PUBLIC execute shut first, then grant. resolve_provenance is the public
-- door (anon + authenticated); publish/unpublish are owner-only (authenticated).
revoke execute on function resolve_provenance(text)                                from public;
revoke execute on function publish_provenance(bigint, text, text, text, text)      from public;
revoke execute on function unpublish_provenance(bigint, text)                      from public;
grant  execute on function resolve_provenance(text)                                to anon, authenticated;
grant  execute on function publish_provenance(bigint, text, text, text, text)      to authenticated;
grant  execute on function unpublish_provenance(bigint, text)                      to authenticated;

commit;
