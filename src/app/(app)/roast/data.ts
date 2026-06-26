import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /roast read port (P3-S10 roasting — versioned golden profiles + Artisan .alog
 * import + roast→SKU).
 *
 * Co-located with the route on purpose: it binds DIRECTLY to the authoritative SQL
 * surface the P3-S10 migration shipped — the `roast_profiles` golden-curve library,
 * the `roasters` registry, the `roast_traceability` / `roast_shrinkage_by_lot` views,
 * the `roast_curve_points` / `roast_events` / `roast_alog_imports` capture ledgers,
 * the `roast_skus` link, and the upstream `green_lots_atp` (the available-to-promise
 * a roast draw consumes). A parallel fan-out builds the shared `@/lib/db/*` ports in
 * sibling files; importing a not-yet-landed module hard-fails Vite's import-analysis
 * at BOTH test and build time, so this port talks to the frozen view/column names
 * directly. The Wiring pass can collapse it into a shared port (one import swap).
 *
 * READ-ONLY. Every write goes through the SECURITY DEFINER RPCs in `actions.ts`
 * (`create_roast_profile`, `lock_roast_profile`, `open_roast_batch`,
 * `import_roast_alog`, `finalize_roast_batch`, `link_roast_sku`). The board NEVER
 * fabricates a verdict: a draft profile reads "Draft" (un-roastable), a NULL
 * shrinkage / cup score / cost stays NULL (never coerced to a confident 0).
 */

export type RoastProfileStatus = "draft" | "approved" | "retired";

/** One row of the versioned golden-curve library (mirrors `roast_profiles`). */
export interface RoastProfile {
  id: number;
  name: string;
  version: number;
  variety: string | null;
  roastLevel: string;
  targetChargeTempC: number;
  targetDropTempC: number;
  targetTotalTimeS: number;
  targetDtrPct: number | null;
  status: RoastProfileStatus;
  lockedAt: string | null;
}

/** The roaster registry (mirrors `roasters`). */
export interface Roaster {
  id: number;
  name: string;
  kind: string;
  capacityKg: number;
}

/** A green lot with inventory available to draw to the roaster (green_lots_atp). */
export interface RoastableGreenLot {
  greenLotCode: string;
  variety: string | null;
  scaGrade: string | null;
  cuppingScore: number | null;
  atpKg: number;
}

/** One roast batch, enriched with its profile + green-lot lineage (roast_traceability). */
export interface RoastBatchRow {
  roastBatchId: number;
  greenLotCode: string;
  roastedLotCode: string | null;
  greenInKg: number;
  roastedKgOut: number | null;
  /** fraction (green_in − roasted_out)/green_in; NULL until finalized. */
  shrinkagePct: number | null;
  status: string;
  profileName: string;
  profileVersion: number;
  roastLevel: string;
  profileStatus: RoastProfileStatus;
  cuppingScore: number | null;
  scaGrade: string | null;
  scaPrep: string | null;
}

/** One captured curve sample (mirrors `roast_curve_points`). */
export interface RoastCurvePoint {
  tSeconds: number;
  beanTempC: number | null;
  envTempC: number | null;
  rorCPerMin: number | null;
}

/** One phase marker (mirrors `roast_events`). */
export interface RoastEventMarker {
  marker: string;
  tSeconds: number;
  tempC: number | null;
}

/** One .alog import receipt (mirrors `roast_alog_imports`). */
export interface RoastAlogImport {
  sourceFilename: string | null;
  maxDeviationC: number | null;
  pointCount: number;
  createdAt: string;
}

/** One linked bag SKU (mirrors `roast_skus`). */
export interface RoastSkuRow {
  id: number;
  skuCode: string;
  bagSizeG: number;
  priceUsdCents: number | null;
  gtin: string | null;
  isActive: boolean;
}

/** Everything the batch-detail page needs for one roast batch. */
export interface RoastBatchDetail {
  batch: RoastBatchRow;
  profileTargets: {
    chargeTempC: number;
    dropTempC: number;
    totalTimeS: number;
    dtrPct: number | null;
  };
  curvePoints: RoastCurvePoint[];
  events: RoastEventMarker[];
  imports: RoastAlogImport[];
  skus: RoastSkuRow[];
}

/* ───────────────────────── PostgREST row shapes ───────────────────────── */

interface ProfileViewRow {
  id: number;
  name: string;
  version: number | string;
  variety: string | null;
  roast_level: string;
  target_charge_temp_c: number | string;
  target_drop_temp_c: number | string;
  target_total_time_s: number | string;
  target_dtr_pct: number | string | null;
  status: string;
  locked_at: string | null;
}

interface RoasterRow {
  id: number;
  name: string;
  kind: string;
  capacity_kg: number | string;
}

interface AtpRow {
  green_lot_code: string;
  sca_grade: string | null;
  atp: number | string | null;
}

interface TraceabilityRow {
  roast_batch_id: number;
  green_lot_code: string;
  roasted_lot_code: string | null;
  green_in_kg: number | string;
  roasted_kg_out: number | string | null;
  shrinkage_pct: number | string | null;
  status: string;
  profile_name: string;
  profile_version: number | string;
  roast_level: string;
  profile_status: string;
  cupping_score: number | string | null;
  sca_grade: string | null;
  sca_prep: string | null;
}

/** Coerce a PostgREST numeric (which may arrive as a string) to number|null. */
const n = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

const asStatus = (s: string): RoastProfileStatus =>
  s === "approved" ? "approved" : s === "retired" ? "retired" : "draft";

function mapBatch(r: TraceabilityRow): RoastBatchRow {
  return {
    roastBatchId: r.roast_batch_id,
    greenLotCode: r.green_lot_code,
    roastedLotCode: r.roasted_lot_code,
    greenInKg: n(r.green_in_kg) ?? 0,
    roastedKgOut: n(r.roasted_kg_out),
    shrinkagePct: n(r.shrinkage_pct),
    status: r.status,
    profileName: r.profile_name,
    profileVersion: n(r.profile_version) ?? 1,
    roastLevel: r.roast_level,
    profileStatus: asStatus(r.profile_status),
    cuppingScore: n(r.cupping_score),
    scaGrade: r.sca_grade,
    scaPrep: r.sca_prep,
  };
}

/** The versioned golden-curve library, newest version of each name first. */
export const getRoastProfiles = cache(async (): Promise<RoastProfile[]> => {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from("roast_profiles")
    .select(
      "id, name, version, variety, roast_level, target_charge_temp_c, target_drop_temp_c, target_total_time_s, target_dtr_pct, status, locked_at",
    )
    .order("name", { ascending: true })
    .order("version", { ascending: false });
  if (error) throw new Error(`getRoastProfiles: ${error.message}`);
  return (data as ProfileViewRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    version: n(r.version) ?? 1,
    variety: r.variety,
    roastLevel: r.roast_level,
    targetChargeTempC: Number(r.target_charge_temp_c),
    targetDropTempC: Number(r.target_drop_temp_c),
    targetTotalTimeS: Number(r.target_total_time_s),
    targetDtrPct: n(r.target_dtr_pct),
    status: asStatus(r.status),
    lockedAt: r.locked_at,
  }));
});

/** The roaster registry, in id order. */
export const getRoasters = cache(async (): Promise<Roaster[]> => {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from("roasters")
    .select("id, name, kind, capacity_kg")
    .order("id");
  if (error) throw new Error(`getRoasters: ${error.message}`);
  return (data as RoasterRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    capacityKg: Number(r.capacity_kg),
  }));
});

/**
 * Green lots with inventory available to roast (ATP > 0), enriched with variety +
 * cup score for the open-batch picker. The ATP is the SINGLE truth a roast draw
 * spends — `open_roast_batch` inserts a `lot_shipments` row and the `prevent_oversell`
 * trigger is the hard wall; this list is the friendly pre-filter.
 */
export const getRoastableGreenLots = cache(
  async (): Promise<RoastableGreenLot[]> => {
    const sb = await getSupabase();
    const [atp, lots, green] = await Promise.all([
      sb.from("green_lots_atp").select("green_lot_code, sca_grade, atp"),
      sb.from("lots").select("code, variety"),
      sb.from("green_lots").select("lot_code, cupping_score"),
    ]);
    if (atp.error) throw new Error(`getRoastableGreenLots(atp): ${atp.error.message}`);
    if (lots.error) throw new Error(`getRoastableGreenLots(lots): ${lots.error.message}`);
    if (green.error) throw new Error(`getRoastableGreenLots(green): ${green.error.message}`);

    const varietyByCode = new Map<string, string | null>(
      (lots.data as { code: string; variety: string | null }[]).map((l) => [
        l.code,
        l.variety,
      ]),
    );
    const scoreByCode = new Map<string, number | null>(
      (green.data as { lot_code: string; cupping_score: number | string | null }[]).map(
        (g) => [g.lot_code, n(g.cupping_score)],
      ),
    );

    return (atp.data as AtpRow[])
      .map((r) => ({
        greenLotCode: r.green_lot_code,
        variety: varietyByCode.get(r.green_lot_code) ?? null,
        scaGrade: r.sca_grade,
        cuppingScore: scoreByCode.get(r.green_lot_code) ?? null,
        atpKg: n(r.atp) ?? 0,
      }))
      .filter((r) => r.atpKg > 1e-9)
      .sort((a, b) => a.greenLotCode.localeCompare(b.greenLotCode));
  },
);

/** Every roast batch (open + finalized), newest first, with its full lineage. */
export const getRoastBatches = cache(async (): Promise<RoastBatchRow[]> => {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from("roast_traceability")
    .select(
      "roast_batch_id, green_lot_code, roasted_lot_code, green_in_kg, roasted_kg_out, shrinkage_pct, status, profile_name, profile_version, roast_level, profile_status, cupping_score, sca_grade, sca_prep",
    )
    .order("roast_batch_id", { ascending: false });
  if (error) throw new Error(`getRoastBatches: ${error.message}`);
  return (data as TraceabilityRow[]).map(mapBatch);
});

/**
 * The full detail for one roast batch: its lineage row, the golden profile's numeric
 * targets (for the curve overlay), the captured curve points + phase markers, the
 * .alog import receipts, and the linked SKUs. Returns null when no batch with that id
 * exists (the page 404s — never a fabricated batch).
 */
export const getRoastBatchDetail = cache(
  async (batchId: number): Promise<RoastBatchDetail | null> => {
    const sb = await getSupabase();

    const { data: traceRow, error: traceErr } = await sb
      .from("roast_traceability")
      .select(
        "roast_batch_id, green_lot_code, roasted_lot_code, green_in_kg, roasted_kg_out, shrinkage_pct, status, profile_name, profile_version, roast_level, profile_status, cupping_score, sca_grade, sca_prep",
      )
      .eq("roast_batch_id", batchId)
      .maybeSingle();
    if (traceErr) throw new Error(`getRoastBatchDetail: ${traceErr.message}`);
    if (!traceRow) return null;

    const batch = mapBatch(traceRow as TraceabilityRow);

    // The traceability view doesn't carry profile_id; resolve the numeric golden
    // targets through the batch -> profile join for the curve overlay.
    const { data: batchRow } = await sb
      .from("roast_batches")
      .select("profile_id")
      .eq("id", batchId)
      .maybeSingle();
    const profileId = (batchRow as { profile_id: number } | null)?.profile_id ?? null;

    const [targetsRes, pointsRes, eventsRes, importsRes, skusRes] = await Promise.all([
      profileId == null
        ? Promise.resolve({ data: null, error: null })
        : sb
            .from("roast_profiles")
            .select(
              "target_charge_temp_c, target_drop_temp_c, target_total_time_s, target_dtr_pct",
            )
            .eq("id", profileId)
            .maybeSingle(),
      sb
        .from("roast_curve_points")
        .select("t_seconds, bean_temp_c, env_temp_c, ror_c_per_min")
        .eq("batch_id", batchId)
        .order("t_seconds", { ascending: true }),
      sb
        .from("roast_events")
        .select("marker, t_seconds, temp_c")
        .eq("batch_id", batchId)
        .order("t_seconds", { ascending: true }),
      sb
        .from("roast_alog_imports")
        .select("source_filename, max_deviation_c, point_count, created_at")
        .eq("batch_id", batchId)
        .order("created_at", { ascending: false }),
      sb
        .from("roast_skus")
        .select("id, sku_code, bag_size_g, price_usd_cents, gtin, is_active")
        .eq("roast_batch_id", batchId)
        .order("id", { ascending: true }),
    ]);

    const targets = targetsRes.data as
      | {
          target_charge_temp_c: number | string;
          target_drop_temp_c: number | string;
          target_total_time_s: number | string;
          target_dtr_pct: number | string | null;
        }
      | null;

    const curvePoints: RoastCurvePoint[] = (
      (pointsRes.data as
        | {
            t_seconds: number | string;
            bean_temp_c: number | string | null;
            env_temp_c: number | string | null;
            ror_c_per_min: number | string | null;
          }[]
        | null) ?? []
    ).map((p) => ({
      tSeconds: Number(p.t_seconds),
      beanTempC: n(p.bean_temp_c),
      envTempC: n(p.env_temp_c),
      rorCPerMin: n(p.ror_c_per_min),
    }));

    const events: RoastEventMarker[] = (
      (eventsRes.data as
        | { marker: string; t_seconds: number | string; temp_c: number | string | null }[]
        | null) ?? []
    ).map((e) => ({
      marker: e.marker,
      tSeconds: Number(e.t_seconds),
      tempC: n(e.temp_c),
    }));

    const imports: RoastAlogImport[] = (
      (importsRes.data as
        | {
            source_filename: string | null;
            max_deviation_c: number | string | null;
            point_count: number | string;
            created_at: string;
          }[]
        | null) ?? []
    ).map((i) => ({
      sourceFilename: i.source_filename,
      maxDeviationC: n(i.max_deviation_c),
      pointCount: n(i.point_count) ?? 0,
      createdAt: i.created_at,
    }));

    const skus: RoastSkuRow[] = (
      (skusRes.data as
        | {
            id: number;
            sku_code: string;
            bag_size_g: number | string;
            price_usd_cents: number | string | null;
            gtin: string | null;
            is_active: boolean;
          }[]
        | null) ?? []
    ).map((s) => ({
      id: s.id,
      skuCode: s.sku_code,
      bagSizeG: n(s.bag_size_g) ?? 0,
      priceUsdCents: n(s.price_usd_cents),
      gtin: s.gtin,
      isActive: s.is_active,
    }));

    return {
      batch,
      profileTargets: {
        chargeTempC: targets ? Number(targets.target_charge_temp_c) : batch.greenInKg && 0,
        dropTempC: targets ? Number(targets.target_drop_temp_c) : 0,
        totalTimeS: targets ? Number(targets.target_total_time_s) : 0,
        dtrPct: targets ? n(targets.target_dtr_pct) : null,
      },
      curvePoints,
      events,
      imports,
      skus,
    };
  },
);
