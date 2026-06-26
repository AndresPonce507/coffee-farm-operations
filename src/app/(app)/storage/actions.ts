"use server";

import { getTranslations } from "next-intl/server";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /storage WRITE port — the location / reading / certificate Server Actions (P3-S20).
 *
 * Server Actions are the one driving port (rail §7: only ever invoked by an
 * authenticated human submitting a form). Storage monitoring is owner-authored
 * evidence — it commits NO green inventory and touches no money — so none of these
 * are oversell- or margin-shaped. Each validates the shape the DB enforces BEFORE the
 * network hop, then appends through a single SECURITY DEFINER command RPC:
 *   • upsert_storage_location — the only storage_locations writer (idempotent create,
 *     an existing code updates its bands).
 *   • record_storage_reading — the append-only reading writer (idempotent: a re-synced
 *     offline / duplicated LoRaWAN uplink never double-counts).
 *   • issue_storage_certificate — the EVIDENCE GATE: it REFUSES (raises) when the
 *     window holds zero readings, so a cert can only ever say "insufficient-data",
 *     never a fabricated "in-band". That author-written refusal is family-readable, so
 *     it passes through verbatim; the verdict + cert_hash are computed at the database.
 *
 * The keystone guards (the evidence gate, the band CHECKs, the append-only triggers)
 * all live in the database; these actions surface the author-written guard messages
 * verbatim and map structural Postgres errors to clean copy — never a raw SQLSTATE
 * leak. The idempotency_key is CLIENT-minted (rail §1) so an exactly-once retry
 * collapses to the same row.
 *
 * REVALIDATION: a reading / location / certificate moves no inventory and no ATP — it
 * changes only the /storage board. There is no storage-shaped EventKind to ripple and
 * src/lib/revalidate.ts is a shared contract file (single-author in the Wiring pass),
 * so these actions intentionally bust nothing; the client island calls router.refresh()
 * to re-render the current route after a write. WIRING SEAM: add a "storage-reading"
 * EventKind whose RIPPLE routes are ["/storage"] (+ "/lots/[code]" for a certificate,
 * since issue_storage_certificate appends a 'storage_certified' lot_event) and repoint.
 */

export interface UpsertLocationInput {
  code: string;
  name: string;
  tempMinC: number;
  tempMaxC: number;
  rhMinPct: number;
  rhMaxPct: number;
  awMax: number;
  idempotencyKey: string;
}

export interface RecordReadingInput {
  locationCode: string;
  tempC: number | null;
  rhPct: number | null;
  aw: number | null;
  source: "manual" | "lorawan-sensor";
  deviceId: string | null;
  readingAt: string;
  idempotencyKey: string;
}

export interface IssueCertInput {
  greenLotCode: string;
  locationCode: string;
  windowStart: string;
  windowEnd: string;
  idempotencyKey: string;
}

export type LocationResult =
  | { ok: true; locationId: number }
  | { ok: false; error: string };

export type ReadingResult =
  | { ok: true; readingId: number }
  | { ok: false; error: string };

export type CertResult =
  | { ok: true; certificateId: number }
  | { ok: false; error: string };

interface PgError {
  message: string;
  code?: string;
}

/**
 * Map a Postgres error to family-readable copy. Our SECURITY DEFINER guards raise
 * author-written messages with these SQLSTATEs (the zero-readings evidence gate, the
 * band CHECKs, unknown-location / unknown-lot FKs, the append-only triggers) — all
 * safe and clear, so they pass through verbatim. Structural codes get canned guidance;
 * nothing raw ever leaks.
 */
function friendlyError(error: PgError, generic: string): string {
  switch (error.code) {
    case "23514": // check_violation — author-written guard messages (incl. the evidence gate)
    case "P0001": // raise_exception
    case "P0002": // no_data_found
    case "23503": // foreign_key_violation ("unknown location / green lot")
      return error.message;
    case "42501": // insufficient_privilege
      return "You don't have access to do that.";
    case "23505": // unique_violation — idempotent replay collided
      return "That was already saved.";
    default:
      return generic;
  }
}

const isFiniteNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

export async function upsertStorageLocationAction(
  input: UpsertLocationInput,
): Promise<LocationResult> {
  const t = await getTranslations("storage");

  const code = input.code?.trim();
  if (!code) return { ok: false, error: t("errors.locationCodeRequired") };
  const name = input.name?.trim();
  if (!name) return { ok: false, error: t("errors.locationNameRequired") };

  if (
    !isFiniteNum(input.tempMinC) ||
    !isFiniteNum(input.tempMaxC) ||
    !isFiniteNum(input.rhMinPct) ||
    !isFiniteNum(input.rhMaxPct) ||
    input.tempMinC > input.tempMaxC ||
    input.rhMinPct > input.rhMaxPct
  ) {
    return { ok: false, error: t("errors.bandOrder") };
  }
  if (!isFiniteNum(input.awMax) || input.awMax <= 0 || input.awMax > 1) {
    return { ok: false, error: t("errors.awRange") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("upsert_storage_location", {
    p_code: code,
    p_name: name,
    p_temp_min_c: input.tempMinC,
    p_temp_max_c: input.tempMaxC,
    p_rh_min_pct: input.rhMinPct,
    p_rh_max_pct: input.rhMaxPct,
    p_aw_max: input.awMax,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }
  return { ok: true, locationId: Number(data) };
}

export async function recordStorageReadingAction(
  input: RecordReadingInput,
): Promise<ReadingResult> {
  const t = await getTranslations("storage");

  const locationCode = input.locationCode?.trim();
  if (!locationCode) return { ok: false, error: t("errors.locationRequired") };

  // A reading must carry at least one measured value — an all-null row asserts nothing.
  if (input.tempC == null && input.rhPct == null && input.aw == null) {
    return { ok: false, error: t("errors.readingEmpty") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("record_storage_reading", {
    p_location_code: locationCode,
    p_temp_c: input.tempC,
    p_rh_pct: input.rhPct,
    p_aw: input.aw,
    p_source: input.source,
    p_device_id: input.deviceId,
    p_reading_at: input.readingAt,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }
  return { ok: true, readingId: Number(data) };
}

export async function issueStorageCertificateAction(
  input: IssueCertInput,
): Promise<CertResult> {
  const t = await getTranslations("storage");

  const greenLotCode = input.greenLotCode?.trim();
  if (!greenLotCode) return { ok: false, error: t("errors.lotRequired") };
  const locationCode = input.locationCode?.trim();
  if (!locationCode) return { ok: false, error: t("errors.locationRequired") };

  if (!input.windowStart?.trim() || !input.windowEnd?.trim()) {
    return { ok: false, error: t("errors.windowRequired") };
  }
  if (new Date(input.windowEnd).getTime() <= new Date(input.windowStart).getTime()) {
    return { ok: false, error: t("errors.windowOrder") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("issue_storage_certificate", {
    p_green_lot_code: greenLotCode,
    p_location_code: locationCode,
    p_window_start: input.windowStart,
    p_window_end: input.windowEnd,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    // The zero-readings evidence gate raises here; its message is family-readable.
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }
  return { ok: true, certificateId: Number(data) };
}
