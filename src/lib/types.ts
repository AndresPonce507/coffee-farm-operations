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
