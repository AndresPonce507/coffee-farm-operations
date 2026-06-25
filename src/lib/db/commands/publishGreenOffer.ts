import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for publishing a green-offer line (P3-S1; ADR-002 — all writes
 * flow through a SECURITY DEFINER command RPC). `green_offers` is APPEND-ONLY: a
 * correction is a NEW row + `withdrawn_at`, never an edit. The single write door is
 * `publish_green_offer` — tenant-clamped, idempotent on a tenant-qualified key, and
 * it appends an `'offer_published'` lot_event.
 *
 * THE KEYSTONE the RPC's BEFORE-INSERT trigger (`_green_offers_regime_chk`) enforces:
 * a Presidential / Specialty single-origin lot can NEVER be published on the
 * commodity index — a Geisha never carries `regime='commodity'`. `asking_price` is
 * OPTIONAL: blank ⇒ null = an auction/RFQ offer (no fixed ask).
 *
 * Symmetric twin of the read ports: a pure validator plus a thin command that calls
 * the one `.rpc()` it needs (the `PublishGreenOfferStore` port), testable with no DB.
 */

/** The published-offer regime — the dual split (mirrors pricing_regime). */
export const OFFER_REGIMES = ["commodity", "reserve"] as const;
export type OfferRegime = (typeof OFFER_REGIMES)[number];

/** Validated, domain-shaped offer args (camelCase). */
export interface PublishGreenOfferInput {
  greenLotCode: string;
  regime: OfferRegime;
  /** Asking price ($/kg); null ⇒ auction/RFQ (no fixed ask). */
  askingPrice: number | null;
  /** Offered mass (kg); null ⇒ unspecified. */
  kg: number | null;
  /** Settlement currency — defaults to 'USD'. */
  currency: string;
  idempotencyKey: string;
}

/** Is `v` blank (absent / empty after trim)? */
function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

/** Is `v` one of the recognised regimes? (mirrors pricing_regime) */
function isOfferRegime(v: string): v is OfferRegime {
  return (OFFER_REGIMES as readonly string[]).includes(v);
}

/**
 * Pure validation of a raw offer — mirrors the `green_offers` constraints (regime is
 * pricing_regime NOT NULL; asking_price NULL = auction/RFQ) so errors surface before
 * the round-trip. The regime-vs-grade trigger is the REAL guard (the keystone).
 */
export function validatePublishGreenOffer(
  raw: Record<string, unknown>,
): ValidationResult<PublishGreenOfferInput> {
  const errors: Record<string, string> = {};

  const greenLotCode = trimmed(raw.greenLotCode);
  if (!greenLotCode) errors.greenLotCode = "Choose a green lot.";

  const rawRegime = trimmed(raw.regime);
  if (!rawRegime || !isOfferRegime(rawRegime)) {
    errors.regime = "Choose a regime (commodity or reserve).";
  }

  // asking_price: optional; blank ⇒ auction/RFQ (null). If present must be > 0.
  let askingPrice: number | null = null;
  if (!isBlank(raw.askingPrice)) {
    const p = toNumber(raw.askingPrice);
    if (p === null || p <= 0) errors.askingPrice = "Asking price must be greater than 0.";
    else askingPrice = p;
  }

  // kg: optional; if present must be > 0.
  let kg: number | null = null;
  if (!isBlank(raw.kg)) {
    const k = toNumber(raw.kg);
    if (k === null || k <= 0) errors.kg = "Offered mass (kg) must be greater than 0.";
    else kg = k;
  }

  const currency = trimmed(raw.currency) || "USD";

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      greenLotCode,
      regime: rawRegime as OfferRegime,
      askingPrice,
      kg,
      currency,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint offer id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `publish_green_offer` needs. */
export interface PublishGreenOfferStore {
  rpc(
    fn: "publish_green_offer",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the offer id, or friendly/labelled errors. */
export type PublishGreenOfferResult =
  | { ok: true; offerId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `publish_green_offer` onto a family-readable
 * sentence — the trigger is the real guard, but the family must never see raw PG
 * text. THE KEYSTONE: a reserve-only single-origin lot can't be offered as commodity.
 * Returns null for anything unrecognised (caller falls back to a generic message).
 */
export function friendlyPublishGreenOfferError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  if (/regime|reserve-only|commodity index|cannot be (offered|priced)/.test(m)) {
    return "This lot is reserve-only (Presidential/Specialty single-origin) — it can't be published on the commodity index. Publish it to the reserve round instead.";
  }
  if (error.code === "23503" || /unknown green lot|foreign key/.test(m)) {
    return "That green lot couldn't be found. Pick a lot from the list and try again.";
  }
  return null;
}

/**
 * Validate then publish: calls `publish_green_offer` exactly once with the snake_case
 * argument envelope. Bad input never reaches the RPC (friendly errors); the keystone
 * regime rejection surfaces as a CLEAN sentence, any other failure surfaces labelled.
 * Exactly-once on `idempotencyKey`.
 */
export async function publishGreenOffer(
  store: PublishGreenOfferStore,
  raw: Record<string, unknown>,
): Promise<PublishGreenOfferResult> {
  const parsed = validatePublishGreenOffer(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("publish_green_offer", {
    p_green_lot_code: parsed.data.greenLotCode,
    p_regime: parsed.data.regime,
    p_asking_price: parsed.data.askingPrice,
    p_kg: parsed.data.kg,
    p_currency: parsed.data.currency,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyPublishGreenOfferError(error) ??
        "This offer couldn't be published right now. Please check the details and try again.",
    };
  }
  if (data == null) {
    return { ok: false, message: "This offer couldn't be published right now. Please try again." };
  }
  return { ok: true, offerId: Number(data) };
}
