import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for ENTERING a green lot into an auction (P3-S4). Entering is
 * the load-bearing step: the SECURITY DEFINER `enter_auction_lot` RPC inserts a
 * `lot_reservations` row keyed buyer='AUCTION:<name>' FIRST, which fires the
 * EXISTING `prevent_oversell` + `_prevent_held_lot_commit` BEFORE-INSERT triggers.
 * The money guarantee is REUSED, not rebuilt (no parallel counter) — an
 * auction-committed lot can NEVER be double-sold via a B2B contract, and an
 * over-commit or a QC-held lot rolls the WHOLE transaction back. The RPC appends an
 * `auction_entered` lot_event and is idempotent on a tenant-qualified key (a replay
 * returns the same entry id with no second claim).
 *
 * Symmetric twin of the read ports: a pure validator plus a thin command that calls
 * the one `.rpc()` it needs (the `EnterAuctionLotStore` port), testable with no
 * database. The idempotency key is REQUIRED. The fail-closed oversell / QC-hold /
 * sold-auction rejections surface as CLEAN, family-readable sentences. Mirrors
 * acceptQuote.
 */

/** Validated, domain-shaped entry args (camelCase). */
export interface EnterAuctionLotInput {
  /** The `auctions.id` to enter the lot into (a positive integer). */
  auctionId: number;
  /** The green lot being entered (`green_lots.lot_code`). */
  greenLotCode: string;
  /** Kilograms committed to the auction (the `kg > 0` CHECK guards it). */
  kg: number;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

/**
 * Pure validation of a raw entry — mirrors the `enter_auction_lot` preconditions
 * (a real auction id, a lot code, kg > 0) so errors surface before the round-trip.
 * The oversell / QC-hold triggers fired by the reservation insert are the actual
 * enforcement.
 */
export function validateEnterAuctionLot(
  raw: Record<string, unknown>,
): ValidationResult<EnterAuctionLotInput> {
  const errors: Record<string, string> = {};

  const auctionId = toNumber(raw.auctionId);
  if (auctionId === null || !Number.isInteger(auctionId) || auctionId <= 0) {
    errors.auctionId = "Choose an auction to enter.";
  }

  const greenLotCode = trimmed(raw.greenLotCode);
  if (!greenLotCode) errors.greenLotCode = "A green lot is required.";

  const kg = toNumber(raw.kg);
  if (kg === null || kg <= 0) {
    errors.kg = "The kilograms entered must be greater than 0.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      auctionId: auctionId as number,
      greenLotCode,
      kg: kg as number,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint entry id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `enter_auction_lot` needs. */
export interface EnterAuctionLotStore {
  rpc(
    fn: "enter_auction_lot",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the entry id, or friendly/labelled errors. */
export type EnterAuctionLotResult =
  | { ok: true; entryId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `enter_auction_lot` onto a family-readable
 * sentence — the triggers/RPC are the real guard, but the family must never see raw
 * PG text (the `oversell guard:` / `qc-hold:` engine prefixes, errcodes). Returns
 * null for anything unrecognised so the caller falls back to a generic message.
 */
export function friendlyEnterAuctionLotError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // The REUSED money guarantee — the AUCTION reservation insert hit prevent_oversell.
  if (/oversell|available-to-promise|would exceed|no declared mass/.test(m)) {
    return "There isn't enough available-to-promise on this lot to enter that quantity. Lower the kilograms or pick another lot.";
  }
  // The QC-hold commit block (_prevent_held_lot_commit).
  if (/qc-hold|open qc-hold|reserved or shipped/.test(m)) {
    return "This lot is under an open QC hold and can't be entered yet. Release the hold first.";
  }
  // The auction is past accepting entries (status sold/withdrawn).
  if (/cannot enter a lot|is sold|is withdrawn/.test(m)) {
    return "This auction is no longer accepting lots — it has already sold or been withdrawn.";
  }
  // Unknown auction.
  if (error.code === "23503" || /unknown auction|foreign key/.test(m)) {
    return "That auction couldn't be found. Refresh and try again.";
  }
  return null;
}

/**
 * Validate then enter: calls `enter_auction_lot` exactly once with the snake_case
 * argument envelope. Bad input never reaches the RPC (friendly errors); the
 * fail-closed oversell / QC-hold / sold-auction rejections surface as CLEAN
 * sentences, any other failure surfaces labelled. Exactly-once on `idempotencyKey`
 * — a replay returns the same entry id with no second claim.
 */
export async function enterAuctionLot(
  store: EnterAuctionLotStore,
  raw: Record<string, unknown>,
): Promise<EnterAuctionLotResult> {
  const parsed = validateEnterAuctionLot(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("enter_auction_lot", {
    p_auction_id: parsed.data.auctionId,
    p_green_lot_code: parsed.data.greenLotCode,
    p_kg: parsed.data.kg,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyEnterAuctionLotError(error) ??
        "This lot couldn't be entered right now. Please try again.",
    };
  }
  if (data == null) {
    return { ok: false, message: "This lot couldn't be entered right now. Please try again." };
  }
  return { ok: true, entryId: Number(data) };
}
