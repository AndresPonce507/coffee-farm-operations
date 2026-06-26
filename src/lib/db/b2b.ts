import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/* ====================================================================== */
/* P3-S1 — B2B green backbone READ-port (the contract-to-cash trade trunk). */
/* A green lot is OFFERED (`v_offer_board`), put under a standards-based      */
/* sales contract (`v_contract_status`), and its un-fixed differential lines  */
/* tracked against the live ICE "C" mark on the fixation cockpit              */
/* (`v_fixation_cockpit`). The buyer master (`b2b_buyers`) is the green-buyer  */
/* CRM root created here (P3-S18 extends it). This port only READS; every      */
/* write goes through the SECURITY DEFINER RPCs in `@/lib/db/commands/*`.      */
/* Mirrors pricing.ts / greenlots.ts: `Row` interface + pure `mapX` mapper +   */
/* `cache()`'d getters; NULLs (an auction/RFQ offer's NULL asking_price, a     */
/* fresh draft's NULL rollups, a missing live "C" mark) are PRESERVED, never   */
/* fabricated to 0 — the UI shows "—" instead of a misleading number.          */
/* ====================================================================== */

/** A published offer / contract regime — the dual split (mirrors pricing_regime). */
export type OfferRegime = "commodity" | "reserve";

/** Coerce a nullable numeric (PostgREST may serialize as a string) to a number,
 *  PRESERVING null — a missing asking price / rollup / live mark stays null. */
function num(v: number | string | null | undefined): number | null {
  return v == null ? null : Number(v);
}

/* ---------------- v_offer_board ---------------- */

/** Shape of a `v_offer_board` row (snake_case; withdrawn_at IS NULL only).
 *  `asking_price` NULL = auction/RFQ; `offered_kg`/`atp_kg` NULL when unknown. */
export interface OfferBoardRow {
  offer_id: number | string;
  green_lot_code: string;
  regime: OfferRegime | string;
  asking_price: number | string | null;
  offered_kg: number | string | null;
  currency: string;
  sca_grade: string | null;
  cupping_score: number | string | null;
  atp_kg: number | string | null;
}

/** A live published offer line ⨝ grade/score ⨝ remaining ATP — the offer board. */
export interface OfferBoardEntry {
  offerId: number;
  greenLotCode: string;
  regime: OfferRegime | string;
  /** Asking price ($/kg). NULL ⇒ auction/RFQ (no fixed ask). */
  askingPrice: number | null;
  /** Offered mass (kg). NULL when unspecified. */
  offeredKg: number | null;
  currency: string;
  scaGrade: string | null;
  cuppingScore: number | null;
  /** Remaining available-to-promise (kg) from green_lots_atp. NULL ⇒ no green inventory. */
  atpKg: number | null;
}

/** Pure row → domain mapper for an offer-board entry (numeric coercion; NULL ask /
 *  kg / score / ATP preserved, never fabricated to 0). */
export function mapOfferBoardEntry(r: OfferBoardRow): OfferBoardEntry {
  return {
    offerId: Number(r.offer_id),
    greenLotCode: r.green_lot_code,
    regime: r.regime,
    askingPrice: num(r.asking_price),
    offeredKg: num(r.offered_kg),
    currency: r.currency,
    scaGrade: r.sca_grade,
    cuppingScore: num(r.cupping_score),
    atpKg: num(r.atp_kg),
  };
}

/* ---------------- v_contract_status ---------------- */

/** Shape of a `v_contract_status` row (snake_case): header + Σ line kg + Σ fixed
 *  value + fixation %. The rollups are NULL for a fresh draft with no lines. */
export interface ContractStatusRow {
  contract_id: number | string;
  contract_no: string;
  buyer_id: number | string;
  status: string;
  pricing_basis: string;
  incoterm: string;
  currency: string;
  total_kg: number | string | null;
  fixed_value: number | string | null;
  fixation_pct: number | string | null;
}

/** A sales-contract header with its line rollups — the status-rail source. */
export interface ContractStatus {
  contractId: number;
  contractNo: string;
  buyerId: number;
  status: string;
  pricingBasis: string;
  incoterm: string;
  currency: string;
  /** Σ of line kg. NULL when the contract has no lines yet. */
  totalKg: number | null;
  /** Σ of fixed value. NULL when nothing is fixed/priced. */
  fixedValue: number | null;
  /** Fraction of the contract whose price is fixed (0..1 or 0..100 per the view). NULL ⇒ unknown. */
  fixationPct: number | null;
}

/** Pure row → domain mapper for a contract header (numeric coercion; NULL rollups
 *  preserved for a fresh draft, never fabricated to 0). */
export function mapContractStatus(r: ContractStatusRow): ContractStatus {
  return {
    contractId: Number(r.contract_id),
    contractNo: r.contract_no,
    buyerId: Number(r.buyer_id),
    status: r.status,
    pricingBasis: r.pricing_basis,
    incoterm: r.incoterm,
    currency: r.currency,
    totalKg: num(r.total_kg),
    fixedValue: num(r.fixed_value),
    fixationPct: num(r.fixation_pct),
  };
}

/* ---------------- v_fixation_cockpit ---------------- */

/** Shape of a `v_fixation_cockpit` row (snake_case): un-fixed differential lines
 *  (differential basis + unit_price IS NULL only) × the live "C" ref + implied
 *  price. `current_c_price`/`implied_unit_price` are NULL with no live mark. */
export interface FixationCockpitRow {
  contract_line_id: number | string;
  contract_id: number | string;
  contract_no: string;
  green_lot_code: string;
  kg: number | string;
  differential_cents: number | string | null;
  ice_c_contract_month: string | null;
  current_c_price: number | string | null;
  implied_unit_price: number | string | null;
}

/** One un-fixed differential contract line × the current "C" = the unfixed price
 *  exposure the /sales/fixation cockpit hedges. */
export interface FixationCockpitLine {
  contractLineId: number;
  contractId: number;
  contractNo: string;
  greenLotCode: string;
  kg: number;
  /** Differential over the index (cents/lb); may be negative (a grade discount). */
  differentialCents: number | null;
  iceCContractMonth: string | null;
  /** Live "C" mark ($/lb). NULL when no mark exists for the month yet. */
  currentCPrice: number | null;
  /** Implied $/kg if fixed at the current "C". NULL when no live mark. */
  impliedUnitPrice: number | null;
}

/** Pure row → domain mapper for a cockpit line (numeric coercion; NULL live mark /
 *  implied price preserved; a negative differential is a legitimate discount). */
export function mapFixationCockpitLine(r: FixationCockpitRow): FixationCockpitLine {
  return {
    contractLineId: Number(r.contract_line_id),
    contractId: Number(r.contract_id),
    contractNo: r.contract_no,
    greenLotCode: r.green_lot_code,
    kg: Number(r.kg),
    differentialCents: num(r.differential_cents),
    iceCContractMonth: r.ice_c_contract_month,
    currentCPrice: num(r.current_c_price),
    impliedUnitPrice: num(r.implied_unit_price),
  };
}

/* ---------------- b2b_buyers (the buyer master) ---------------- */

/** Shape of a `b2b_buyers` row (snake_case) — the green-buyer CRM root. */
export interface B2bBuyerRow {
  id: number | string;
  name: string;
  country_code: string | null;
  buyer_type: string | null;
  default_incoterm: string | null;
  default_currency: string | null;
  created_at: string;
}

/** A B2B green buyer — name, ISO country (drives the consignee block), and the
 *  incoterm/currency defaults a new contract pre-fills from. */
export interface B2bBuyer {
  id: number;
  name: string;
  countryCode: string | null;
  buyerType: string | null;
  defaultIncoterm: string | null;
  defaultCurrency: string | null;
  createdAt: string;
}

/** Pure row → domain mapper for a buyer (id coercion; nullable defaults passthrough). */
export function mapB2bBuyer(r: B2bBuyerRow): B2bBuyer {
  return {
    id: Number(r.id),
    name: r.name,
    countryCode: r.country_code,
    buyerType: r.buyer_type,
    defaultIncoterm: r.default_incoterm,
    defaultCurrency: r.default_currency,
    createdAt: r.created_at,
  };
}

/* ---------------- getters (request-scoped cache) ---------------- */

/**
 * The live offer board (`v_offer_board`) — every published, un-withdrawn offer ⨝
 * its grade/score ⨝ remaining ATP. A reserve Geisha NEVER carries a "C" anchor
 * (the regime split is enforced at the DB). Ordered by green lot for a stable board.
 */
export const getOfferBoard = cache(async (): Promise<OfferBoardEntry[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_offer_board")
    .select("*")
    .order("green_lot_code");
  if (error) throw new Error(`getOfferBoard: ${error.message}`);
  return (data as OfferBoardRow[]).map(mapOfferBoardEntry);
});

/**
 * Every sales contract's header + line rollups (`v_contract_status`) for the
 * `/sales/contracts` board, ordered by contract number.
 */
export const getContracts = cache(async (): Promise<ContractStatus[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_contract_status")
    .select("*")
    .order("contract_no");
  if (error) throw new Error(`getContracts: ${error.message}`);
  return (data as ContractStatusRow[]).map(mapContractStatus);
});

/**
 * One contract's status (`v_contract_status` filtered to a contract_no), or `null`
 * when no such contract exists (notFound() territory for `/sales/contracts/[no]`).
 */
export const getContractStatus = cache(
  async (contractNo: string): Promise<ContractStatus | null> => {
    const { data, error } = await (await getSupabase())
      .from("v_contract_status")
      .select("*")
      .eq("contract_no", contractNo);
    if (error) throw new Error(`getContractStatus: ${error.message}`);
    const rows = (data as ContractStatusRow[] | null) ?? [];
    return rows.length > 0 ? mapContractStatus(rows[0]) : null;
  },
);

/**
 * The fixation cockpit (`v_fixation_cockpit`) — open, un-fixed differential lines ×
 * the live "C" ref + implied price. The `/sales/fixation` risk board; reserve lots
 * are excluded at the view. `currentCPrice`/`impliedUnitPrice` are NULL with no mark.
 */
export const getFixationCockpit = cache(
  async (): Promise<FixationCockpitLine[]> => {
    const { data, error } = await (await getSupabase())
      .from("v_fixation_cockpit")
      .select("*")
      .order("contract_no");
    if (error) throw new Error(`getFixationCockpit: ${error.message}`);
    return (data as FixationCockpitRow[]).map(mapFixationCockpitLine);
  },
);

/**
 * The green-buyer master (`b2b_buyers`), ordered by name — the picker source for
 * the contract composer and the CRM root P3-S18 extends.
 */
export const getB2bBuyers = cache(async (): Promise<B2bBuyer[]> => {
  const { data, error } = await (await getSupabase())
    .from("b2b_buyers")
    .select("*")
    .order("name");
  if (error) throw new Error(`getB2bBuyers: ${error.message}`);
  return (data as B2bBuyerRow[]).map(mapB2bBuyer);
});
