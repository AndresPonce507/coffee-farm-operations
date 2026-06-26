import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/* ====================================================================== */
/* P3-S20 — Controlled-environment storage READ-port (ADR-003 derived-read).*/
/* Green coffee keeps quality only while it's held in spec (safe            */
/* water-activity aw ≤ ~0.65). This port READS the structured location      */
/* bands (`storage_locations`), the live status per location                */
/* (`v_storage_status`), one green lot's reading history                    */
/* (`v_lot_storage_history`) and the append-only certificate ledger         */
/* (`storage_certificates`). The only writers are the SECURITY DEFINER RPCs  */
/* in the command ports (`@/lib/db/commands/*`). Mirrors the pricing.ts      */
/* shape: `Row` interface + pure `mapX` mapper + `cache()`'d getters; NULLs  */
/* (an unread location's latest values, its unknown `in_band` flag) are      */
/* PRESERVED, never fabricated — a location with no readings shows "—" and   */
/* an UNKNOWN band status, never a misleading "out of band" / 0.            */
/* ====================================================================== */

/** Where a reading came from: 'manual' is the $0 path; 'lorawan-sensor' is the
 *  identical schema + a device id (a future ChirpStack gateway POSTing the RPC). */
export type StorageReadingSource = "manual" | "lorawan-sensor";

/** A certificate's verdict over its readings window. 'insufficient-data' is the
 *  honest floor — a cert is NEVER fabricated 'in-band' without evidence. */
export type StorageCertVerdict = "in-band" | "excursion" | "insufficient-data";

/** Coerce a nullable numeric (PostgREST may serialize as a string) to a number,
 *  PRESERVING null — an unread latest reading / partial measurement stays null
 *  (never a fabricated 0). */
function num(v: number | string | null | undefined): number | null {
  return v == null ? null : Number(v);
}

/* ---------------- storage_locations ---------------- */

/** Shape of a `storage_locations` row as returned by PostgREST (snake_case). */
export interface StorageLocationRow {
  id: number;
  code: string;
  name: string;
  temp_min_c: number | string;
  temp_max_c: number | string;
  rh_min_pct: number | string;
  rh_max_pct: number | string;
  aw_max: number | string;
  created_at: string;
  updated_at: string;
}

/** A structured storage location + its controlled-environment target bands. */
export interface StorageLocation {
  id: number;
  code: string;
  name: string;
  tempMinC: number;
  tempMaxC: number;
  rhMinPct: number;
  rhMaxPct: number;
  awMax: number;
  createdAt: string;
  updatedAt: string;
}

/** Pure row → domain mapper for a storage location (numeric band coercion). */
export function mapStorageLocation(r: StorageLocationRow): StorageLocation {
  return {
    id: Number(r.id),
    code: r.code,
    name: r.name,
    tempMinC: Number(r.temp_min_c),
    tempMaxC: Number(r.temp_max_c),
    rhMinPct: Number(r.rh_min_pct),
    rhMaxPct: Number(r.rh_max_pct),
    awMax: Number(r.aw_max),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/* ---------------- v_storage_status ---------------- */

/** Shape of a `v_storage_status` row (snake_case). `latest_*` + `in_band` are
 *  NULL when the location has NO readings yet (the lateral join misses). */
export interface StorageStatusRow {
  location_id: number;
  code: string;
  name: string;
  temp_min_c: number | string;
  temp_max_c: number | string;
  rh_min_pct: number | string;
  rh_max_pct: number | string;
  aw_max: number | string;
  latest_temp_c: number | string | null;
  latest_rh_pct: number | string | null;
  latest_aw: number | string | null;
  latest_reading_at: string | null;
  in_band: boolean | null;
}

/** Per location: target bands + the latest reading + an in-band flag. `inBand`
 *  is NULL when there's no reading yet — UNKNOWN, never a fabricated false. */
export interface StorageStatus {
  locationId: number;
  code: string;
  name: string;
  tempMinC: number;
  tempMaxC: number;
  rhMinPct: number;
  rhMaxPct: number;
  awMax: number;
  latestTempC: number | null;
  latestRhPct: number | null;
  latestAw: number | null;
  latestReadingAt: string | null;
  /** true = in spec, false = excursion, null = no reading yet (unknown). */
  inBand: boolean | null;
}

/** Pure row → domain mapper for a status row (numeric coercion; NULL latest
 *  values + a NULL in_band preserved — an unread location stays UNKNOWN). */
export function mapStorageStatus(r: StorageStatusRow): StorageStatus {
  return {
    locationId: Number(r.location_id),
    code: r.code,
    name: r.name,
    tempMinC: Number(r.temp_min_c),
    tempMaxC: Number(r.temp_max_c),
    rhMinPct: Number(r.rh_min_pct),
    rhMaxPct: Number(r.rh_max_pct),
    awMax: Number(r.aw_max),
    latestTempC: num(r.latest_temp_c),
    latestRhPct: num(r.latest_rh_pct),
    latestAw: num(r.latest_aw),
    latestReadingAt: r.latest_reading_at,
    inBand: r.in_band,
  };
}

/* ---------------- v_lot_storage_history ---------------- */

/** Shape of a `v_lot_storage_history` row (snake_case). `temp_c`/`rh_pct`/`aw`
 *  may be NULL (a partial reading — e.g. an aw-only hygrometer check). */
export interface LotStorageReadingRow {
  green_lot_code: string;
  location_id: number;
  location_name: string;
  reading_at: string;
  temp_c: number | string | null;
  rh_pct: number | string | null;
  aw: number | string | null;
  source: StorageReadingSource | string;
}

/** One environmental reading for a green lot's storage location. */
export interface LotStorageReading {
  greenLotCode: string;
  locationId: number;
  locationName: string;
  readingAt: string;
  tempC: number | null;
  rhPct: number | null;
  aw: number | null;
  source: StorageReadingSource | string;
}

/** Pure row → domain mapper for a lot reading (numeric coercion; NULL partial
 *  measurements preserved, never fabricated to 0). */
export function mapLotStorageReading(r: LotStorageReadingRow): LotStorageReading {
  return {
    greenLotCode: r.green_lot_code,
    locationId: Number(r.location_id),
    locationName: r.location_name,
    readingAt: r.reading_at,
    tempC: num(r.temp_c),
    rhPct: num(r.rh_pct),
    aw: num(r.aw),
    source: r.source,
  };
}

/* ---------------- storage_certificates ---------------- */

/** Shape of a `storage_certificates` row (snake_case). `cert_hash` is the bytea
 *  digest serialized as a `\x…` hex string; `in_band_pct` may be NULL. */
export interface StorageCertificateRow {
  id: number;
  green_lot_code: string;
  location_id: number;
  window_start: string;
  window_end: string;
  readings_count: number;
  in_band_pct: number | string | null;
  verdict: StorageCertVerdict | string;
  cert_hash: string;
  issued_at: string;
  created_at: string;
}

/** A documented, append-only per-lot storage certificate. `certHash` binds the
 *  verdict to the EXACT readings window (tamper-evident). */
export interface StorageCertificate {
  id: number;
  greenLotCode: string;
  locationId: number;
  windowStart: string;
  windowEnd: string;
  readingsCount: number;
  inBandPct: number | null;
  verdict: StorageCertVerdict | string;
  certHash: string;
  issuedAt: string;
  createdAt: string;
}

/** Pure row → domain mapper for a certificate (numeric coercion; NULL pct
 *  preserved; the cert hash passes through as its hex string). */
export function mapStorageCertificate(
  r: StorageCertificateRow,
): StorageCertificate {
  return {
    id: Number(r.id),
    greenLotCode: r.green_lot_code,
    locationId: Number(r.location_id),
    windowStart: r.window_start,
    windowEnd: r.window_end,
    readingsCount: Number(r.readings_count),
    inBandPct: num(r.in_band_pct),
    verdict: r.verdict,
    certHash: r.cert_hash,
    issuedAt: r.issued_at,
    createdAt: r.created_at,
  };
}

/* ---------------- getters (request-scoped cache) ---------------- */

/**
 * The structured storage locations + their target bands (`storage_locations`),
 * ordered by code — the picker behind the reading quick-form and the certificate
 * issuer. Written ONLY by `upsert_storage_location`.
 */
export const getStorageLocations = cache(async (): Promise<StorageLocation[]> => {
  const { data, error } = await (await getSupabase())
    .from("storage_locations")
    .select("*")
    .order("code");
  if (error) throw new Error(`getStorageLocations: ${error.message}`);
  return (data as StorageLocationRow[]).map(mapStorageLocation);
});

/**
 * Live status per location (`v_storage_status`): the target bands, the latest
 * reading and an in-band flag. `inBand` is NULL when a location has no reading
 * yet — the dashboard shows an UNKNOWN gauge, never a misleading excursion.
 */
export const getStorageStatus = cache(async (): Promise<StorageStatus[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_storage_status")
    .select("*")
    .order("code");
  if (error) throw new Error(`getStorageStatus: ${error.message}`);
  return (data as StorageStatusRow[]).map(mapStorageStatus);
});

/**
 * One green lot's environmental reading history (`v_lot_storage_history`), oldest
 * first so the storage sparkline reads left-to-right. Joins the lot's free-text
 * location to its structured `storage_locations` home.
 */
export const getLotStorageHistory = cache(
  async (lot: string): Promise<LotStorageReading[]> => {
    const { data, error } = await (await getSupabase())
      .from("v_lot_storage_history")
      .select("*")
      .eq("green_lot_code", lot)
      .order("reading_at");
    if (error) throw new Error(`getLotStorageHistory: ${error.message}`);
    return (data as LotStorageReadingRow[]).map(mapLotStorageReading);
  },
);

/**
 * One green lot's append-only storage certificates (`storage_certificates`),
 * newest first — the documented proof the lot was kept in spec from green to
 * sale. Immutable: a correction is a superseding certificate, never an edit.
 */
export const getLotStorageCertificates = cache(
  async (lot: string): Promise<StorageCertificate[]> => {
    const { data, error } = await (await getSupabase())
      .from("storage_certificates")
      .select("*")
      .eq("green_lot_code", lot)
      .order("issued_at", { ascending: false });
    if (error) throw new Error(`getLotStorageCertificates: ${error.message}`);
    return (data as StorageCertificateRow[]).map(mapStorageCertificate);
  },
);

/**
 * The whole append-only certificate ledger (`storage_certificates`), newest
 * first — the audit history behind every "kept in spec" claim.
 */
export const listStorageCertificates = cache(
  async (): Promise<StorageCertificate[]> => {
    const { data, error } = await (await getSupabase())
      .from("storage_certificates")
      .select("*")
      .order("issued_at", { ascending: false });
    if (error) throw new Error(`listStorageCertificates: ${error.message}`);
    return (data as StorageCertificateRow[]).map(mapStorageCertificate);
  },
);
