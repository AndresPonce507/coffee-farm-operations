"use server";

import { getTranslations } from "next-intl/server";

import { reactiveRefresh } from "@/lib/revalidate";
import { getSupabase } from "@/lib/supabase/server";

/**
 * /sales/auctions WRITE port — the auction command Server Actions (P3-S4).
 *
 * Server Actions are the one driving port (ADR-002 / rail §7: only ever invoked by an
 * authenticated human submitting a form — no untrusted inbound drives a write). Each
 * validates the shape the DB enforces BEFORE the network hop, then appends through a
 * single SECURITY DEFINER command RPC:
 *   • create_auction          — the auction-header writer (no inventory move).
 *   • enter_auction_lot        — inserts a lot_reservations row keyed buyer=
 *     'AUCTION:<name>'; the EXISTING prevent_oversell trigger fires there (no parallel
 *     counter), so an auction-committed lot can't be double-sold. ATP moves → revalidate.
 *   • record_auction_scoresheet — the append-only jury-mark writer (no inventory move).
 *   • record_auction_result    — the money-shaped WIN write-back: stamps the clearing
 *     price, seeds the auction_comps library, and books a reserve sale that REUSES the
 *     existing auction reservation (no new claim). Human-confirmed in the UI.
 *
 * The oversell guard, the append-only immutability, and the write-back loop all live in
 * the database; these actions surface the author-written guard messages verbatim (they
 * are family-readable) and map structural Postgres errors to clean copy — never a raw
 * SQLSTATE leak. The idempotency_key is CLIENT-minted (rail §1) so an exactly-once retry
 * collapses to the same row.
 */

export interface CreateAuctionInput {
  platform: string;
  name: string;
  entryDeadline: string | null;
  scoringDeadline: string | null;
  idempotencyKey: string;
}

export interface EnterLotInput {
  auctionId: number;
  greenLotCode: string;
  kg: number;
  idempotencyKey: string;
}

export interface ScoresheetInput {
  entryId: number;
  juror: string;
  attribute: string;
  score: number;
  idempotencyKey: string;
}

export interface RecordResultInput {
  entryId: number;
  juryScore: number | null;
  clearingPriceUsdPerKg: number;
  winningBidder: string | null;
  resultYear: number | null;
  idempotencyKey: string;
}

export type CreateAuctionResult =
  | { ok: true; auctionId: number }
  | { ok: false; error: string };

export type EnterLotResult =
  | { ok: true; entryId: number }
  | { ok: false; error: string };

export type ScoresheetResult =
  | { ok: true; scoresheetId: number }
  | { ok: false; error: string };

export type RecordResultResult =
  | { ok: true; entryId: number }
  | { ok: false; error: string };

interface PgError {
  message: string;
  code?: string;
}

/**
 * Map a Postgres error to family-readable copy. Our SECURITY DEFINER guards raise
 * author-written messages with these SQLSTATEs (oversell, status guards, append-only,
 * "positive clearing price") — all safe and clear, so they pass through verbatim.
 * Structural codes get canned guidance; nothing raw ever leaks.
 */
function friendlyError(error: PgError, generic: string): string {
  switch (error.code) {
    case "23514": // check_violation — author-written guard messages
    case "P0001": // raise_exception
    case "23503": // foreign_key_violation ("unknown auction / entry / green lot")
      return error.message;
    case "42501": // insufficient_privilege
      return "You don't have access to this auction.";
    case "23505": // unique_violation — idempotent replay collided
      return "That was already saved.";
    case "2BP01": // restrict_violation — append-only scoresheet
      return error.message;
    default:
      return generic;
  }
}

const isPositive = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

const isPositiveInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0;

export async function createAuctionAction(
  input: CreateAuctionInput,
): Promise<CreateAuctionResult> {
  const t = await getTranslations("auctions");
  if (!input.platform?.trim()) {
    return { ok: false, error: t("errors.platformRequired") };
  }
  if (!input.name?.trim()) {
    return { ok: false, error: t("errors.nameRequired") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("create_auction", {
    p_platform: input.platform.trim(),
    p_name: input.name.trim(),
    p_entry_deadline: input.entryDeadline,
    p_scoring_deadline: input.scoringDeadline,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }

  // A header carries no green inventory; nothing to bust.
  return { ok: true, auctionId: Number(data) };
}

export async function enterAuctionLotAction(
  input: EnterLotInput,
): Promise<EnterLotResult> {
  const t = await getTranslations("auctions");
  if (!isPositiveInt(input.auctionId)) {
    return { ok: false, error: t("errors.generic") };
  }
  if (!input.greenLotCode?.trim()) {
    return { ok: false, error: t("errors.lotRequired") };
  }
  if (!isPositive(input.kg)) {
    return { ok: false, error: t("errors.kgPositive") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("enter_auction_lot", {
    p_auction_id: input.auctionId,
    p_green_lot_code: input.greenLotCode.trim(),
    p_kg: input.kg,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }

  // enter_auction_lot inserted a lot_reservations row: green inventory / ATP moved.
  reactiveRefresh("inventory-update");
  return { ok: true, entryId: Number(data) };
}

export async function recordScoresheetAction(
  input: ScoresheetInput,
): Promise<ScoresheetResult> {
  const t = await getTranslations("auctions");
  if (!isPositiveInt(input.entryId)) {
    return { ok: false, error: t("errors.entryRequired") };
  }
  if (!input.juror?.trim()) {
    return { ok: false, error: t("errors.jurorRequired") };
  }
  if (!input.attribute?.trim()) {
    return { ok: false, error: t("errors.attributeRequired") };
  }
  if (
    typeof input.score !== "number" ||
    !Number.isFinite(input.score) ||
    input.score < 0 ||
    input.score > 100
  ) {
    return { ok: false, error: t("errors.scoreRange") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("record_auction_scoresheet", {
    p_entry_id: input.entryId,
    p_juror: input.juror.trim(),
    p_attribute: input.attribute.trim(),
    p_score: input.score,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }

  // Jury marks don't move ATP; the page re-reads client-side on success.
  return { ok: true, scoresheetId: Number(data) };
}

export async function recordAuctionResultAction(
  input: RecordResultInput,
): Promise<RecordResultResult> {
  const t = await getTranslations("auctions");
  if (!isPositiveInt(input.entryId)) {
    return { ok: false, error: t("errors.entryRequired") };
  }
  if (!isPositive(input.clearingPriceUsdPerKg)) {
    return { ok: false, error: t("errors.clearingPositive") };
  }
  if (
    input.juryScore != null &&
    (!Number.isFinite(input.juryScore) || input.juryScore < 0 || input.juryScore > 100)
  ) {
    return { ok: false, error: t("errors.scoreRange") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("record_auction_result", {
    p_entry_id: input.entryId,
    p_jury_score: input.juryScore,
    p_clearing_price_usd_per_kg: input.clearingPriceUsdPerKg,
    p_winning_bidder: input.winningBidder?.trim() ?? null,
    p_result_year: input.resultYear,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }

  // The result REUSES the existing auction reservation (no new claim → ATP unchanged),
  // but seeds the comp library + a reserve sale; the page re-reads client-side.
  return { ok: true, entryId: Number(data) };
}
