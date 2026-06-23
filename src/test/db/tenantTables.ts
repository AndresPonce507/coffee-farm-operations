// P4-S0 — Single Source of Truth for the multi-tenant scoping surface.
//
// THIS IS A CONTRACT FILE. The P4-S0 migration's `do $$ foreach` scoping loop and
// the cross-tenant probe test (`p4s0_tenant_isolation.db.test.ts`) BOTH import these
// arrays. They must never drift: a table appears in EXACTLY ONE of TENANT_TABLES or
// EXEMPT, and the static parity guard (§8 block 4) reconciles this list against
// `pg_class` so any RLS-enabled base table missing from both sets REDS the suite.
//
// Derived verbatim from docs/design/P4-S0-multi-tenant-plan.md §2.A (DIRECT tenant_id
// roots) + §2.B (FK-inherited tenant_id). The plan's §2.4 explicitly warns NOT to
// reuse the stale `auth_required_rls.sql` 12-name array — this list is built fresh.

/**
 * §2.A — DIRECT tenant_id. Aggregate roots with no tenant-carrying parent FK, plus
 * the no-FK orphan ledgers/costing tables (RPC-populated at append). These get
 * `tenant_id uuid not null references tenants(id)` authored independently.
 */
export const DIRECT_TENANT_TABLES = [
  // aggregate roots (no FK to a tenant-carrying parent)
  "plots", // init.sql:27 — the land root, no FK
  "workers", // init.sql:44 — the people root, no FK
  "lots", // init.sql:57 — bare code PK, NO plot FK -> the lot-graph root (the fault line)
  "crews", // people_system.sql:46 — only nullable lead_worker_id; tenant-level grouping
  "reserve_zones", // plot_geometry.sql:32 — conservation geometry, no FK
  "farm_season_config", // derived_metrics.sql:32 — singleton config -> per-tenant (drop id=1)
  "pay_period", // payroll.sql:135 — text-PK payroll period root, no FK
  "dispatch_run", // crew_dispatch.sql:55 — direct (dispatch RLS stands alone); same-tenant guard vs crews
  "weather", // init.sql ~107 — per-farm forecast strip, no FK
  "drying_stations", // drying_reposo.sql:50 — physical farm asset -> direct
  "ferment_recipes", // fermentation.sql:38 — per-tenant proprietary IP; self-FK only
  // no-FK hash-chained ledgers / costing orphans — DIRECT, stamped at the append RPC
  "lot_event", // event_log_units_lot_graph.sql — only free-text stream_key, no FK
  "worker_stream_event", // people_system.sql:146 — stream_key='worker:<id>', no FK
  "cost_entry", // costing.sql:53 — true orphan: target_code deliberately un-FK'd
  // hash-chained but FK-carrying ledgers; still DIRECT-stamped at append (head-select keys on stream_key)
  "weigh_event", // weigh_capture.sql:91
  "attendance_event", // people_system.sql:61
] as const;

/**
 * §2.B — INHERITED tenant_id. Every other scoped table proves its tenant by one FK
 * hop to a tenant-carrying ancestor; it still gets a `tenant_id` column (for RLS
 * predicate locality + index perf), backfilled FROM the parent.
 */
export const INHERITED_TENANT_TABLES = [
  // lot subtree (root: lots)
  "green_lots", // green_inventory.sql:39 — lot_code -> lots
  "processing_batches", // init.sql:79 — lot_code -> lots
  "lot_reservations", // via green_lots
  "lot_shipments", // via green_lots
  "ferment_batches", // fermentation.sql:98 — lot_code -> lots
  "ferment_readings", // via ferment_batches
  "mill_water_log", // via ferment_batches
  "drying_assignments", // drying_reposo.sql:71 — lot_code -> lots
  "moisture_readings", // via drying_assignments
  "cupping_sessions", // qc_cupping.sql:41 — via green_lots
  "cupping_scores", // via cupping_sessions
  "green_defects", // via green_lots
  "qc_holds", // via green_lots
  "lot_edges", // event_log_units_lot_graph.sql:89 — parent_code/child_code -> lots
  // plot subtree (root: plots)
  "plot_phenology", // harvest_planning.sql:60
  "maturation_signal", // harvest_planning.sql:75
  "pasada_schedule", // harvest_planning.sql:112
  "plot_vegetation_index", // remote_sensing_ipm.sql:53
  "scouting_observation", // remote_sensing_ipm.sql:77
  "spray_application", // remote_sensing_ipm.sql:100
  // worker subtree (root: workers)
  "worker_identity", // people_system.sql:80
  "worker_certifications", // people_system.sql:238
  "por_obra_contracts", // people_system.sql:217
  "crew_memberships", // people_system.sql:61 — junction (also crew_id -> crews)
  // multi-parent operational tables (inherit via any tenant-bound parent).
  // NB weigh_event is listed under DIRECT (it is hash-chained + stamped at the append
  // RPC), so it is intentionally NOT repeated here.
  "harvests", // init.sql:64 — the plot<->lot bridge
  "tasks", // init.sql:94
  "dispatch_assignment", // via dispatch_run
  "dispatch_acknowledgement", // via dispatch_run
  "dispatch_outbound", // via dispatch_run
  "pay_line", // via pay_period
  "disbursement", // via pay_period
  // crew routing map — FK-inherited via crew_id -> crews AND plot_id -> plots.
  // NOTE (flagged to orchestrator): the plan's §2.B enumeration OMITTED `crew_plot`
  // (crew_dispatch.sql:164). It is a real RLS-enabled base table with the same
  // FK-inherited shape as the rest of this group, so it belongs in the scoping loop.
  // The static parity guard (§8 block 4) would RED the suite if it were missing.
  "crew_plot",
] as const;

/**
 * The full ~54-table scoped surface the P4-S0 migration loops over and the probe
 * iterates. DIRECT ∪ INHERITED, deduped, frozen.
 */
export const TENANT_TABLES: readonly string[] = Object.freeze(
  Array.from(new Set([...DIRECT_TENANT_TABLES, ...INHERITED_TENANT_TABLES])),
);

/**
 * §2.C + the tenancy substrate itself — RLS-enabled base tables that are
 * DELIBERATELY NOT tenant-scoped. The static parity guard allows exactly these to be
 * RLS-enabled-but-absent-from-TENANT_TABLES; anything else reds the suite.
 *
 *  - units / lot_yield_curve / statutory_rates: global reference data (§2.C). Each
 *    keeps `using(true)` — shared catalogs / Panama national law / house yield curve.
 *  - tenants / tenant_users: the tenancy substrate itself (§3). They cannot be scoped
 *    BY tenant_id (tenants HAS no tenant_id; tenant_users is the membership map and is
 *    scoped by `tenant_id = current_tenant_id()` on its own terms, not via this loop).
 */
export const EXEMPT: readonly string[] = Object.freeze([
  "units", // event_log_units_lot_graph.sql:31 — UCUM unit registry (shared)
  "lot_yield_curve", // event_log_units_lot_graph.sql:186 — house yield factors (shared default)
  "statutory_rates", // payroll.sql:97 — Panama CSS/seguro/décimo (national law)
  "tenants", // §3 — the tenancy root; has no tenant_id of its own
  "tenant_users", // §3 — the membership map / trust anchor
]);
