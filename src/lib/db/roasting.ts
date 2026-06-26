import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/* ====================================================================== */
/* P3-S10 — Roasting READ-port (versioned golden profiles + Artisan .alog   */
/* import + roast→SKU). The green→bag transform's last hop: a finalized      */
/* roast mints a roasted `lots` node, green→roasted linked by a CONSERVED    */
/* kind='roast' lot_edge, and the green draw is committed against ATP via a   */
/* `lot_shipments` row (the money guarantee REUSED). This port only READS the */
/* roasting surface; the only writers are the SECURITY DEFINER RPCs in the    */
/* command ports (`@/lib/db/commands/*RoastProfile`, `*RoastBatch`,           */
/* `importRoastAlog`, `linkRoastSku`). Mirrors the milling.ts / pricing.ts    */
/* shape: `Row` interface + pure `mapX` mapper + `cache()`'d getters; NULLs   */
/* (an un-finalized batch's roasted_kg_out / shrinkage_pct, a profile's       */
/* un-set DTR / lock stamp, an import's max_deviation_c, a SKU's price/GTIN,   */
/* the left-joined grade columns) are PRESERVED, never fabricated to 0 — the   */
/* UI shows "—" instead of a misleading number. The DB-GENERATED shrinkage_pct */
/* is carried VERBATIM (never recomputed).                                     */
/* ====================================================================== */

/** A roast profile's lifecycle — mirrors the P3-S6 `roast_profile_status` enum.
 *  'approved' is the GOLDEN/locked state (one-way draft→approved→retired). */
export type RoastProfileStatus = "draft" | "approved" | "retired";

/** A roast level — mirrors the P3-S6 `roast_level` enum. */
export type RoastLevel = "light" | "medium-light" | "medium" | "medium-dark" | "dark";

/** A roaster's mechanism — mirrors the P3-S6 `roaster_type` enum. */
export type RoasterType = "drum" | "fluid_bed" | "sample";

/** A roast batch's lifecycle — mirrors the `roast_batches.status` CHECK. */
export type RoastBatchStatus = "open" | "finalized";

/** Coerce a nullable numeric (PostgREST may serialize as a string) to a number,
 *  PRESERVING null — an un-finalized batch's roasted_kg_out / shrinkage_pct, a
 *  profile's un-set DTR, an import's deviation, a SKU's price all stay null. */
function num(v: number | string | null | undefined): number | null {
  return v == null ? null : Number(v);
}

/* ---------------- roasters ---------------- */

/** Shape of a `roasters` registry row (snake_case). */
export interface RoasterRow {
  id: number | string;
  kind: RoasterType | string;
  name: string;
  capacity_kg: number | string;
  created_at: string;
}

/** One roaster in the per-tenant registry (the family's drum roaster). */
export interface Roaster {
  id: number;
  kind: RoasterType | string;
  name: string;
  capacityKg: number;
  createdAt: string;
}

/** Pure row → domain mapper for a roaster (numeric coercion of id/capacity). */
export function mapRoaster(r: RoasterRow): Roaster {
  return {
    id: Number(r.id),
    kind: r.kind,
    name: r.name,
    capacityKg: Number(r.capacity_kg),
    createdAt: r.created_at,
  };
}

/* ---------------- roast_profiles ---------------- */

/** Shape of a `roast_profiles` row (snake_case). `variety` / `target_dtr_pct` /
 *  `locked_at` / `retired_at` are NULL until set (a house style spans varieties;
 *  DTR is optional; lock/retire stamps land on the one-way transitions). */
export interface RoastProfileRow {
  id: number | string;
  name: string;
  version: number | string;
  variety: string | null;
  roast_level: RoastLevel | string;
  target_charge_temp_c: number | string;
  target_drop_temp_c: number | string;
  target_total_time_s: number | string;
  target_dtr_pct: number | string | null;
  status: RoastProfileStatus | string;
  locked_at: string | null;
  retired_at: string | null;
  created_at: string;
}

/** One versioned golden-curve profile — a re-tune is a NEW version, never a mutation. */
export interface RoastProfile {
  id: number;
  name: string;
  version: number;
  /** NULL ⇒ a house style spanning varieties. */
  variety: string | null;
  roastLevel: RoastLevel | string;
  targetChargeTempC: number;
  targetDropTempC: number;
  targetTotalTimeS: number;
  /** Development-time ratio target (%). NULL ⇒ not declared. */
  targetDtrPct: number | null;
  status: RoastProfileStatus | string;
  /** When the profile was locked golden (status→'approved'). NULL ⇒ still a draft. */
  lockedAt: string | null;
  /** When the profile was retired. NULL ⇒ not retired. */
  retiredAt: string | null;
  createdAt: string;
}

/** Pure row → domain mapper for a profile (numeric coercion; NULL variety / DTR /
 *  lock / retire stamps preserved, never fabricated). */
export function mapRoastProfile(r: RoastProfileRow): RoastProfile {
  return {
    id: Number(r.id),
    name: r.name,
    version: Number(r.version),
    variety: r.variety,
    roastLevel: r.roast_level,
    targetChargeTempC: Number(r.target_charge_temp_c),
    targetDropTempC: Number(r.target_drop_temp_c),
    targetTotalTimeS: Number(r.target_total_time_s),
    targetDtrPct: num(r.target_dtr_pct),
    status: r.status,
    lockedAt: r.locked_at,
    retiredAt: r.retired_at,
    createdAt: r.created_at,
  };
}

/* ---------------- roast_batches ---------------- */

/** Shape of a `roast_batches` row (snake_case). `roasted_lot_code` / `roasted_kg_out`
 *  / `shrinkage_pct` are NULL until finalize mints the roasted node; `shrinkage_pct`
 *  is a DB-GENERATED column carried verbatim. */
export interface RoastBatchRow {
  id: number | string;
  green_lot_code: string;
  profile_id: number | string;
  roaster_id: number | string;
  green_in_kg: number | string;
  roasted_lot_code: string | null;
  roasted_kg_out: number | string | null;
  shrinkage_pct: number | string | null;
  green_shipment_id: number | string | null;
  status: RoastBatchStatus | string;
  opened_at: string;
  created_at: string;
}

/** One roast batch — the roasted `lots`-node header. */
export interface RoastBatch {
  id: number;
  greenLotCode: string;
  profileId: number;
  roasterId: number;
  greenInKg: number;
  /** The minted roasted node code. NULL ⇒ the batch isn't finalized yet. */
  roastedLotCode: string | null;
  /** Roasted kg out. NULL ⇒ not finalized (shown as "—"). */
  roastedKgOut: number | null;
  /** DB-GENERATED shrinkage fraction. NULL ⇒ not finalized; never recomputed here. */
  shrinkagePct: number | null;
  /** The `lot_shipments` claim backing the green draw. NULL only if absent. */
  greenShipmentId: number | null;
  status: RoastBatchStatus | string;
  openedAt: string;
  createdAt: string;
}

/** Pure row → domain mapper for a roast batch (numeric coercion; NULL roasted-out /
 *  shrinkage / roasted code preserved; DB-GENERATED shrinkage carried verbatim). */
export function mapRoastBatch(r: RoastBatchRow): RoastBatch {
  return {
    id: Number(r.id),
    greenLotCode: r.green_lot_code,
    profileId: Number(r.profile_id),
    roasterId: Number(r.roaster_id),
    greenInKg: Number(r.green_in_kg),
    roastedLotCode: r.roasted_lot_code,
    roastedKgOut: num(r.roasted_kg_out),
    shrinkagePct: num(r.shrinkage_pct),
    greenShipmentId: num(r.green_shipment_id),
    status: r.status,
    openedAt: r.opened_at,
    createdAt: r.created_at,
  };
}

/* ---------------- roast_curve_points ---------------- */

/** Shape of a `roast_curve_points` row (snake_case). BT/ET/RoR may each be NULL
 *  (a sparse capture logging only one channel). */
export interface RoastCurvePointRow {
  id: number | string;
  batch_id: number | string;
  t_seconds: number | string;
  bean_temp_c: number | string | null;
  env_temp_c: number | string | null;
  ror_c_per_min: number | string | null;
  created_at: string;
}

/** One BT/ET/RoR sample on the live roast curve (from an Artisan .alog). */
export interface RoastCurvePoint {
  id: number;
  batchId: number;
  tSeconds: number;
  /** Bean temperature (°C). NULL ⇒ not logged at this sample. */
  beanTempC: number | null;
  /** Environment temperature (°C). NULL ⇒ not logged. */
  envTempC: number | null;
  /** Rate of rise (°C/min). NULL ⇒ not logged. */
  rorCPerMin: number | null;
  createdAt: string;
}

/** Pure row → domain mapper for a curve point (numeric coercion; NULL BT/ET/RoR
 *  preserved, never fabricated to 0). */
export function mapRoastCurvePoint(r: RoastCurvePointRow): RoastCurvePoint {
  return {
    id: Number(r.id),
    batchId: Number(r.batch_id),
    tSeconds: Number(r.t_seconds),
    beanTempC: num(r.bean_temp_c),
    envTempC: num(r.env_temp_c),
    rorCPerMin: num(r.ror_c_per_min),
    createdAt: r.created_at,
  };
}

/* ---------------- roast_events ---------------- */

/** Shape of a `roast_events` row (snake_case) — a phase marker (charge/dry_end/
 *  first_crack/drop/…). `temp_c` may be NULL. */
export interface RoastEventRow {
  id: number | string;
  batch_id: number | string;
  marker: string;
  t_seconds: number | string;
  temp_c: number | string | null;
  created_at: string;
}

/** One roast phase marker (the milestones on the curve). */
export interface RoastEvent {
  id: number;
  batchId: number;
  marker: string;
  tSeconds: number;
  /** Temperature at the marker (°C). NULL ⇒ not recorded. */
  tempC: number | null;
  createdAt: string;
}

/** Pure row → domain mapper for a roast event (numeric coercion; NULL temp preserved). */
export function mapRoastEvent(r: RoastEventRow): RoastEvent {
  return {
    id: Number(r.id),
    batchId: Number(r.batch_id),
    marker: r.marker,
    tSeconds: Number(r.t_seconds),
    tempC: num(r.temp_c),
    createdAt: r.created_at,
  };
}

/* ---------------- roast_alog_imports ---------------- */

/** Shape of a `roast_alog_imports` row (snake_case) — the .alog receipt +
 *  max-deviation-vs-golden. `source_filename` / `max_deviation_c` may be NULL. */
export interface RoastAlogImportRow {
  id: number | string;
  batch_id: number | string;
  source_filename: string | null;
  alog_payload: Record<string, unknown>;
  max_deviation_c: number | string | null;
  point_count: number | string;
  created_at: string;
}

/** One .alog import receipt — the $0 capture path's provenance row. */
export interface RoastAlogImport {
  id: number;
  batchId: number;
  /** The uploaded filename. NULL ⇒ not supplied. */
  sourceFilename: string | null;
  /** The normalized .alog payload, forwarded verbatim. */
  alogPayload: Record<string, unknown>;
  /** Max |BT − interpolated golden target| (°C). NULL ⇒ no BT points to compare. */
  maxDeviationC: number | null;
  pointCount: number;
  createdAt: string;
}

/** Pure row → domain mapper for an .alog import (numeric coercion; NULL filename /
 *  deviation preserved; payload forwarded verbatim). */
export function mapRoastAlogImport(r: RoastAlogImportRow): RoastAlogImport {
  return {
    id: Number(r.id),
    batchId: Number(r.batch_id),
    sourceFilename: r.source_filename,
    alogPayload: r.alog_payload,
    maxDeviationC: num(r.max_deviation_c),
    pointCount: Number(r.point_count),
    createdAt: r.created_at,
  };
}

/* ---------------- roast_skus ---------------- */

/** Shape of a `roast_skus` row (snake_case) — the roast→product link (the per-bag
 *  QR identity). `price_usd_cents` / `gtin` may be NULL. */
export interface RoastSkuRow {
  id: number | string;
  roast_batch_id: number | string;
  roasted_lot_code: string;
  sku_code: string;
  bag_size_g: number | string;
  price_usd_cents: number | string | null;
  gtin: string | null;
  is_active: boolean;
  created_at: string;
}

/** One roast→product SKU (the load-bearing link the Storefront/Provenance read). */
export interface RoastSku {
  id: number;
  roastBatchId: number;
  roastedLotCode: string;
  skuCode: string;
  bagSizeG: number;
  /** Bag price (USD cents). NULL ⇒ not priced yet. */
  priceUsdCents: number | null;
  /** Global trade item number. NULL ⇒ not assigned. */
  gtin: string | null;
  isActive: boolean;
  createdAt: string;
}

/** Pure row → domain mapper for a roast SKU (numeric coercion; NULL price / GTIN
 *  preserved; boolean is_active carried verbatim). */
export function mapRoastSku(r: RoastSkuRow): RoastSku {
  return {
    id: Number(r.id),
    roastBatchId: Number(r.roast_batch_id),
    roastedLotCode: r.roasted_lot_code,
    skuCode: r.sku_code,
    bagSizeG: Number(r.bag_size_g),
    priceUsdCents: num(r.price_usd_cents),
    gtin: r.gtin,
    isActive: r.is_active,
    createdAt: r.created_at,
  };
}

/* ---------------- roast_shrinkage_by_lot ---------------- */

/** Shape of a `roast_shrinkage_by_lot` row (snake_case) — the per-green-lot
 *  shrinkage rollup over finalized batches. */
export interface RoastShrinkageByLotRow {
  green_lot_code: string;
  green_in_kg: number | string;
  roasted_kg_out: number | string | null;
  shrinkage_pct: number | string | null;
}

/** Per-green-lot Σ green-in / Σ roasted-out + realized shrinkage (the /roast KPI). */
export interface RoastShrinkageByLot {
  greenLotCode: string;
  greenInKg: number;
  roastedKgOut: number | null;
  /** Realized shrinkage fraction. NULL ⇒ no green-in mass to divide by. */
  shrinkagePct: number | null;
}

/** Pure row → domain mapper for the shrinkage rollup (numeric coercion; NULL
 *  shrinkage preserved). */
export function mapRoastShrinkageByLot(
  r: RoastShrinkageByLotRow,
): RoastShrinkageByLot {
  return {
    greenLotCode: r.green_lot_code,
    greenInKg: Number(r.green_in_kg),
    roastedKgOut: num(r.roasted_kg_out),
    shrinkagePct: num(r.shrinkage_pct),
  };
}

/* ---------------- roast_traceability ---------------- */

/** Shape of a `roast_traceability` row (snake_case) — the per-bag QR chain joining
 *  roast batch → roasted node → green lot → SCA prep + cup score + golden profile.
 *  The grade columns (`cupping_score` / `sca_grade` / `sca_prep` / defects) come from
 *  a LEFT JOIN to v_green_grade so they may be NULL on an ungraded batch. */
export interface RoastTraceabilityRow {
  roast_batch_id: number | string;
  roasted_lot_code: string | null;
  green_lot_code: string;
  green_in_kg: number | string;
  roasted_kg_out: number | string | null;
  shrinkage_pct: number | string | null;
  status: RoastBatchStatus | string;
  profile_name: string;
  profile_version: number | string;
  roast_level: RoastLevel | string;
  profile_status: RoastProfileStatus | string;
  cupping_score: number | string | null;
  sca_grade: string | null;
  sca_prep: string | null;
  cat1_defects: number | string | null;
  cat2_defects: number | string | null;
}

/** One per-bag QR traceability chain row. */
export interface RoastTraceability {
  roastBatchId: number;
  roastedLotCode: string | null;
  greenLotCode: string;
  greenInKg: number;
  roastedKgOut: number | null;
  shrinkagePct: number | null;
  status: RoastBatchStatus | string;
  profileName: string;
  profileVersion: number;
  roastLevel: RoastLevel | string;
  profileStatus: RoastProfileStatus | string;
  /** Cup score from the green lot. NULL ⇒ ungraded. */
  cuppingScore: number | null;
  /** SCA grade band from the green lot. NULL ⇒ ungraded. */
  scaGrade: string | null;
  /** SCA prep from v_green_grade. NULL ⇒ no green grade yet. */
  scaPrep: string | null;
  cat1Defects: number | null;
  cat2Defects: number | null;
}

/** Pure row → domain mapper for a traceability chain (numeric coercion; NULL
 *  left-joined grade columns + un-finalized roasted node preserved). */
export function mapRoastTraceability(r: RoastTraceabilityRow): RoastTraceability {
  return {
    roastBatchId: Number(r.roast_batch_id),
    roastedLotCode: r.roasted_lot_code,
    greenLotCode: r.green_lot_code,
    greenInKg: Number(r.green_in_kg),
    roastedKgOut: num(r.roasted_kg_out),
    shrinkagePct: num(r.shrinkage_pct),
    status: r.status,
    profileName: r.profile_name,
    profileVersion: Number(r.profile_version),
    roastLevel: r.roast_level,
    profileStatus: r.profile_status,
    cuppingScore: num(r.cupping_score),
    scaGrade: r.sca_grade,
    scaPrep: r.sca_prep,
    cat1Defects: num(r.cat1_defects),
    cat2Defects: num(r.cat2_defects),
  };
}

/* ---------------- getters (request-scoped cache) ---------------- */

/**
 * The per-tenant roaster registry (`roasters`) — the family's drum roaster(s),
 * ordered by id. Read-only reference for the /roast batch composer.
 */
export const listRoasters = cache(async (): Promise<Roaster[]> => {
  const { data, error } = await (await getSupabase())
    .from("roasters")
    .select("*")
    .order("id");
  if (error) throw new Error(`listRoasters: ${error.message}`);
  return (data as RoasterRow[]).map(mapRoaster);
});

/**
 * The versioned golden-curve library (`roast_profiles`), ordered by name then newest
 * version first — the /roast profile library. A profile's `status` carries the
 * one-way lifecycle (draft→approved(golden)→retired).
 */
export const getRoastProfiles = cache(async (): Promise<RoastProfile[]> => {
  const { data, error } = await (await getSupabase())
    .from("roast_profiles")
    .select("*")
    .order("name", { ascending: true })
    .order("version", { ascending: false });
  if (error) throw new Error(`getRoastProfiles: ${error.message}`);
  return (data as RoastProfileRow[]).map(mapRoastProfile);
});

/**
 * Every roast batch (`roast_batches`), newest-opened first — the /roast board read
 * model. Open batches show their green-in; finalized batches carry the roasted node,
 * roasted-out and the DB-GENERATED shrinkage (NULL on all until finalize, shown "—").
 */
export const getRoastBatches = cache(async (): Promise<RoastBatch[]> => {
  const { data, error } = await (await getSupabase())
    .from("roast_batches")
    .select("*")
    .order("opened_at", { ascending: false });
  if (error) throw new Error(`getRoastBatches: ${error.message}`);
  return (data as RoastBatchRow[]).map(mapRoastBatch);
});

/**
 * One roast batch by id (`roast_batches` filtered to the batch), or `null` when it
 * doesn't exist (notFound() territory for the /roast/[batchId] detail page).
 */
export const getRoastBatch = cache(
  async (batchId: number): Promise<RoastBatch | null> => {
    const { data, error } = await (await getSupabase())
      .from("roast_batches")
      .select("*")
      .eq("id", batchId);
    if (error) throw new Error(`getRoastBatch: ${error.message}`);
    const rows = (data as RoastBatchRow[] | null) ?? [];
    return rows.length > 0 ? mapRoastBatch(rows[0]) : null;
  },
);

/**
 * A batch's BT/ET/RoR curve points (`roast_curve_points`), in time order — the live
 * roast-curve chart overlaid on the golden target.
 */
export const getRoastCurvePoints = cache(
  async (batchId: number): Promise<RoastCurvePoint[]> => {
    const { data, error } = await (await getSupabase())
      .from("roast_curve_points")
      .select("*")
      .eq("batch_id", batchId)
      .order("t_seconds");
    if (error) throw new Error(`getRoastCurvePoints: ${error.message}`);
    return (data as RoastCurvePointRow[]).map(mapRoastCurvePoint);
  },
);

/**
 * A batch's phase markers (`roast_events`), in time order — the charge/dry_end/
 * first_crack/drop milestones on the curve.
 */
export const getRoastEvents = cache(
  async (batchId: number): Promise<RoastEvent[]> => {
    const { data, error } = await (await getSupabase())
      .from("roast_events")
      .select("*")
      .eq("batch_id", batchId)
      .order("t_seconds");
    if (error) throw new Error(`getRoastEvents: ${error.message}`);
    return (data as RoastEventRow[]).map(mapRoastEvent);
  },
);

/**
 * A batch's .alog import receipts (`roast_alog_imports`), newest first — the $0
 * capture path's provenance (filename + max deviation vs the golden target).
 */
export const getRoastAlogImports = cache(
  async (batchId: number): Promise<RoastAlogImport[]> => {
    const { data, error } = await (await getSupabase())
      .from("roast_alog_imports")
      .select("*")
      .eq("batch_id", batchId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`getRoastAlogImports: ${error.message}`);
    return (data as RoastAlogImportRow[]).map(mapRoastAlogImport);
  },
);

/**
 * Per-green-lot shrinkage rollup (`roast_shrinkage_by_lot`), ordered by lot — the
 * /roast KPI (Σ green-in / Σ roasted-out + realized shrinkage over finalized batches).
 */
export const getRoastShrinkageByLot = cache(
  async (): Promise<RoastShrinkageByLot[]> => {
    const { data, error } = await (await getSupabase())
      .from("roast_shrinkage_by_lot")
      .select("*")
      .order("green_lot_code");
    if (error) throw new Error(`getRoastShrinkageByLot: ${error.message}`);
    return (data as RoastShrinkageByLotRow[]).map(mapRoastShrinkageByLot);
  },
);

/**
 * The per-bag QR traceability chain (`roast_traceability`), newest batch first —
 * roast batch → roasted node → green lot → SCA prep + cup score + golden profile.
 */
export const getRoastTraceability = cache(
  async (): Promise<RoastTraceability[]> => {
    const { data, error } = await (await getSupabase())
      .from("roast_traceability")
      .select("*")
      .order("roast_batch_id", { ascending: false });
    if (error) throw new Error(`getRoastTraceability: ${error.message}`);
    return (data as RoastTraceabilityRow[]).map(mapRoastTraceability);
  },
);

/**
 * One batch's traceability chain (`roast_traceability` filtered to the batch), or
 * `null` when it has no row — the /roast/[batchId] provenance panel + per-bag QR.
 */
export const getRoastTraceabilityForBatch = cache(
  async (batchId: number): Promise<RoastTraceability | null> => {
    const { data, error } = await (await getSupabase())
      .from("roast_traceability")
      .select("*")
      .eq("roast_batch_id", batchId);
    if (error) throw new Error(`getRoastTraceabilityForBatch: ${error.message}`);
    const rows = (data as RoastTraceabilityRow[] | null) ?? [];
    return rows.length > 0 ? mapRoastTraceability(rows[0]) : null;
  },
);

/**
 * Every roast→product SKU (`roast_skus`), newest first — the per-bag QR catalogue
 * the Storefront/Provenance areas read (this slice OWNS the link).
 */
export const listRoastSkus = cache(async (): Promise<RoastSku[]> => {
  const { data, error } = await (await getSupabase())
    .from("roast_skus")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listRoastSkus: ${error.message}`);
  return (data as RoastSkuRow[]).map(mapRoastSku);
});

/**
 * A batch's SKUs (`roast_skus` filtered to the batch), newest first — the
 * /roast/[batchId] "Linked SKUs" panel.
 */
export const getRoastSkusForBatch = cache(
  async (batchId: number): Promise<RoastSku[]> => {
    const { data, error } = await (await getSupabase())
      .from("roast_skus")
      .select("*")
      .eq("roast_batch_id", batchId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`getRoastSkusForBatch: ${error.message}`);
    return (data as RoastSkuRow[]).map(mapRoastSku);
  },
);
