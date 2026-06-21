/**
 * Authoritative domain types for Janson Coffee — Farm Operations.
 * Every mock-data module and page MUST conform to these shapes (this is the contract
 * that lets the build fan out safely). Do not redefine these locally.
 */

export type ID = string;
export type ISODate = string; // "2026-06-20"

export type CoffeeVariety = "Geisha" | "Caturra" | "Catuaí" | "Pacamara" | "Typica";

/* ---------------- Plots (growing lots) ---------------- */
export type PlotStatus = "healthy" | "watch" | "at-risk";

export interface Plot {
  id: ID;
  name: string; // e.g. "Tizingal Alto"
  block: string; // e.g. "Block A"
  variety: CoffeeVariety;
  areaHa: number; // hectares
  altitudeMasl: number; // meters above sea level
  trees: number;
  shadePct: number; // canopy shade %
  establishedYear: number;
  status: PlotStatus;
  lastInspected: ISODate;
  expectedYieldKg: number; // season target (cherries)
  harvestedKg: number; // season-to-date
}

/* ---------------- Harvests (daily picking) ---------------- */
export type Ripeness = "underripe" | "ripe" | "overripe";

export interface Harvest {
  id: ID;
  date: ISODate;
  plotId: ID;
  plotName: string;
  picker: string; // worker name
  cherriesKg: number;
  ripenessPct: number; // % cherries ripe (0–100)
  brixAvg: number; // sugar content
  lotCode: string; // traceability code e.g. "JC-564"
}

/* ---------------- Workers (labor) ---------------- */
export type WorkerRole =
  | "Picker"
  | "Agronomist"
  | "Mill Operator"
  | "Supervisor"
  | "Driver";
export type AttendanceStatus = "present" | "absent" | "rest-day";

export interface Worker {
  id: ID;
  name: string;
  role: WorkerRole;
  dailyRateUsd: number;
  attendance: AttendanceStatus;
  startedYear: number;
  phone: string;
  todayKg: number; // cherries picked today (0 for non-pickers)
  crew: string; // e.g. "Crew Norte"
}

/* ---------------- Processing (wet mill → drying → green) ---------------- */
export type ProcessMethod = "Washed" | "Natural" | "Honey" | "Anaerobic";
export type BatchStage =
  | "cherry"
  | "fermentation"
  | "drying"
  | "parchment"
  | "milled"
  | "green";

export interface ProcessingBatch {
  id: ID;
  lotCode: string; // ties to Harvest.lotCode
  variety: CoffeeVariety;
  method: ProcessMethod;
  stage: BatchStage;
  startedDate: ISODate;
  cherriesKg: number; // input weight
  currentKg: number; // weight at current stage
  moisturePct: number; // for drying batches
  patio: string; // raised bed / patio id e.g. "Bed 7"
  progressPct: number; // 0–100 across the pipeline
}

/* ---------------- Tasks (agronomy work) ---------------- */
export type TaskCategory =
  | "Pruning"
  | "Fertilizing"
  | "Pest Control"
  | "Weeding"
  | "Planting"
  | "Irrigation"
  | "Soil";
export type TaskStatus = "todo" | "in-progress" | "done" | "blocked";
export type Priority = "low" | "medium" | "high";

export interface FarmTask {
  id: ID;
  title: string;
  category: TaskCategory;
  plotId: ID | null;
  plotName: string | null;
  assignee: string;
  due: ISODate;
  status: TaskStatus;
  priority: Priority;
}

/* ---------------- Dashboard aggregates ---------------- */
export interface TrendPoint {
  label: string; // e.g. "Mon" or "Jun 14"
  value: number;
}

export interface VarietyShare {
  variety: CoffeeVariety;
  kg: number;
}

export interface ActivityItem {
  id: ID;
  at: ISODate;
  kind: "harvest" | "processing" | "task" | "labor" | "shipment";
  text: string;
}

export interface WeatherDay {
  day: string; // "Today", "Fri"...
  hi: number; // °C
  lo: number; // °C
  rainPct: number;
  icon: "sun" | "cloud" | "rain" | "fog";
}

/* ====================================================================== */
/* S3 — Event spine (ADR-001 event-log-as-SSOT, ADR-002 command RPCs,     */
/* ADR-003 derived views). camelCase domain mirror of the migration       */
/* 20260621092000_event_log_units_lot_graph.sql.                          */
/* ====================================================================== */

/* ---------------- Units (UCUM-lite; what convert_qty operates over) ---------------- */
/** A row of the `units` table — declares a unit's dimension and factor to its base unit. */
export type UnitDimension =
  | "mass"
  | "volume"
  | "area"
  | "temperature"
  | "ratio"
  | "dimensionless";

export interface Unit {
  code: string; // UCUM code: 'kg','g','[brix]','%','m2','ha','Cel','L','count'
  dimension: UnitDimension;
  toBase: number; // multiply a value in `code` by this to get the dimension's base unit
  display: string; // human label, e.g. "°C", "°Bx"
}

/* ---------------- Lot event (append-only, hash-chained ledger) ---------------- */
/** One row of the `lot_event` ledger (ADR-001). `payload` is the event's JSONB body.
 *  `chainVerified` is a projection-side annotation (from verify_chain), not a stored column. */
export interface LotEvent {
  id: ID; // event_uid (uuid)
  streamKey: string; // stream_key — one stream per lot (or 'activity')
  kind: string; // event kind, e.g. 'cherry_intake', 'stage_advance'
  occurredAt: ISODate | string; // occurred_at — field wall-clock (timestamptz)
  recordedAt: ISODate | string; // recorded_at — server accept clock (timestamptz)
  deviceId: string; // device_id
  deviceSeq: number; // device_seq — monotonic per device (D4 replay safety)
  payload: Record<string, unknown>; // JSONB event body
  chainVerified?: boolean; // derived: verify_chain(stream) result, when computed
}

/* ---------------- Lot graph (genealogy DAG over promoted `lots`) ---------------- */
/** A node in the lot genealogy — the graph-node columns added to `lots` in S3. */
export interface LotNode {
  code: string; // lots.code — JC-NNN traceability code
  stage: BatchStage | string; // lots.stage
  variety: CoffeeVariety; // lots.variety
  originKg: number; // lots.origin_kg — mass at mint
  currentKg: number; // lots.current_kg — mass at current stage
  isSingleOrigin: boolean; // lots.is_single_origin
  mintedAt: ISODate | string; // lots.minted_at (timestamptz)
}

/** A directed edge in the genealogy DAG — mass on EVERY edge (D6). `kind` mirrors
 *  the lot_edges check constraint (split|merge|blend|process). */
export interface LotEdge {
  parentCode: string; // lot_edges.parent_code
  childCode: string; // lot_edges.child_code
  kind: "split" | "merge" | "blend" | "process";
  kg: number; // lot_edges.kg — mass routed across this edge (> 0)
}

/** A genealogy subgraph — the {nodes, edges} a lineage view returns. */
export interface LotGenealogy {
  nodes: LotNode[];
  edges: LotEdge[];
}

/* ====================================================================== */
/* S5 — GreenLot inventory + ATP (the first money-shaped slice). camelCase  */
/* domain mirror of migration 20260621093500_green_inventory.sql:          */
/* the `green_lots` detail row, the append-only claim rows                  */
/* (`lot_reservations`/`lot_shipments`), and the DERIVED `green_lots_atp`    */
/* available-to-promise view (atp = current_kg − Σreserved − Σshipped).     */
/* ====================================================================== */

/** The four SCA grade bands the `green_lots.sca_grade` generated column emits
 *  (D-INV-3) — derived from the cupping score, never disagreeing with it. */
export type ScaGrade =
  | "Presidential"
  | "Specialty"
  | "Premium"
  | "Below Specialty";

/** A GreenLot detail row — the green-specific columns keyed by the lot node code.
 *  The same `lots` node at stage='green' carries the graph identity (LotNode); this
 *  is the grade-input + location detail. `scaGrade` is the GENERATED band (D-INV-3),
 *  never stored independently of the cupping score it bands. */
export interface GreenLot {
  lotCode: string; // green_lots.lot_code — the PK the EUDR slice (S8) references un-FK'd
  cuppingScore: number; // green_lots.cupping_score — the measured grade input (0–100)
  scaGrade: ScaGrade | string; // green_lots.sca_grade — GENERATED band from cuppingScore
  location: string; // green_lots.location — warehouse / storage location
  gradedAt: ISODate | string; // green_lots.graded_at (timestamptz)
}

/** An append-only reservation claim against a green lot's ATP (`lot_reservations`).
 *  Reservations are never updated/deleted by clients — they accrete; ATP is derived. */
export interface Reservation {
  id: number; // lot_reservations.id (identity)
  greenLotCode: string; // lot_reservations.green_lot_code → green_lots.lot_code
  buyer: string; // lot_reservations.buyer
  kg: number; // lot_reservations.kg — committed mass (> 0)
  createdAt: ISODate | string; // lot_reservations.created_at (timestamptz, server-stamped)
}

/** An append-only shipment claim against a green lot's ATP (`lot_shipments`). */
export interface Shipment {
  id: number; // lot_shipments.id (identity)
  greenLotCode: string; // lot_shipments.green_lot_code → green_lots.lot_code
  destination: string; // lot_shipments.destination
  kg: number; // lot_shipments.kg — committed mass (> 0)
  createdAt: ISODate | string; // lot_shipments.created_at (timestamptz, server-stamped)
}

/** A row of the DERIVED `green_lots_atp` view — available-to-promise per green lot.
 *  `atp = currentKg − reservedKg − shippedKg` is computed in the view (never a
 *  stored counter), so it can never disagree with the claim rows it sums. */
export interface GreenLotAtp {
  greenLotCode: string; // green_lots_atp.green_lot_code
  scaGrade: ScaGrade | string; // green_lots_atp.sca_grade
  location: string; // green_lots_atp.location
  currentKg: number; // green_lots_atp.current_kg — the green node's sellable mass
  reservedKg: number; // green_lots_atp.reserved_kg — Σ reservations
  shippedKg: number; // green_lots_atp.shipped_kg — Σ shipments
  atp: number; // green_lots_atp.atp — currentKg − reservedKg − shippedKg
}

/* ====================================================================== */
/* S7 — Activity-based COGS: true cost-per-kg-green, the number the         */
/* business turns on. camelCase domain mirror of migration                 */
/* 20260621094000_costing.sql: the append-only `cost_entry` provenance      */
/* ledger and the cost-per-kg-green RESULT the cogs_per_lot()/cogs_per_plot()*/
/* .rpc() functions return (numeric, NULL on zero green-kg — never a        */
/* divide-by-zero). The matview `mv_lot_cost` does the recursive walk; the  */
/* port only reads the scalar verdict + the ledger rows behind it.          */
/* ====================================================================== */

/** What generated a cost — mirrors the `cost_entry.driver` check constraint. */
export type CostDriver = "worker-day" | "task" | "processing-batch";

/** How a cost is apportioned — mirrors the `cost_entry.allocation_rule` check.
 *  1. direct-labor → lot, 2. processing → lot (whole amount lands on the lot);
 *  3. agronomy → plot (split by harvested cherries-kg share); 4. overhead → farm
 *  (split across ALL green lots pro-rata by green-kg). */
export type AllocationRule =
  | "direct-labor"
  | "processing"
  | "agronomy"
  | "overhead";

/** The allocation TARGET kind — mirrors the `cost_entry.target_kind` check.
 *  A 'farm' row carries no target code (overhead); 'plot'/'lot' always name one. */
export type CostTargetKind = "plot" | "lot" | "farm";

/** One row of the append-only `cost_entry` provenance ledger (D-COST-1).
 *  Corrections are REVERSING ENTRIES — a negative-amount row pointing at the
 *  original via `reversesId`, never an UPDATE/DELETE. The ledger doubles as the
 *  future QBO/Xero journal source AND the audit trail behind every COGS figure. */
export interface CostEntry {
  id: number; // cost_entry.id (identity)
  driver: CostDriver | string; // cost_entry.driver — what generated the cost
  allocationRule: AllocationRule | string; // cost_entry.allocation_rule — one of the 4 rules
  targetKind: CostTargetKind | string; // cost_entry.target_kind — plot | lot | farm
  targetCode: string | null; // cost_entry.target_code — plots.id / lots.code; null for farm overhead
  amountUsd: number; // cost_entry.amount_usd — signed (a reversal is negative)
  reversesId: number | null; // cost_entry.reverses_id — self-FK to the row this corrects (null for an original)
  memo: string | null; // cost_entry.memo — free-text note
  occurredAt: ISODate | string; // cost_entry.occurred_at (timestamptz)
  createdAt: ISODate | string; // cost_entry.created_at (timestamptz, server-stamped)
}

/** The cost-per-kg-green verdict for one lot or plot — the scalar the
 *  cogs_per_lot()/cogs_per_plot() RPCs return. `costPerKgGreen` is NULL when the
 *  green-kg denominator is 0/undeclared (the RPC returns NULL, never a
 *  divide-by-zero raise) — the UI shows "—" rather than a fabricated 0. */
export interface LotCost {
  code: string; // the green lot's JC-NNN code, or a plot id
  costPerKgGreen: number | null; // cost-per-kg-green; null on zero/undeclared green-kg
}

/** One allocation rule's share of a green lot's FULLY-allocated cost — a row of
 *  the cogs_breakdown_per_lot() RPC (mirrors mv_lot_cost_by_rule). This is the
 *  SAME allocation the cogs_per_lot() headline divides (overhead pro-rata +
 *  agronomy plot-split + walked source costs all included), so Σ allocatedUsd /
 *  greenKg === the headline. The per-category card build-up reads THIS, never the
 *  lot-literal cost_entry ledger (which omitted those three and contradicted the
 *  total). */
export interface LotRuleCost {
  rule: AllocationRule | string; // cost_entry.allocation_rule — one of the 4 rules
  allocatedUsd: number; // this rule's apportioned USD on the lot (signed; reversals netted in-DB)
}

/* ====================================================================== */
/* S8 — EUDR due-diligence traceability: prove each green lot's plots of    */
/* origin are geolocated + declared deforestation-free since the 2020-12-31 */
/* cutoff. camelCase domain mirror of migration 20260621102000.            */
/* ====================================================================== */

/** The EU Deforestation Regulation cutoff date — land deforested AFTER this is
 *  non-compliant. A documented constant (shown as the dossier's reference date). */
export const EUDR_CUTOFF = "2020-12-31";

/** A green lot's EUDR verdict — mirrors the eudr_lot_status() RPC.
 *  'compliant'  : ≥1 origin plot AND every one geolocated + declared free.
 *  'incomplete' : has origin plots, but one is missing geolocation or declaration.
 *  'no-origin'  : the lineage reaches no harvested plot — origin can't be
 *                 substantiated (an honest auditor red flag, never a false pass). */
export type EudrStatus = "compliant" | "incomplete" | "no-origin";

/** One plot of origin behind a green lot, with the two EUDR facts — a
 *  lot_origin_plots row. `centroid` is the plot's [lng, lat] geolocation point
 *  (null when the plot isn't geolocated). */
export interface EudrOriginPlot {
  plotId: string; // plots.id
  plotName: string; // plots.name
  establishedYear: number; // plots.established_year (evidence the land pre-dates the cutoff)
  centroid: [number, number] | null; // [lng, lat] from the GeoJSON Point, null if ungeolocated
  geolocated: boolean; // a GeoJSON polygon AND centroid are present (EUDR geolocation)
  deforestationFree: boolean; // the owner's affirmative declaration
  declBasis: string | null; // how the claim is substantiated (null when undeclared)
}

/** A green lot's EUDR due-diligence dossier — the verdict + its plots of origin
 *  (the buyer/auditor artifact the whole slice exists to produce). */
export interface LotEudrDossier {
  code: string; // the green lot's JC-NNN code
  status: EudrStatus; // the authoritative eudr_lot_status() verdict
  originPlots: EudrOriginPlot[]; // the plots that fed this lot, each with its EUDR facts
}

/* ── P2-S8 — Ripeness-aware harvest planning & pasada scheduler ─────────────── */

/** Honest confidence for a readiness prediction — surfaced, never hidden.
 *  'high'   : a logged bloom date AND a corroborating signal (NDVI / recent ripeness).
 *  'medium' : a bloom date but no corroborating signal.
 *  'low'    : GDD-only, no bloom anchor — an honest "we're estimating". */
export type ReadinessConfidence = "high" | "medium" | "low";

/** The ripeness/yield band a pasada targets (drives the fired task's priority). */
export type RipenessTarget = "low" | "medium" | "high";

/** The lifecycle of a pasada (harvest-pass) plan. 'superseded' rows are history. */
export type PasadaStatus = "planned" | "dispatched" | "picked" | "superseded";

/** A plot's DERIVED harvest-readiness — a v_harvest_readiness row. Readiness is
 *  computed from GDD progress toward the bloom→cherry requirement (nudged by NDVI
 *  when present) and staggered by altitude; it is NEVER a hand-set flag. */
export interface PlotReadiness {
  plotId: string; // plots.id
  plotName: string; // plots.name
  variety: CoffeeVariety; // plots.variety
  altitudeMasl: number; // drives the stagger (lower ripens first)
  bloomDate: string | null; // logged bloom, null until recorded (an honest unknown)
  gddAccumulated: number; // GDD since bloom (from the weather feed)
  gddToCherry: number; // GDD required bloom→cherry (variety requirement)
  ndviLatest: number | null; // latest NDVI [0,1], null when no satellite signal
  recentRipenessPct: number | null; // corroborating observed ripeness, null when none
  readiness: number; // DERIVED readiness in [0,1]
  confidence: ReadinessConfidence; // how much to trust the prediction
  staggerDays: number; // extra ripening days from altitude
  predictedReadyDate: string | null; // projected pick date, null without a bloom anchor
}

/** A scheduled pasada (harvest pass) — a v_pasada_calendar row (active plans only). */
export interface PasadaPlan {
  id: number; // pasada_schedule.id
  plotId: string; // plots.id
  plotName: string; // plots.name
  variety: CoffeeVariety; // plots.variety
  altitudeMasl: number; // staggers the timeline down the gradient
  season: string; // e.g. '2026'
  pasadaNumber: number; // 1st pass, 2nd pass, …
  predictedReadyDate: string; // the planned pick date
  ripenessTarget: RipenessTarget; // the ripeness band this pass targets
  status: PasadaStatus; // 'planned' | 'dispatched' | 'picked'
  reason: string | null; // why this (re)plan exists, e.g. 'rain front'
  firedTaskId: string | null; // the tasks-board row this plan fired
}
