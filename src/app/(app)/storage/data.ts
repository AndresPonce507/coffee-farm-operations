import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /storage read port (P3-S20 storage / controlled-environment monitoring).
 *
 * Co-located with the route on purpose: it binds DIRECTLY to the authoritative SQL
 * surface the P3-S20 migration shipped — the `v_storage_status` per-location view,
 * the `storage_certificates` ledger, the `green_lots` mapping (its free-text
 * `location` resolves to a `storage_locations.name`), and the `storage_locations`
 * config — rather than a sibling `@/lib/db` port. Importing a not-yet-written module
 * would hard-fail Vite import-analysis at test AND build time; the only load-bearing
 * contract here is the view/column/RPC names, which are frozen. The Wiring pass can
 * collapse this into a shared port (one import swap).
 *
 * READ-ONLY. Every write goes through the SECURITY DEFINER RPCs in `actions.ts`
 * (upsert_storage_location / record_storage_reading / issue_storage_certificate). A
 * location with no readings keeps `inBand = null` and shows "no readings yet" — never
 * a fabricated in-band claim (the honest-provenance posture the certificate evidence
 * gate enforces at the database, mirrored here in the read).
 */

export type StorageCertVerdict = "in-band" | "excursion" | "insufficient-data";

/** Per-location controlled-environment status (mirrors a `v_storage_status` row). */
export interface StorageLocationStatus {
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
  /** true = every metric in band, false = an excursion, null = no readings yet. */
  inBand: boolean | null;
}

/** A green lot the owner can certify, with the location its free-text name maps to. */
export interface StoredGreenLot {
  lotCode: string;
  location: string | null;
}

/** One issued storage certificate (a row of `storage_certificates`, enriched). */
export interface StorageCertificate {
  id: number;
  greenLotCode: string;
  locationName: string | null;
  windowStart: string;
  windowEnd: string;
  readingsCount: number;
  inBandPct: number | null;
  verdict: StorageCertVerdict;
  issuedAt: string;
}

/** The whole /storage board payload. */
export interface StorageBoard {
  locations: StorageLocationStatus[];
  greenLots: StoredGreenLot[];
  certificates: StorageCertificate[];
}

interface StatusViewRow {
  location_id: number | string;
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

interface GreenLotRow {
  lot_code: string;
  location: string | null;
}

interface CertRow {
  id: number | string;
  green_lot_code: string;
  location_id: number | string;
  window_start: string;
  window_end: string;
  readings_count: number | string;
  in_band_pct: number | string | null;
  verdict: string;
  issued_at: string;
}

/** Coerce a PostgREST numeric (which may arrive as a string) to number|null. */
const n = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

function mapStatus(r: StatusViewRow): StorageLocationStatus {
  return {
    locationId: Number(r.location_id),
    code: r.code,
    name: r.name,
    tempMinC: Number(r.temp_min_c),
    tempMaxC: Number(r.temp_max_c),
    rhMinPct: Number(r.rh_min_pct),
    rhMaxPct: Number(r.rh_max_pct),
    awMax: Number(r.aw_max),
    latestTempC: n(r.latest_temp_c),
    latestRhPct: n(r.latest_rh_pct),
    latestAw: n(r.latest_aw),
    latestReadingAt: r.latest_reading_at,
    inBand: r.in_band,
  };
}

/**
 * The storage board: every location with its target bands + latest reading + an
 * in-band flag, the green lots the owner can certify, and the issued certificate log.
 * A location with no readings reports `inBand = null` (the gauge shows "no readings",
 * never a fabricated in-band) — the same evidence gate the certificate RPC enforces.
 */
export const getStorageBoard = cache(async (): Promise<StorageBoard> => {
  const sb = await getSupabase();
  const [status, lots, certs] = await Promise.all([
    sb.from("v_storage_status").select("*").order("name"),
    sb.from("green_lots").select("lot_code, location").order("lot_code"),
    sb
      .from("storage_certificates")
      .select(
        "id, green_lot_code, location_id, window_start, window_end, readings_count, in_band_pct, verdict, issued_at",
      )
      .order("issued_at", { ascending: false })
      .limit(50),
  ]);

  if (status.error) throw new Error(`getStorageBoard: ${status.error.message}`);
  if (lots.error) throw new Error(`getStorageBoard(lots): ${lots.error.message}`);
  if (certs.error) throw new Error(`getStorageBoard(certs): ${certs.error.message}`);

  const locations = (status.data as StatusViewRow[]).map(mapStatus);
  const nameById = new Map<number, string>(
    locations.map((l) => [l.locationId, l.name]),
  );

  const greenLots: StoredGreenLot[] = (lots.data as GreenLotRow[]).map((l) => ({
    lotCode: l.lot_code,
    location: l.location,
  }));

  const certificates: StorageCertificate[] = (certs.data as CertRow[]).map((c) => ({
    id: Number(c.id),
    greenLotCode: c.green_lot_code,
    locationName: nameById.get(Number(c.location_id)) ?? null,
    windowStart: c.window_start,
    windowEnd: c.window_end,
    readingsCount: Number(c.readings_count),
    inBandPct: n(c.in_band_pct),
    verdict: c.verdict as StorageCertVerdict,
    issuedAt: c.issued_at,
  }));

  return { locations, greenLots, certificates };
});
