import { isISODate, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for committing a drying lot to a station (P2-S4 — drying
 * management; ADR-002 — all writes flow through a `SECURITY DEFINER` command RPC).
 *
 * Committing a lot to a station consumes that station's capacity; the
 * `prevent_overcapacity` trigger fail-closes if the station is full. The single
 * write door is `assign_drying_station` — it closes any prior open assignment for
 * the lot (a move) and opens a new one, idempotent on the (lot, station, open)
 * shape (re-assigning to the same open station is a no-op). This command is a pure
 * validator plus a thin call to the one `.rpc()` method it needs (the
 * `AssignStationStore` port). Mirrors the `advanceProcessingStage` command idiom.
 */

/** Validated, domain-shaped assignment args (camelCase). */
export interface AssignStationInput {
  lotCode: string;
  stationId: string;
  /** Field wall-clock — `occurred_at` (when the lot moved onto the station). */
  occurredAt: string;
}

function isISOTimestamp(v: string): boolean {
  if (v === "") return false;
  const t = Date.parse(v);
  return Number.isFinite(t) && /\d{4}-\d{2}-\d{2}T/.test(v);
}

export function validateAssignStation(
  raw: Record<string, unknown>,
): ValidationResult<AssignStationInput> {
  const errors: Record<string, string> = {};

  const lotCode = trimmed(raw.lotCode);
  if (!lotCode) errors.lotCode = "Choose a lot to assign.";

  const stationId = trimmed(raw.stationId);
  if (!stationId) errors.stationId = "Choose a drying station.";

  const occurredAt = trimmed(raw.occurredAt);
  if (!isISOTimestamp(occurredAt) && !isISODate(occurredAt)) {
    errors.occurredAt = "A valid assignment time is required.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { lotCode, stationId, occurredAt } };
}

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

export interface AssignStationStore {
  rpc(
    fn: "assign_drying_station",
    args: Record<string, unknown>,
  ): Promise<RpcResult>;
}

export type AssignStationResult =
  | { ok: true; assignmentId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/** Translate the RPC's known failures into clean, family-readable reasons. */
function friendlyRpcError(
  error: { message: string; code?: string },
  stationId: string,
): string | null {
  // The overcapacity guard raises a check_violation with a "capacity guard:" prefix.
  if (/capacity guard|overcapac|capacity/i.test(error.message)) {
    return `Station ${stationId} is full — committing this lot would exceed its capacity. Move some beds first.`;
  }
  if (error.code === "23503" || /foreign key constraint|unknown/i.test(error.message)) {
    return "That lot or station doesn't exist — pick one from the list.";
  }
  if (/no declared mass/i.test(error.message)) {
    return "This lot has no recorded weight yet — record its drying weight before assigning a bed.";
  }
  return null;
}

/**
 * Validate then assign: calls `assign_drying_station` exactly once with the
 * snake_case envelope the SECURITY DEFINER RPC expects. The overcapacity guard's
 * fail-closed raise surfaces as a clean, family-readable reason.
 */
export async function assignStation(
  store: AssignStationStore,
  raw: Record<string, unknown>,
): Promise<AssignStationResult> {
  const parsed = validateAssignStation(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("assign_drying_station", {
    p_lot_code: parsed.data.lotCode,
    p_station_id: parsed.data.stationId,
    p_occurred_at: parsed.data.occurredAt,
  });

  if (error) {
    const friendly = friendlyRpcError(error, parsed.data.stationId);
    if (friendly) return { ok: false, message: friendly };
    return { ok: false, message: `assign_drying_station: ${error.message}` };
  }
  if (data == null) {
    return { ok: false, message: "assign_drying_station: no assignment id returned" };
  }
  return { ok: true, assignmentId: Number(data) };
}
