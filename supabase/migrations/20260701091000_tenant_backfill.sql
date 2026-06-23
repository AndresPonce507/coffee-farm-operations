-- ════════════════════════════════════════════════════════════════════════════
-- P4-S0 · Migration 2 of 3 — backfill tenant_id = the default estate
-- ════════════════════════════════════════════════════════════════════════════
-- Every pre-existing row predates multi-tenancy and therefore belongs to the single
-- default estate ('janson-coffee'). Set tenant_id on every scoped table. Naturally
-- idempotent (`where tenant_id is null`) — re-running is a no-op. MUST complete for
-- ALL tables before M3's `set not null` (no row may be orphaned out of visibility).
--
-- Self-wrapped begin;…commit;.

begin;

do $$
declare
  t          text;
  v_default  uuid := _default_tenant_id();
begin
  foreach t in array array[
    'plots','workers','lots','crews','reserve_zones','farm_season_config',
    'pay_period','dispatch_run','weather','drying_stations','ferment_recipes',
    'lot_event','worker_stream_event','cost_entry','weigh_event','attendance_event',
    'green_lots','processing_batches','lot_reservations','lot_shipments',
    'ferment_batches','ferment_readings','mill_water_log','drying_assignments',
    'moisture_readings','cupping_sessions','cupping_scores','green_defects',
    'qc_holds','lot_edges',
    'plot_phenology','maturation_signal','pasada_schedule','plot_vegetation_index',
    'scouting_observation','spray_application',
    'worker_identity','worker_certifications','por_obra_contracts','crew_memberships',
    'harvests','tasks','dispatch_assignment','dispatch_acknowledgement',
    'dispatch_outbound','pay_line','disbursement','crew_plot'
  ]
  loop
    execute format('update %I set tenant_id = $1 where tenant_id is null;', t)
      using v_default;
  end loop;
end $$;

commit;
