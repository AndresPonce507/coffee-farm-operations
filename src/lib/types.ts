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
  | "Soil"
  // System-fired harvest-pass tasks (P2-S8 schedule_pasada / replan_pasada).
  // Mirrors the DB `task_category` enum's additive 'Harvest' value so the
  // /tasks board can represent the fired task. Not a user-pickable form
  // category — it is created only by the pasada scheduler RPCs.
  | "Harvest";
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

/* ====================================================================== */
/* P2-S4 — Drying management + THE REPOSO GATE + capacity-tracked stations.  */
/* camelCase domain mirror of migration 20260622094000_drying_reposo.sql.   */
/* The reposo gate is a DATA-LAYER invariant (a precondition inside          */
/* advance_processing_stage + a BEFORE-UPDATE trigger backstop on lots): a   */
/* lot cannot advance drying→milled until moisture is stable in-band AND the */
/* minimum rest-days are met. These types are read-only projections of the   */
/* derived views; the only writers are the SECURITY DEFINER command RPCs.    */
/* ====================================================================== */

/** A drying station's kind — mirrors the `drying_stations.kind` check. */
export type DryingStationKind = "patio" | "raised-bed" | "guardiola" | "parabolic";

/** One drying station with its live committed-vs-capacity occupancy — a row of
 *  the DERIVED `station_occupancy` view (committed is Σ open assignments, never a
 *  stored counter, so it can never disagree with the assignment rows it sums). */
export interface StationOccupancy {
  stationId: string; // station_occupancy.station_id
  name: string; // station_occupancy.name
  kind: DryingStationKind | string; // station_occupancy.kind
  capacityKg: number; // station_occupancy.capacity_kg
  committedKg: number; // station_occupancy.committed_kg — Σ open assignments
  availableKg: number; // station_occupancy.available_kg — capacity − committed
}

/** A lot's REPOSO-GATE status — a row of the DERIVED `v_reposo_status` view (the
 *  reposo_status() function). `ready` is the gate's single source of truth: true
 *  only when moisture is stable in-band AND the rest-days threshold is met. The
 *  advance-to-mill button is disabled (with `reason`) until `ready` flips true —
 *  but the real enforcement is in the database, not this projection. */
export interface ReposoStatus {
  lotCode: string; // v_reposo_status.lot_code
  latestMoisture: number | null; // v_reposo_status.latest_moisture — null with no readings
  readingCount: number; // v_reposo_status.reading_count
  moistureStable: boolean; // v_reposo_status.moisture_stable — last N readings in-band, flat
  dryingStartedAt: string | null; // v_reposo_status.drying_started_at (timestamptz)
  restDaysElapsed: number | null; // v_reposo_status.rest_days_elapsed — null before drying
  restMet: boolean; // v_reposo_status.rest_met — rest_days ≥ min_reposo_days
  ready: boolean; // v_reposo_status.ready — the gate verdict (moistureStable AND restMet)
  reason: string; // v_reposo_status.reason — human-readable "why" (blocked or clear)
}

/** One moisture reading on a lot's drying curve — a row of the append-only
 *  `moisture_readings` ledger (immutable; a correction is a NEW reading, never an
 *  UPDATE). The curve is EVIDENCE the reposo gate and the cup-to-cause loop read. */
export interface MoistureReading {
  lotCode: string; // moisture_readings.lot_code
  moisturePct: number; // moisture_readings.moisture_pct
  occurredAt: string; // moisture_readings.occurred_at — field wall-clock
}

/** A drying lot's full drying-management view — its station, its reposo status,
 *  and its moisture curve — the shape the /process/[lot]/drying surface renders. */
export interface DryingLot {
  lotCode: string; // lots.code
  variety: CoffeeVariety | string | null; // lots.variety
  currentKg: number | null; // lots.current_kg — the resting mass
  stationId: string | null; // the open drying_assignments.station_id (null if unassigned)
  stationName: string | null; // the station's display name
  reposo: ReposoStatus; // the gate status for this lot
  curve: MoistureReading[]; // the lot's moisture readings, oldest → newest
}

/** A drying-station weather-cover risk row — a row of `v_drying_weather_risk`
 *  (the Phase-1 `weather` forecast feed × open-air stations). `coverRisk` flags an
 *  upcoming high-rain day for an open-air bed so the UI can fire a "cover" alert. */
export interface DryingWeatherRisk {
  stationId: string; // v_drying_weather_risk.station_id
  name: string; // v_drying_weather_risk.name
  kind: DryingStationKind | string; // v_drying_weather_risk.kind
  forecastOrder: number; // v_drying_weather_risk.forecast_order
  day: string; // v_drying_weather_risk.day
  rainPct: number; // v_drying_weather_risk.rain_pct
  icon: WeatherDay["icon"]; // v_drying_weather_risk.icon
  coverRisk: boolean; // rain_pct ≥ 60 AND icon = 'rain' on an open-air station
}

/* ====================================================================== */
/* P2-S6 — QC & cupping: SCA CVA (2023) + legacy 100-pt sessions, an        */
/* append-only cup-score ledger, a green-defect ledger, cupper-drift        */
/* calibration, and the QC-HOLD quarantine that BLOCKS a held green lot      */
/* from being reserved/shipped. camelCase domain mirror of migration        */
/* 20260622096000_qc_cupping.sql. Every score binds back through            */
/* greenLotCode → green_lots → the lot graph (cup-to-cause).                 */
/* ====================================================================== */

/** The two scoring protocols a cupping session can run — mirrors the
 *  `cupping_sessions.protocol` CHECK. `sca-cva` is the 2023 SCA Cupping
 *  Form / affective scale; `legacy-100` is the classic 100-point scoresheet. */
export type CuppingProtocol = "sca-cva" | "legacy-100";

/** A green-defect band — mirrors the `green_defects.category` CHECK. Primary
 *  defects (full black, sour, fungus) are disqualifying; secondary are quality. */
export type DefectCategory = "primary" | "secondary";

/** A cupping session — one cupping of a green lot under a protocol by a cupper.
 *  `isCalibration` flags a SHARED calibration sample the drift view measures bias
 *  against. Binds back to `greenLotCode` for the cup-to-cause loop. */
export interface CuppingSession {
  id: number; // cupping_sessions.id (identity)
  greenLotCode: string; // cupping_sessions.green_lot_code → green_lots.lot_code
  cupperId: string; // cupping_sessions.cupper_id → workers.id
  protocol: CuppingProtocol | string; // cupping_sessions.protocol
  isCalibration: boolean; // cupping_sessions.is_calibration
  occurredAt: ISODate | string; // cupping_sessions.occurred_at (field wall-clock)
}

/** One row of the DERIVED `v_cup_final_score` view — the protocol-correct total
 *  for a session, computed (never stored) so it can't disagree with its scores. */
export interface CupFinalScore {
  sessionId: number; // v_cup_final_score.session_id
  greenLotCode: string; // v_cup_final_score.green_lot_code
  cupperId: string; // v_cup_final_score.cupper_id
  protocol: CuppingProtocol | string; // v_cup_final_score.protocol
  isCalibration: boolean; // v_cup_final_score.is_calibration
  finalScore: number; // v_cup_final_score.final_score — Σ attribute scores
  attributeCount: number; // v_cup_final_score.attribute_count
}

/** One row of the DERIVED `v_cupper_drift` view — a cupper's systematic bias on
 *  a shared calibration attribute (their mean − the panel mean). Surfaced as
 *  EVIDENCE, never a hard block (you correct for known drift, you don't reject). */
export interface CupperDrift {
  cupperId: string; // v_cupper_drift.cupper_id
  attribute: string; // v_cupper_drift.attribute
  cupperMean: number; // v_cupper_drift.cupper_mean
  panelMean: number; // v_cupper_drift.panel_mean
  drift: number; // v_cupper_drift.drift — cupperMean − panelMean (signed)
  sampleN: number; // v_cupper_drift.sample_n
}

/** One row of the DERIVED `v_qc_status` view — the per-lot QC roll-up the banner
 *  and table read: held state + open-hold reason, latest cup final, defect tallies. */
export interface QcStatus {
  greenLotCode: string; // v_qc_status.green_lot_code
  held: boolean; // v_qc_status.held — an open qc_hold exists → un-sellable
  holdReason: string | null; // v_qc_status.hold_reason — the open hold's reason
  latestCupScore: number | null; // v_qc_status.latest_cup_score — most recent session final
  primaryDefects: number; // v_qc_status.primary_defects — Σ primary defect counts
  secondaryDefects: number; // v_qc_status.secondary_defects — Σ secondary defect counts
}

/** An append-only green-defect ledger row (`green_defects`). */
export interface GreenDefect {
  id: number; // green_defects.id (identity)
  greenLotCode: string; // green_defects.green_lot_code → green_lots.lot_code
  defectKind: string; // green_defects.defect_kind
  count: number; // green_defects.count
  category: DefectCategory | string; // green_defects.category
}

/* ====================================================================== */
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

/* ====================================================================== */
/* P2-S5 — Morning crew dispatch (ripeness-aware bilingual shareable card)  */
/* ====================================================================== */

/** The outbound lifecycle of a dispatch run. 'superseded' rows are history. */
export type DispatchStatus = "draft" | "sent" | "acknowledged" | "superseded";

/** The delivery channel a dispatch card was shared through. The default $0 path is
 *  'web-share' (the device's native share sheet into WhatsApp, manually);
 *  'whatsapp-cloud' is a DORMANT, flagged paid drop-in. */
export type DispatchChannel = "web-share" | "copy-link" | "whatsapp-cloud" | "sms";

/** One plot line of a dispatch card — a `v_dispatch_card_plots` row mapped. The
 *  ripeness/readiness are SNAPSHOTTED at plan time (the card is reproducible). */
export interface DispatchPlot {
  id: number; // dispatch_assignment.id
  dispatchRunId: number; // dispatch_run.id
  plotId: string; // plots.id
  plotName: string; // plots.name
  variety: CoffeeVariety; // plots.variety
  altitudeMasl: number; // staggers the card down the gradient
  taskKind: string; // e.g. 'picking'
  targetKg: number | null; // optional per-plot target, null when none set
  ripenessTarget: RipenessTarget; // the ripeness band this plot targets
  readiness: number; // DERIVED readiness in [0,1] at plan time
  ord: number; // pasada/readiness display order
}

/** A renderable morning dispatch card — a `v_dispatch_card` row mapped, plus its
 *  plot lines. "Crew Norte → plots X, Y ripe today" — owner-initiated outbound. */
export interface DispatchCard {
  id: number; // dispatch_run.id
  crewId: string; // crews.id
  crewName: string; // crews.name
  dispatchDate: string; // the morning this dispatch is for
  season: string; // e.g. '2026'
  status: DispatchStatus; // draft | sent | acknowledged
  sentChannel: DispatchChannel | null; // the channel it was shared through, if sent
  readinessThreshold: number; // the readiness cut-off the plots were chosen by
  idempotencyKey: string | null; // the exactly-once anchor
  plotCount: number; // how many plots the card lists
  plots: DispatchPlot[]; // the per-plot lines, in pasada/readiness order
}

/* ====================================================================== */
/* ── P2-S12 — Satellite NDVI/SAR fusion + IPM scouting + spray log ──────────── */
/* ====================================================================== */

/** Honest fused-vegetation confidence — surfaced, NEVER hidden (the differentiator).
 *  'high'   : a recent, low-cloud optical (Sentinel-2) read.
 *  'medium' : optical cloudy/stale, carried by cloud-penetrating SAR (Sentinel-1).
 *  'low'    : no trustworthy signal — an honest "we can't see clearly right now". */
export type VegetationConfidence = "high" | "medium" | "low";

/** A plot's fused vegetation read — a v_plot_vegetation row. Optical NDVI/NDRE fused
 *  with SAR backscatter; the `confidence` + `basis` make the cloud honest. */
export interface PlotVegetation {
  plotId: string; // plots.id
  plotName: string; // plots.name
  variety: CoffeeVariety; // plots.variety
  altitudeMasl: number; // plots.altitude_masl
  value: number | null; // the fused index value, null when no trustworthy signal
  indexKind: string | null; // 'ndvi' | 'ndre' | 'sar-backscatter' that carried it
  confidence: VegetationConfidence; // ALWAYS surfaced
  basis: "optical" | "sar"; // which signal carried the read (badge copy)
  cloudPct: number | null; // scene cloud cover at capture (null for SAR/none)
  observedAt: string | null; // when the chosen scene was observed
}

/** A scouting observation's threshold status — a v_ipm_threshold row. The economic
 *  -threshold engine's recommend/hold call bound to the plot + pest. */
export interface IpmThresholdStatus {
  plotId: string; // plots.id
  plotName: string; // plots.name
  pestKind: string; // 'broca' | 'roya' | …
  incidencePct: number; // the latest observed incidence
  threshold: number | null; // the published action threshold, null if unknown pest
  recommend: boolean; // at-or-above threshold → recommend control
  observedAt: string; // when the scouting read was taken
  firedTaskId: string | null; // the control task this crossing fired, if any
}

/** A spray application's PHI/REI status — a v_plot_phi_status row. Drives the
 *  pre-harvest-interval / re-entry-interval countdown chips and the harvest block. */
export interface PlotPhiStatus {
  plotId: string; // plots.id
  plotName: string; // plots.name
  product: string; // the applied product
  activeIngredient: string | null;
  appliedAt: string; // when it was applied
  phiClearsOn: string; // pre-harvest interval clears (no pick before this)
  reiClearsAt: string; // re-entry interval clears (no entry before this)
  phiActive: boolean; // is a pre-harvest interval still blocking a pick?
  reiActive: boolean; // is a re-entry interval still blocking entry?
}

/** One spray-log entry as the history view returns it — a v_spray_history row. */
export interface SprayLogEntry {
  id: number; // spray_application.id
  plotId: string; // plots.id
  plotName: string; // plots.name
  product: string;
  activeIngredient: string | null;
  phiDays: number; // pre-harvest interval in days
  reiHours: number; // re-entry interval in hours
  appliedAt: string;
  workerId: string; // the (certified) applicator
  workerName: string;
}
