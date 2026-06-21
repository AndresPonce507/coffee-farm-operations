-- S8 — EUDR due-diligence traceability: prove every green lot's plots of origin
-- are geolocated and declared deforestation-free since the regulation cutoff.
--
-- The EU Deforestation Regulation (EUDR) requires an operator placing coffee on
-- the EU market to hold, per lot, the GEOLOCATION of every plot of production and
-- evidence the commodity is "deforestation-free" — i.e. the land carried no
-- deforestation after the cutoff of 2020-12-31. This slice turns the S3 lot graph
-- + S1 plot geometry into that dossier: it walks UP a green lot's lineage to the
-- plots that actually fed it, then asks two questions of each — is it geolocated
-- (an S1 GeoJSON polygon + centroid), and has the owner declared it
-- deforestation-free? A green lot is COMPLIANT only when EVERY origin plot answers
-- yes to both; otherwise the dossier names exactly what is missing (the honest
-- "cannot substantiate" posture an auditor needs — never a fabricated green tick).
--
-- Resolution (D-EUDR-1): origin plots = the plots whose harvests fed ANY lot in
-- the green lot's ancestry. lot_origin_plots is ONE security_invoker view that
-- runs the recursive UP-walk (child_code -> parent_code over lot_edges) for ALL
-- green lots at once, carrying each green lot's code as the walk root, then joins
-- harvests -> plots. eudr_lot_status(lot) collapses a lot's origin plots into a
-- verdict; eudr_declare_plot(...) is the owner's affirmative declaration writer.
--
-- WHY a recursive view, not a matview (cf. S7's mv_lot_cost): the cardinality is
-- tiny (plots per lot), the read is not on a hot per-row path, and the verdict
-- must reflect a just-made declaration immediately — a plain security_invoker
-- view is the honest, always-fresh choice (ADR-003: matview only when earned).
--
-- GRANTS (AD-8 + the S3/S5/S7 lesson): lot_origin_plots gets SELECT to
-- authenticated; eudr_lot_status is a security_invoker .rpc() (reads the view as
-- the caller); eudr_declare_plot is SECURITY DEFINER (it writes plots under the
-- single-owner posture) so it FIRST revokes EXECUTE from public, THEN grants only
-- to authenticated. Nothing to anon.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. plots EUDR declaration columns. The deforestation-free claim is the OWNER's
--    affirmative declaration (nullable = NOT yet declared = the dossier reads
--    "incomplete", never an implicit pass). `basis` records HOW the claim is
--    substantiated (a plot established before the cutoff carried no new clearing;
--    or satellite / field evidence); `declared_at` stamps it for the audit trail.
-- ──────────────────────────────────────────────────────────────────────────
alter table plots
  add column if not exists eudr_deforestation_free boolean,            -- owner's affirmative claim (null = undeclared)
  add column if not exists eudr_decl_basis          text,              -- how it's substantiated
  add column if not exists eudr_declared_at         timestamptz;       -- when the claim was made

-- the basis must be one of the documented evidence kinds when a claim is present.
alter table plots
  add constraint plots_eudr_basis_chk check (
    eudr_decl_basis is null
    or eudr_decl_basis in ('established-pre-cutoff', 'satellite-monitoring', 'field-survey')
  );

-- D-EUDR review CRIT: enforce the two compliance invariants at the DATA LAYER, so
-- they hold even on a direct UPDATE (authenticated has a write grant on plots),
-- not just inside eudr_declare_plot. Without these, a green lot could read a FALSE
-- 'compliant' — the worst case the slice exists to prevent.
--   (1) a deforestation-free claim must carry a basis (no unsubstantiated pass);
--   (2) the 'established-pre-cutoff' basis is a FACTUAL claim the DB can falsify —
--       it is only valid when the plot was established on/before the 2020-12-31
--       EUDR cutoff. A plot established after 2020 cannot use it.
alter table plots
  add constraint plots_eudr_decl_complete_chk check (
    not coalesce(eudr_deforestation_free, false) or eudr_decl_basis is not null
  );
alter table plots
  add constraint plots_eudr_pre_cutoff_chk check (
    eudr_decl_basis is distinct from 'established-pre-cutoff'
    or established_year <= 2020
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 2. lot_origin_plots — THE traceability view. For every green lot, the distinct
--    plots that fed ANY lot in its ancestry, each carrying the two EUDR facts:
--    `geolocated` (an S1 GeoJSON polygon AND centroid are present) and
--    `deforestation_free` (the owner declared it). security_invoker so it reads
--    lots/lot_edges/harvests/plots under the caller's RLS.
--
--    The recursive CTE seeds one row per green lot (green_lot_code = its own code)
--    and walks UP (join lot_edges on child_code = the current lot) accumulating
--    ancestor lots while KEEPING the green_lot_code root, so a single pass covers
--    every green lot. `union` (not `union all`) dedupes shared ancestors and is
--    the cycle guard the S7 review flagged the cost walk lacked — a lot already in
--    the working set is never re-walked, so even a (today unreachable) lot_edges
--    cycle terminates instead of spinning.
-- ──────────────────────────────────────────────────────────────────────────
create view lot_origin_plots with (security_invoker = on) as
with recursive ancestry as (
  -- seed: each green lot is the root of its own up-walk.
  select g.code as green_lot_code, g.code as lot_code
    from lots g
   where g.stage = 'green'
  union
  -- climb one edge toward the parents of any lot already reached.
  select a.green_lot_code, e.parent_code
    from ancestry a
    join lot_edges e on e.child_code = a.lot_code
)
select distinct
  a.green_lot_code,
  p.id              as plot_id,
  p.name            as plot_name,
  p.established_year,
  p.centroid,
  -- EUDR geolocation: a REAL GeoJSON polygon AND a real centroid point. Checking
  -- the GeoJSON `type` (not merely `is not null`) rejects a JSON-null ('null'::jsonb),
  -- an empty '{}', or a non-Polygon blob — any of which would otherwise pass the
  -- gate and let a plot with no real boundary read as geolocated (review CRIT).
  coalesce(
    p.geom ->> 'type' in ('Polygon', 'MultiPolygon')
      and p.centroid ->> 'type' = 'Point',
    false
  ) as geolocated,
  -- EUDR deforestation-free: the owner's affirmative declaration (null -> false).
  coalesce(p.eudr_deforestation_free, false)      as deforestation_free,
  p.eudr_decl_basis                                as decl_basis
  from ancestry a
  join harvests h on h.lot_code = a.lot_code
  join plots    p on p.id       = h.plot_id;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. eudr_lot_status — the per-lot verdict (security_invoker .rpc()):
--      'compliant'  : ≥1 origin plot AND every origin plot is geolocated AND
--                     declared deforestation-free.
--      'incomplete' : has origin plots, but at least one is missing geolocation
--                     or the declaration (the dossier names which).
--      'no-origin'  : NO origin plot could be traced — the lineage doesn't reach
--                     a harvested plot, so origin CANNOT be substantiated. This is
--                     surfaced honestly (an auditor red flag), never a false pass.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function eudr_lot_status(p_lot_code text) returns text
  language sql
  security invoker
  stable
  set search_path = public
as $$
  select case
           when count(*) = 0 then 'no-origin'
           when bool_and(geolocated and deforestation_free) then 'compliant'
           else 'incomplete'
         end
    from lot_origin_plots
   where green_lot_code = p_lot_code;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. eudr_declare_plot — the owner's deforestation-free declaration writer.
--    SECURITY DEFINER (writes plots under the single-owner posture), search_path
--    pinned. Clearing the claim (p_free = false) nulls the basis so a withdrawn
--    declaration leaves no stale evidence string. Idempotent; raises on an
--    unknown plot rather than silently no-op'ing.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function eudr_declare_plot(
  p_plot_id text,
  p_free    boolean,
  p_basis   text default null
) returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if p_free and p_basis is null then
    raise exception 'a deforestation-free declaration requires a basis'
      using errcode = 'check_violation';
  end if;
  update plots
     set eudr_deforestation_free = p_free,
         eudr_decl_basis          = case when p_free then p_basis else null end,
         eudr_declared_at         = now()
   where id = p_plot_id;
  if not found then
    raise exception 'unknown plot %', p_plot_id using errcode = 'foreign_key_violation';
  end if;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. GRANTS (AD-8). SELECT on the traceability view to authenticated; nothing to
--    anon. Both functions get PUBLIC execute slammed shut first (the S3/S5/S7
--    lesson — Postgres grants EXECUTE to PUBLIC by default), then authenticated
--    only. eudr_declare_plot is the definer plot writer; eudr_lot_status is the
--    invoker read verdict.
-- ──────────────────────────────────────────────────────────────────────────
grant select on lot_origin_plots to authenticated;

revoke execute on function eudr_lot_status(text)                    from public;
revoke execute on function eudr_declare_plot(text, boolean, text)   from public;
grant  execute on function eudr_lot_status(text)                    to authenticated;
grant  execute on function eudr_declare_plot(text, boolean, text)   to authenticated;

commit;
