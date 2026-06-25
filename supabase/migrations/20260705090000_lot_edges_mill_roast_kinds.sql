-- ════════════════════════════════════════════════════════════════════════════
-- P3-S6 · Lot-graph prereq — mill/roast/byproduct edge-kinds + enum extensions
--          + yield-curve rows. The prereq schema the dry-milling/roasting slices
--          (P3-S7..S10) build on. Single schema author; ordered strictly after the
--          latest applied migration (live max 20260704093000_export_doc_pack.sql).
-- ════════════════════════════════════════════════════════════════════════════
-- Spec: docs/design/PHASE3-DESIGN.md lines 261-265 (+ §1 cross-slice rails).
--
-- What this does — and DELIBERATELY does NOT do:
--   * Widens the `lot_edges.kind` CHECK to admit 'mill' / 'roast' / 'byproduct' so a
--     mill output, roast batch, and byproduct stream are each a mass-conserved
--     lot_edges child WITHOUT touching the kind-agnostic lot_edges_conserve_mass()
--     trigger. The money/mass guarantee is REUSED, never re-implemented (§0.2/§1.4):
--     every new edge kind is guarded by the existing advisory-free conservation
--     trigger for free.
--   * Extends the batch_stage / activity_kind enums and adds the milling/roasting
--     domain enums the downstream slices declare columns against.
--   * Seeds real mill (parchment→green outturn) + roast (green→roasted shrinkage)
--     yield factors into the existing lot_yield_curve reference table.
--
-- No new TABLE, VIEW, or RPC is introduced here, so no AD-8 grant block is needed:
--   - lot_edges / lot_yield_curve keep their existing `grant select to authenticated`
--     + revoked-anon posture (asserted unchanged by the slice's db test).
--   - new enum TYPEs need no grant (type USAGE is not part of grant_hygiene); anon
--     gains NOTHING (the keystone anon-surface invariant is preserved).
--   - no untrusted-inbound write path, no lot_event append (a schema-shape change,
--     not a commercial decision) — those land in S7+ when the runs actually post.
--
-- Risk note (spec): `alter type … add value` cannot use the new label in the SAME
-- transaction in Postgres, but it CAN be declared inside one. We only DECLARE the
-- new labels here (the yield-curve rows reference plain `text` columns, never the
-- enums), so a single wrapped migration is safe — the proven P2-S3 fermentation
-- pattern (`alter type task_category add value if not exists 'Ferment Cut'`).
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Widen the lot_edges.kind CHECK — admit the three transform edge-kinds.
--    The constraint name is the inline auto-generated `lot_edges_kind_check`
--    (event_log_units_lot_graph migration, never renamed). Drop + re-add with the
--    superset; the kind-agnostic conservation trigger is UNTOUCHED.
-- ──────────────────────────────────────────────────────────────────────────
alter table lot_edges drop constraint lot_edges_kind_check;
alter table lot_edges add  constraint lot_edges_kind_check
  check (kind in ('split','merge','blend','process','mill','roast','byproduct'));

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Extend the two existing enums (idempotent; declared-not-used in this txn).
-- ──────────────────────────────────────────────────────────────────────────
alter type batch_stage   add value if not exists 'roasted';
alter type activity_kind add value if not exists 'roast';
alter type activity_kind add value if not exists 'milling';

-- ──────────────────────────────────────────────────────────────────────────
-- 3. New milling/roasting domain enums (columns declared against these in S7..S10).
--    `if not exists` guards keep the migration replay-safe.
-- ──────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'pass_type') then
    create type pass_type as enum
      ('huller','polisher','screen_grader','gravity_table','optical_sorter');
  end if;
  if not exists (select 1 from pg_type where typname = 'roast_level') then
    create type roast_level as enum
      ('light','medium-light','medium','medium-dark','dark');
  end if;
  if not exists (select 1 from pg_type where typname = 'roaster_type') then
    create type roaster_type as enum
      ('drum','fluid_bed','sample');
  end if;
  if not exists (select 1 from pg_type where typname = 'roast_profile_status') then
    create type roast_profile_status as enum
      ('draft','approved','retired');
  end if;
  if not exists (select 1 from pg_type where typname = 'byproduct_kind') then
    create type byproduct_kind as enum
      ('husk','chaff','screen_rejects','defects');
  end if;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Real mill/roast yield factors into the existing lot_yield_curve reference.
--    Direct transform-edge factors (the prior chain only carried the per-stage
--    placeholders). from_stage/to_stage are plain `text`, so 'roasted' here does
--    NOT require the new batch_stage label to be committed.
--      * parchment→green : dry-mill outturn ~0.80 (washed parchment → green).
--      * green→roasted   : roast shrinkage ~0.84 (≈16% loss, specialty band).
-- ──────────────────────────────────────────────────────────────────────────
insert into lot_yield_curve (from_stage, to_stage, yield_factor) values
  ('parchment', 'green',   0.80),   -- dry-mill outturn (agronomy-review placeholder)
  ('green',     'roasted', 0.84)    -- roast shrinkage (~16% loss)
on conflict (from_stage, to_stage) do nothing;

commit;
