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
  // P3-S0 pricing spine — market-data ledgers + versioned rule config. No
  // tenant-carrying parent FK; tenant_id default current_tenant_id(), RPC-only writes.
  "ice_c_quotes", // dual_regime_pricing.sql — ICE "C" marks (append-only)
  "auction_comps", // dual_regime_pricing.sql — reserve comp library (append-only)
  "differential_schedule", // dual_regime_pricing.sql — commodity bands (versioned)
  "reserve_price_model", // dual_regime_pricing.sql — reserve coefficients (versioned)
  // P3-S1 B2B trade trunk — CRM master + contract header (no tenant-carrying parent FK;
  // tenant_id default current_tenant_id(), RPC-only writes).
  "b2b_buyers", // b2b_offers_contracts.sql — green-buyer CRM master
  "sales_contracts", // b2b_offers_contracts.sql — standards-based contract header
  // P3-S4 specialty auctions — the auction header (no tenant-carrying parent FK;
  // tenant_id default current_tenant_id(), RPC-only writes).
  "auctions", // specialty_auctions.sql — BoP/CoE/Algrano auction header
  // P3-S7 dry-mill readiness — the dry-mill chain registry (no tenant-carrying parent
  // FK; tenant_id default current_tenant_id(), owner-seeded read-only).
  "mill_machines", // dry_milling_readiness.sql — huller→…→optical-sorter registry
  // P3-S10 roasting — the roaster registry + the versioned golden-curve library. No
  // tenant-carrying parent FK; tenant_id default current_tenant_id(), RPC/seed writes.
  "roasters", // roasting.sql — per-tenant roaster registry (seeded, read-only)
  "roast_profiles", // roasting.sql — versioned golden-curve library (one-way status lock)
  // P3-S11 storefront catalog — the roasted-SKU master. No tenant-carrying parent FK;
  // tenant_id default current_tenant_id(), RPC-only writes.
  "products", // storefront_skus.sql — roasted-SKU product master
  // P3-S12 DTC orders — the customer book is the retail CRM root (no tenant-carrying
  // parent FK; tenant_id default current_tenant_id(), RPC-only writes).
  "customers", // storefront_orders_subs.sql — DTC contact book
  // P3-S13 provenance microsite — the per-SKU curation record. tenant_id default
  // current_tenant_id(), tenant-scoped read policy, RPC-only writes (publish/unpublish).
  // anon never reads this table — only the published sku_provenance_public view.
  "provenance_pages", // provenance_microsite.sql — per-SKU public-page curation gate
  // P3-S14 offline POS — the till is a physical farm asset, tenant_id default
  // current_tenant_id() (no tenant-carrying parent FK), like products/customers.
  "pos_terminals", // pos.sql — registered POS terminals (Janson Farm Store / Lagunas Café)
  // P3-S16 accounting spine — the FX SSOT + the revenue journal source. No
  // tenant-carrying parent FK; tenant_id default current_tenant_id().
  "fx_rate", // accounting_sales.sql — canonical daily rate SSOT (append-only, RPC-only write)
  "revenue_entry", // accounting_sales.sql — revenue-side mirror of cost_entry; green_lot_code un-FK'd (DIRECT, like cost_entry)
  "ar_doc", // accounting_sales.sql — AR instrument header; soft-refs to buyer/contract, no tenant-parent FK
  // P3-S17 accounting sync seam — account map + the idempotent post queue + the inbound
  // pull log. No tenant-carrying parent FK; tenant_id default current_tenant_id(),
  // RPC-only writes (set_account_map / issue_ar_doc / claim_sync_batch / apply_sync_inbound).
  "account_map", // accounting_sync.sql — our-ledger → buyer-account-code mapping (config)
  "sync_outbox", // accounting_sync.sql — idempotent append-only post queue (content-hash key)
  "sync_inbound", // accounting_sync.sql — append-only log of pulls FROM QBO/Xero (idempotent on target+external_id)
  // P3-S18 direct-trade CRM — the mutable contact anchor + its hash-chained relationship
  // ledger. No tenant-carrying parent FK (buyer_id is nullable); tenant_id default
  // current_tenant_id(), RPC-only writes. contact_events is a lot_event-style ledger
  // (stream_key='contact:<id>'), DIRECT-stamped at the append RPC like lot_event.
  "contacts", // crm_contacts.sql — the green-buyer/relationship CRM anchor (mutable)
  "contact_events", // crm_contacts.sql — append-only, hash-chained PII relationship ledger
  // P3-S20 storage + marketing — DIRECT-stamped (tenant_id default current_tenant_id()).
  // storage_locations: only FK is to tenants (no tenant-carrying parent). marketing_campaigns:
  // green_lot_code parent is nullable (like contacts.buyer_id) → DIRECT. marketing_segments: no FK.
  "storage_locations", // storage_and_marketing.sql — controlled-environment config (RPC-only write)
  "marketing_campaigns", // storage_and_marketing.sql — campaign header (nullable lot FK)
  "marketing_segments", // storage_and_marketing.sql — saved audience definitions
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
  // P3-S0 pricing spine — binding price tables (inherit via the green lot / quote).
  "price_quotes", // dual_regime_pricing.sql — via green_lots (tenant,lot_code) composite FK
  "fixations", // dual_regime_pricing.sql — via price_quotes + lot_reservations
  // P3-S1 B2B trade trunk — published offers + contract lines (inherit via the green
  // lot / parent contract).
  "green_offers", // b2b_offers_contracts.sql — via green_lots (tenant,lot_code) composite FK
  "contract_lines", // b2b_offers_contracts.sql — via sales_contracts + green_lots
  // P3-S2 B2B sample ledger — inherits via the green lot (tenant,green_lot_code).
  "green_samples", // b2b_samples.sql — via green_lots (tenant,lot_code) composite FK
  // P3-S18 CRM sample dispatches — the THIRD oversell-guarded claim table; inherits via
  // the green lot (tenant,green_lot_code) composite FK, like lot_reservations/lot_shipments.
  "sample_dispatches", // crm_contacts.sql — via green_lots (tenant,lot_code) composite FK
  // P3-S19 reputation ledger — append-only, hash-chained accolades bound to a lot via
  // the (tenant_id, lot_code) -> lots(tenant_id, code) composite FK. RPC-only-write.
  "lot_accolades", // reputation_ledger.sql — cup scores / awards / certs (append-only)
  // P3-S4 specialty auctions — entries inherit via the green lot; scoresheets via the entry.
  "auction_entries", // specialty_auctions.sql — via green_lots (tenant,lot_code) composite FK
  "auction_scoresheets", // specialty_auctions.sql — via auction_entries (append-only jury capture)
  // P3-S3 export-doc-pack — shipment (via the contract), lines (via the shipment /
  // green lot), and the append-only issued-doc ledger (via the shipment).
  "export_shipments", // export_doc_pack.sql — via sales_contracts
  "export_shipment_lines", // export_doc_pack.sql — via export_shipments + green_lots
  "export_documents", // export_doc_pack.sql — via export_shipments (append-only legal ledger)
  // P3-S7 dry-mill readiness + run skeleton — both bind to the parchment lot via the
  // composite (tenant_id, parchment_lot_code) -> lots(tenant_id, code) FK.
  "mill_readiness", // dry_milling_readiness.sql — the pre-mill reposo/spec gate (append-only)
  "milling_runs", // dry_milling_readiness.sql — one parchment lot through the chain
  // P3-S8 machine-pass chain + byproducts — passes inherit via run_id -> milling_runs;
  // byproducts via run_id -> milling_runs AND the minted (tenant_id, byproduct_lot_code)
  // -> lots composite FK. Both RPC-only-write, append-only ledgers.
  "mill_passes", // dry_milling_passes.sql — the ordered machine-chain ledger
  "mill_byproducts", // dry_milling_passes.sql — each byproduct = its own conserved lots node
  // P3-S9 finalize — the SCA green-grade ledger inherits via the green lot composite
  // (tenant_id, green_lot_code) -> green_lots(tenant_id, lot_code) FK. Append-only,
  // RPC-only write (finalize_milling_run auto-grades; record_green_grade re-grades).
  "mill_grade", // dry_milling_finalize.sql — SCA Arabica green grade (sca_prep GENERATED)
  // P3-S10 roasting — the roasted-node header inherits via the green lot composite
  // (tenant_id, green_lot_code) -> green_lots; the .alog capture ledgers + roast SKUs
  // inherit via batch_id -> roast_batches. All RPC-only-write.
  "roast_batches", // roasting.sql — the roasted lots-node header (shrinkage_pct GENERATED)
  "roast_curve_points", // roasting.sql — Artisan .alog BT/ET/RoR time-series (append-only)
  "roast_events", // roasting.sql — roast phase markers (append-only)
  "roast_alog_imports", // roasting.sql — .alog receipt + deviation-vs-golden (append-only)
  "roast_skus", // roasting.sql — roast→product link for the per-bag QR
  // P3-S11 storefront catalog — the lot-linked SKU inherits via the green lot composite
  // (tenant_id, green_lot_code) -> green_lots; finished_goods (aggregate, one per SKU)
  // and fg_ledger (append-only movements) inherit via sku_id -> product_skus. All
  // RPC-only-write (create_sku / record_fg_movement); finished_goods is mutated only by
  // the fg_ledger trigger.
  "product_skus", // storefront_skus.sql — via green_lots (tenant,lot_code) composite FK
  "finished_goods", // storefront_skus.sql — per-SKU retail inventory aggregate (available GENERATED)
  "fg_ledger", // storefront_skus.sql — append-only finished-goods movement ledger
  // P3-S12 DTC orders + Reserve-Club subs — orders inherit via customer_id -> customers;
  // order_lines + webhook_events via orders; subscriptions via customers;
  // subscription_lines + sub_events via subscriptions; sub_allocations via subscriptions
  // (+ the green_lots composite FK). All RPC-only-write; the ledgers are append-only.
  "orders", // storefront_orders_subs.sql — via customers
  "order_lines", // storefront_orders_subs.sql — via orders (captures green_lot_code)
  "webhook_events", // storefront_orders_subs.sql — via orders (Stripe exactly-once PK)
  "subscriptions", // storefront_orders_subs.sql — via customers
  "subscription_lines", // storefront_orders_subs.sql — via subscriptions
  "sub_allocations", // storefront_orders_subs.sql — via subscriptions + green_lots (append-only claim)
  "sub_events", // storefront_orders_subs.sql — via subscriptions (append-only lifecycle ledger)
  // P3-S14 offline POS — a POS sale is 1:1 with its channel='pos' order; inherits via
  // order_id -> orders (and terminal_id -> pos_terminals). RPC-only-write (record_pos_sale).
  "pos_sales", // pos.sql — via orders (offline exactly-once on (device_id, device_seq))
  // P3-S16 accounting spine — AR lines, inbound cash, and realized FX all inherit
  // tenant via the composite (ar_doc_id, tenant_id) -> ar_doc FK. RPC-only-write
  // (issue_ar_doc / settle_ar_payment, P3-S17); all append-only ledgers.
  "ar_doc_line", // accounting_sales.sql — via ar_doc
  "ar_payment", // accounting_sales.sql — via ar_doc (append-only inbound cash; cap + status triggers)
  "fx_gain_loss_entry", // accounting_sales.sql — via ar_doc (append-only realized FX, two-rate CHECK)
  // P3-S20 storage + marketing — INHERITED via a tenant-carrying parent FK hop.
  "storage_readings", // storage_and_marketing.sql — via storage_locations (append-only time-series)
  "storage_certificates", // storage_and_marketing.sql — via green_lots (append-only, cert_hash-bound)
  "marketing_outbound", // storage_and_marketing.sql — via marketing_campaigns + contacts (consent-gated queue)
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
  "export_doc_prereqs", // export_doc_pack.sql — GLOBAL trade-rule reference (MIDA/ICO/Incoterms), shared
  "tenants", // §3 — the tenancy root; has no tenant_id of its own
  "tenant_users", // §3 — the membership map / trust anchor
]);
