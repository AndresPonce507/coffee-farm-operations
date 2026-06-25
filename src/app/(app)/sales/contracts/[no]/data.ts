import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";
import type {
  ContractStatus,
  PricingBasis,
} from "@/app/(app)/sales/contracts/data";

/**
 * /sales/contracts/[no] read port (P3-S1 trade trunk).
 *
 * Binds directly to the authoritative P3-S1 SQL surface — the `sales_contracts`
 * header (for the named-place + standard + signed-at the summary view omits), the
 * `v_contract_status` view (for Σ kg / Σ fixed value / fixation %), the `b2b_buyers`
 * CRM master, the `contract_lines` ledger, and the P3-S0 `v_lot_price_book` (the
 * add-line picker — each lot's regime + remaining ATP). READ-ONLY: writes go through
 * the SECDEF RPCs in actions.ts.
 */

export type { ContractStatus, PricingBasis };
export type PricingRegime = "commodity" | "reserve";

/** One contract line (mirrors `contract_lines`). */
export interface ContractLine {
  id: number;
  greenLotCode: string;
  kg: number;
  /** $/kg once fixed (or supplied for a fixed-basis line); NULL ⇒ not fixed yet. */
  unitPrice: number | null;
  differentialCents: number | null;
  iceCMonth: string | null;
  reservationId: number | null;
  fixedAt: string | null;
}

/** A green lot that can be added as a line (mirrors `v_lot_price_book`). */
export interface AvailableLot {
  greenLotCode: string;
  regime: PricingRegime;
  atpKg: number | null;
}

/** The full contract workspace payload. */
export interface ContractDetail {
  contractId: number;
  contractNo: string;
  buyerId: number;
  buyerName: string | null;
  buyerCountry: string | null;
  status: ContractStatus;
  pricingBasis: PricingBasis;
  incoterm: string;
  namedPlace: string | null;
  standard: string | null;
  currency: string;
  signedAt: string | null;
  totalKg: number;
  fixedValue: number;
  /** Fraction of lines with a fixed unit price (0–1). */
  fixationPct: number;
  lines: ContractLine[];
  availableLots: AvailableLot[];
}

interface ContractHeaderRow {
  id: number;
  buyer_id: number;
  status: string;
  pricing_basis: string;
  incoterm: string;
  incoterm_named_place: string | null;
  contract_standard: string | null;
  currency: string;
  signed_at: string | null;
}

interface ContractStatusRow {
  total_kg: number | string | null;
  fixed_value: number | string | null;
  fixation_pct: number | string | null;
}

interface ContractLineRow {
  id: number;
  green_lot_code: string;
  kg: number | string;
  unit_price: number | string | null;
  differential_cents: number | string | null;
  ice_c_contract_month: string | null;
  reservation_id: number | null;
  fixed_at: string | null;
}

interface PriceBookViewRow {
  green_lot_code: string;
  regime: string;
  atp_kg: number | string | null;
}

const n = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);
const numOr0 = (v: number | string | null | undefined): number =>
  v == null ? 0 : Number(v);

/**
 * The full workspace payload for one contract. Returns null when no contract matches
 * the number (the page 404s — never a fabricated contract).
 */
export const getContractDetail = cache(
  async (contractNo: string): Promise<ContractDetail | null> => {
    const sb = await getSupabase();

    const { data: header, error: headerErr } = await sb
      .from("sales_contracts")
      .select(
        "id, buyer_id, status, pricing_basis, incoterm, incoterm_named_place, contract_standard, currency, signed_at",
      )
      .eq("contract_no", contractNo)
      .maybeSingle();
    if (headerErr) throw new Error(`getContractDetail: ${headerErr.message}`);
    if (!header) return null;

    const h = header as ContractHeaderRow;

    const [statusRes, buyerRes, linesRes, lotsRes] = await Promise.all([
      sb
        .from("v_contract_status")
        .select("total_kg, fixed_value, fixation_pct")
        .eq("contract_no", contractNo)
        .maybeSingle(),
      sb
        .from("b2b_buyers")
        .select("name, country_code")
        .eq("id", h.buyer_id)
        .maybeSingle(),
      sb
        .from("contract_lines")
        .select(
          "id, green_lot_code, kg, unit_price, differential_cents, ice_c_contract_month, reservation_id, fixed_at",
        )
        .eq("contract_id", h.id)
        .order("created_at", { ascending: true }),
      sb
        .from("v_lot_price_book")
        .select("green_lot_code, regime, atp_kg")
        .order("green_lot_code"),
    ]);

    if (linesRes.error) {
      throw new Error(`getContractDetail(lines): ${linesRes.error.message}`);
    }

    const totals = statusRes.data as ContractStatusRow | null;
    const buyer = buyerRes.data as
      | { name: string; country_code: string | null }
      | null;

    const lines: ContractLine[] = (
      (linesRes.data as ContractLineRow[] | null) ?? []
    ).map((r) => ({
      id: r.id,
      greenLotCode: r.green_lot_code,
      kg: Number(r.kg),
      unitPrice: n(r.unit_price),
      differentialCents: n(r.differential_cents),
      iceCMonth: r.ice_c_contract_month,
      reservationId: r.reservation_id,
      fixedAt: r.fixed_at,
    }));

    const availableLots: AvailableLot[] = (
      (lotsRes.data as PriceBookViewRow[] | null) ?? []
    ).map((r) => ({
      greenLotCode: r.green_lot_code,
      regime: r.regime === "reserve" ? "reserve" : "commodity",
      atpKg: n(r.atp_kg),
    }));

    return {
      contractId: h.id,
      contractNo,
      buyerId: h.buyer_id,
      buyerName: buyer?.name ?? null,
      buyerCountry: buyer?.country_code ?? null,
      status: h.status as ContractStatus,
      pricingBasis: h.pricing_basis as PricingBasis,
      incoterm: h.incoterm,
      namedPlace: h.incoterm_named_place,
      standard: h.contract_standard,
      currency: h.currency,
      signedAt: h.signed_at,
      totalKg: numOr0(totals?.total_kg),
      fixedValue: numOr0(totals?.fixed_value),
      fixationPct: numOr0(totals?.fixation_pct),
      lines,
      availableLots,
    };
  },
);
