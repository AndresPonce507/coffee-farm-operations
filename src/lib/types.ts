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
