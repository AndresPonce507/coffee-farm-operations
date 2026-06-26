import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /sales/contracts read port (P3-S1 B2B trade trunk).
 *
 * Binds directly to the authoritative P3-S1 SQL surface — `v_contract_status`
 * (header + Σ line kg + Σ fixed value + fixation %) and the `b2b_buyers` CRM master
 * (for buyer names + the create picker). It does NOT import the sibling
 * `@/lib/db/b2b` port (built by a parallel fan-out — importing a not-yet-existent
 * module hard-fails Vite). READ-ONLY: writes go through the SECDEF RPCs in actions.ts.
 */

export type ContractStatus =
  | "draft"
  | "signed"
  | "fixed"
  | "in_transit"
  | "delivered"
  | "closed"
  | "cancelled";

export type PricingBasis = "fixed" | "differential" | "auction";
export type BuyerType = "roaster" | "importer" | "agent";

export interface Buyer {
  id: number;
  name: string;
  countryCode: string | null;
  buyerType: BuyerType | null;
  defaultIncoterm: string | null;
  defaultCurrency: string;
}

/** One contract header line (mirrors `v_contract_status`, enriched with buyer name). */
export interface ContractRow {
  contractId: number;
  contractNo: string;
  buyerId: number;
  buyerName: string | null;
  status: ContractStatus;
  pricingBasis: PricingBasis;
  incoterm: string;
  currency: string;
  totalKg: number;
  fixedValue: number;
  /** Fraction of lines with a fixed unit price (0–1). */
  fixationPct: number;
}

interface ContractStatusViewRow {
  contract_id: number;
  contract_no: string;
  buyer_id: number;
  status: string;
  pricing_basis: string;
  incoterm: string;
  currency: string;
  total_kg: number | string | null;
  fixed_value: number | string | null;
  fixation_pct: number | string | null;
}

interface BuyerRow {
  id: number;
  name: string;
  country_code: string | null;
  buyer_type: string | null;
  default_incoterm: string | null;
  default_currency: string | null;
}

const numOr0 = (v: number | string | null | undefined): number =>
  v == null ? 0 : Number(v);

function mapBuyer(r: BuyerRow): Buyer {
  return {
    id: r.id,
    name: r.name,
    countryCode: r.country_code,
    buyerType: (r.buyer_type as BuyerType | null) ?? null,
    defaultIncoterm: r.default_incoterm,
    defaultCurrency: r.default_currency ?? "USD",
  };
}

/** Every contract, header-only, with its buyer name resolved. */
export const getContracts = cache(async (): Promise<ContractRow[]> => {
  const sb = await getSupabase();
  const [contracts, buyers] = await Promise.all([
    sb.from("v_contract_status").select("*").order("contract_no", { ascending: false }),
    sb.from("b2b_buyers").select("id, name"),
  ]);

  if (contracts.error) throw new Error(`getContracts: ${contracts.error.message}`);
  if (buyers.error) throw new Error(`getContracts(buyers): ${buyers.error.message}`);

  const nameById = new Map<number, string>(
    (buyers.data as { id: number; name: string }[]).map((b) => [b.id, b.name]),
  );

  return (contracts.data as ContractStatusViewRow[]).map((r) => ({
    contractId: r.contract_id,
    contractNo: r.contract_no,
    buyerId: r.buyer_id,
    buyerName: nameById.get(r.buyer_id) ?? null,
    status: r.status as ContractStatus,
    pricingBasis: r.pricing_basis as PricingBasis,
    incoterm: r.incoterm,
    currency: r.currency,
    totalKg: numOr0(r.total_kg),
    fixedValue: numOr0(r.fixed_value),
    fixationPct: numOr0(r.fixation_pct),
  }));
});

/** The buyer CRM master — the create-contract picker source. */
export const getBuyers = cache(async (): Promise<Buyer[]> => {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from("b2b_buyers")
    .select("id, name, country_code, buyer_type, default_incoterm, default_currency")
    .order("name");
  if (error) throw new Error(`getBuyers: ${error.message}`);
  return (data as BuyerRow[]).map(mapBuyer);
});
