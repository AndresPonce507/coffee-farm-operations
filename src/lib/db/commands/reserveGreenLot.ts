import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for reserving kg of a GreenLot against a buyer (S5 — the
 * first money-shaped slice). Unlike the other writes, a reservation is NOT an
 * RPC: it is an APPEND-ONLY claim row inserted into `lot_reservations` (the
 * migration grants INSERT — and only INSERT — on the claim tables; there is no
 * reservation RPC and no client update/delete path).
 *
 * The money guarantee lives in the data layer: the `prevent_oversell` BEFORE
 * INSERT trigger FAILS CLOSED — an insert whose committed total (Σreservations +
 * Σshipments) would exceed the green lot's `current_kg` is physically rejected
 * (errcode check_violation). Double-selling a scarce micro-lot is impossible; the
 * UI *cannot* create a double-sell. This command's job is to (a) surface friendly
 * validation before the round-trip and (b) translate that trigger rejection into
 * a CLEAN, buyer-readable error instead of leaking a raw Postgres exception.
 *
 * Symmetric twin of the read ports: a pure validator (`validateReserveGreenLot`)
 * plus a thin command (`reserveGreenLot`) that depends on the one insert path it
 * needs (the `ReserveGreenLotStore` port) so it is testable against a fake store
 * with no database. Mirrors the `@/lib/validation/*` `ValidationResult` contract.
 */

/** Validated, domain-shaped reservation args (camelCase). */
export interface ReserveGreenLotInput {
  /** The green lot's code (`green_lots.lot_code`) the kg are claimed against. */
  greenLotCode: string;
  /** The buyer the reservation is held for. */
  buyer: string;
  /** Mass (kg) to reserve — the `kg > 0` CHECK + the oversell trigger guard it. */
  kg: number;
}

/**
 * Pure validation of a raw reservation — mirrors the `lot_reservations`
 * NOT NULL / `kg > 0` CHECKs so errors surface before the round-trip. The
 * `prevent_oversell` trigger is the actual availability enforcement (ADR-002).
 */
export function validateReserveGreenLot(
  raw: Record<string, unknown>,
): ValidationResult<ReserveGreenLotInput> {
  const errors: Record<string, string> = {};

  const greenLotCode = trimmed(raw.greenLotCode);
  if (!greenLotCode) errors.greenLotCode = "Choose a green lot.";

  const buyer = trimmed(raw.buyer);
  if (!buyer) errors.buyer = "A buyer is required.";

  const kg = toNumber(raw.kg);
  if (kg === null || kg <= 0) {
    errors.kg = "Reserved mass (kg) must be greater than 0.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { greenLotCode, buyer, kg: kg as number } };
}

/** The PostgREST shape an `.insert()` returns. */
interface InsertResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

/**
 * The narrow write port the command depends on — exactly the append-only insert
 * path `lot_reservations` needs. A Supabase client satisfies this structurally
 * (`.from(table).insert(row)`); a hand-rolled stub satisfies it in tests.
 */
export interface ReserveGreenLotStore {
  from(table: "lot_reservations"): {
    insert(row: Record<string, unknown>): Promise<InsertResult>;
  };
}

/** Outcome of the command: success, or friendly/labelled errors. */
export type ReserveGreenLotResult =
  | { ok: true }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Does this insert error look like the `prevent_oversell` trigger firing? The
 * trigger raises with errcode `check_violation` (SQLSTATE 23514) and an
 * "oversell guard…available-to-promise" message; we match either signal so the
 * family sees a clean availability error, not a raw exception.
 */
function isOversell(error: { message: string; code?: string }): boolean {
  return (
    error.code === "23514" ||
    /oversell|available-to-promise|would exceed/i.test(error.message)
  );
}

/**
 * Validate then reserve: appends exactly one `lot_reservations` row with the
 * snake_case column envelope. Bad input never reaches the DB (friendly errors).
 * An oversell rejection from the `prevent_oversell` trigger surfaces as a CLEAN,
 * buyer-readable message (the underlying availability detail preserved); any
 * other insert failure surfaces labelled.
 */
export async function reserveGreenLot(
  store: ReserveGreenLotStore,
  raw: Record<string, unknown>,
): Promise<ReserveGreenLotResult> {
  const parsed = validateReserveGreenLot(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { error } = await store.from("lot_reservations").insert({
    green_lot_code: parsed.data.greenLotCode,
    buyer: parsed.data.buyer,
    kg: parsed.data.kg,
  });

  if (error) {
    if (isOversell(error)) {
      // Clean, friendly surfacing of the fail-closed oversell guard — the lot
      // code stays in the message so the family knows which lot is short.
      return {
        ok: false,
        message: `Not enough available-to-promise on ${parsed.data.greenLotCode} to reserve ${parsed.data.kg} kg — ${error.message}`,
      };
    }
    return { ok: false, message: `reserve green lot: ${error.message}` };
  }
  return { ok: true };
}
