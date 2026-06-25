import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  mapB2bBuyer,
  mapContractStatus,
  mapFixationCockpitLine,
  mapOfferBoardEntry,
  type B2bBuyerRow,
  type ContractStatusRow,
  type FixationCockpitRow,
  type OfferBoardRow,
} from "@/lib/db/b2b";

/**
 * P3-S1 B2B read-port tests. Two layers:
 *   1. Pure mapper tests (snake_case PostgREST row → camelCase domain) — pin every
 *      field rename, numeric coercion (PostgREST may serialize numerics as strings),
 *      and the NULL-preservation rule (an auction/RFQ offer's NULL asking_price, an
 *      un-priced contract's NULL fixed_value, a missing live "C" mark — NEVER 0).
 *   2. Getter tests against a chainable Supabase stub (mirrors getters.test.ts) —
 *      each getter issues the right query against the right view/table and returns
 *      mapped domain objects; a failed query throws a labelled error.
 */

// ─────────────────────────── mapper layer ──────────────────────────────────

describe("mapOfferBoardEntry", () => {
  it("renames + coerces a priced reserve offer", () => {
    const row: OfferBoardRow = {
      offer_id: "12",
      green_lot_code: "JC-204",
      regime: "reserve",
      asking_price: "480",
      offered_kg: "300",
      currency: "USD",
      sca_grade: "Presidential",
      cupping_score: "91",
      atp_kg: "300",
    };
    expect(mapOfferBoardEntry(row)).toEqual({
      offerId: 12,
      greenLotCode: "JC-204",
      regime: "reserve",
      askingPrice: 480,
      offeredKg: 300,
      currency: "USD",
      scaGrade: "Presidential",
      cuppingScore: 91,
      atpKg: 300,
    });
  });

  it("preserves a NULL asking_price (auction/RFQ) and NULL atp_kg, never fabricating 0", () => {
    const row: OfferBoardRow = {
      offer_id: 5,
      green_lot_code: "JC-550",
      regime: "commodity",
      asking_price: null,
      offered_kg: null,
      currency: "USD",
      sca_grade: null,
      cupping_score: null,
      atp_kg: null,
    };
    const m = mapOfferBoardEntry(row);
    expect(m.askingPrice).toBeNull();
    expect(m.offeredKg).toBeNull();
    expect(m.atpKg).toBeNull();
    expect(m.scaGrade).toBeNull();
    expect(m.cuppingScore).toBeNull();
  });
});

describe("mapContractStatus", () => {
  it("renames + coerces a contract header with fixation rollups", () => {
    const row: ContractStatusRow = {
      contract_id: "7",
      contract_no: "JC-K-0001",
      buyer_id: "3",
      status: "signed",
      pricing_basis: "differential",
      incoterm: "FOB",
      currency: "USD",
      total_kg: "250",
      fixed_value: "0",
      fixation_pct: "0",
    };
    expect(mapContractStatus(row)).toEqual({
      contractId: 7,
      contractNo: "JC-K-0001",
      buyerId: 3,
      status: "signed",
      pricingBasis: "differential",
      incoterm: "FOB",
      currency: "USD",
      totalKg: 250,
      fixedValue: 0,
      fixationPct: 0,
    });
  });

  it("preserves NULL rollups for a fresh draft (no lines yet)", () => {
    const row: ContractStatusRow = {
      contract_id: 8,
      contract_no: "JC-K-0002",
      buyer_id: 3,
      status: "draft",
      pricing_basis: "fixed",
      incoterm: "EXW",
      currency: "USD",
      total_kg: null,
      fixed_value: null,
      fixation_pct: null,
    };
    const m = mapContractStatus(row);
    expect(m.totalKg).toBeNull();
    expect(m.fixedValue).toBeNull();
    expect(m.fixationPct).toBeNull();
  });
});

describe("mapFixationCockpitLine", () => {
  it("renames + coerces an un-fixed differential line with a live mark", () => {
    const row: FixationCockpitRow = {
      contract_line_id: "21",
      contract_id: "7",
      contract_no: "JC-K-0001",
      green_lot_code: "JC-550",
      kg: "2000",
      differential_cents: "35",
      ice_c_contract_month: "2026-12",
      current_c_price: "1.85",
      implied_unit_price: "4.85",
    };
    expect(mapFixationCockpitLine(row)).toEqual({
      contractLineId: 21,
      contractId: 7,
      contractNo: "JC-K-0001",
      greenLotCode: "JC-550",
      kg: 2000,
      differentialCents: 35,
      iceCContractMonth: "2026-12",
      currentCPrice: 1.85,
      impliedUnitPrice: 4.85,
    });
  });

  it("preserves a NULL current_c_price / implied_unit_price (no live mark yet)", () => {
    const row: FixationCockpitRow = {
      contract_line_id: 22,
      contract_id: 7,
      contract_no: "JC-K-0001",
      green_lot_code: "JC-551",
      kg: 1000,
      differential_cents: -10,
      ice_c_contract_month: "2027-03",
      current_c_price: null,
      implied_unit_price: null,
    };
    const m = mapFixationCockpitLine(row);
    expect(m.differentialCents).toBe(-10);
    expect(m.currentCPrice).toBeNull();
    expect(m.impliedUnitPrice).toBeNull();
  });
});

describe("mapB2bBuyer", () => {
  it("renames + coerces a buyer master row", () => {
    const row: B2bBuyerRow = {
      id: "3",
      name: "Maruyama Coffee",
      country_code: "JP",
      buyer_type: "roaster",
      default_incoterm: "FOB",
      default_currency: "USD",
      created_at: "2026-06-24T10:00:00.000Z",
    };
    expect(mapB2bBuyer(row)).toEqual({
      id: 3,
      name: "Maruyama Coffee",
      countryCode: "JP",
      buyerType: "roaster",
      defaultIncoterm: "FOB",
      defaultCurrency: "USD",
      createdAt: "2026-06-24T10:00:00.000Z",
    });
  });

  it("preserves nullable buyer defaults", () => {
    const row: B2bBuyerRow = {
      id: 4,
      name: "Agent X",
      country_code: null,
      buyer_type: null,
      default_incoterm: null,
      default_currency: null,
      created_at: "2026-06-24T10:00:00.000Z",
    };
    const m = mapB2bBuyer(row);
    expect(m.countryCode).toBeNull();
    expect(m.buyerType).toBeNull();
    expect(m.defaultIncoterm).toBeNull();
    expect(m.defaultCurrency).toBeNull();
  });
});

// ─────────────────────────── getter layer ──────────────────────────────────

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

/** A chainable, awaitable Supabase query-builder stub (mirrors getters.test.ts). */
function makeBuilder<T>(result: QueryResult<T>) {
  const builder = {
    from: vi.fn(() => builder),
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (
      onFulfilled: (value: QueryResult<T>) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return builder;
}

const getSupabaseMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));

let lastBuilder: ReturnType<typeof makeBuilder>;
function stubQuery<T>(data: T, error: { message: string } | null = null) {
  const builder = makeBuilder({ data, error });
  lastBuilder = builder;
  getSupabaseMock.mockReturnValue({ from: (...a: unknown[]) => builder.from(...a) });
}

beforeEach(() => getSupabaseMock.mockReset());
afterEach(() => vi.resetModules());

describe("getOfferBoard", () => {
  it("queries v_offer_board and returns mapped offers", async () => {
    stubQuery([
      {
        offer_id: 12,
        green_lot_code: "JC-204",
        regime: "reserve",
        asking_price: "480",
        offered_kg: "300",
        currency: "USD",
        sca_grade: "Presidential",
        cupping_score: "91",
        atp_kg: "300",
      },
    ]);
    const { getOfferBoard } = await import("@/lib/db/b2b");
    const offers = await getOfferBoard();
    expect(lastBuilder.from).toHaveBeenCalledWith("v_offer_board");
    expect(offers[0]).toMatchObject({ offerId: 12, regime: "reserve", askingPrice: 480 });
  });

  it("throws a labelled error when the query fails", async () => {
    stubQuery(null, { message: "boom" });
    const { getOfferBoard } = await import("@/lib/db/b2b");
    await expect(getOfferBoard()).rejects.toThrow("getOfferBoard: boom");
  });
});

describe("getContracts / getContractStatus", () => {
  it("queries v_contract_status for the list", async () => {
    stubQuery([
      {
        contract_id: 7,
        contract_no: "JC-K-0001",
        buyer_id: 3,
        status: "signed",
        pricing_basis: "differential",
        incoterm: "FOB",
        currency: "USD",
        total_kg: "250",
        fixed_value: null,
        fixation_pct: null,
      },
    ]);
    const { getContracts } = await import("@/lib/db/b2b");
    const rows = await getContracts();
    expect(lastBuilder.from).toHaveBeenCalledWith("v_contract_status");
    expect(rows[0]).toMatchObject({ contractNo: "JC-K-0001", totalKg: 250 });
  });

  it("getContractStatus returns null when the contract_no has no row", async () => {
    stubQuery([]);
    const { getContractStatus } = await import("@/lib/db/b2b");
    const c = await getContractStatus("JC-K-9999");
    expect(lastBuilder.eq).toHaveBeenCalledWith("contract_no", "JC-K-9999");
    expect(c).toBeNull();
  });
});

describe("getFixationCockpit", () => {
  it("queries v_fixation_cockpit and returns mapped lines", async () => {
    stubQuery([
      {
        contract_line_id: 21,
        contract_id: 7,
        contract_no: "JC-K-0001",
        green_lot_code: "JC-550",
        kg: "2000",
        differential_cents: "35",
        ice_c_contract_month: "2026-12",
        current_c_price: null,
        implied_unit_price: null,
      },
    ]);
    const { getFixationCockpit } = await import("@/lib/db/b2b");
    const lines = await getFixationCockpit();
    expect(lastBuilder.from).toHaveBeenCalledWith("v_fixation_cockpit");
    expect(lines[0]).toMatchObject({ contractLineId: 21, currentCPrice: null });
  });
});

describe("getB2bBuyers", () => {
  it("queries b2b_buyers and returns mapped buyers", async () => {
    stubQuery([
      {
        id: 3,
        name: "Maruyama Coffee",
        country_code: "JP",
        buyer_type: "roaster",
        default_incoterm: "FOB",
        default_currency: "USD",
        created_at: "2026-06-24T10:00:00.000Z",
      },
    ]);
    const { getB2bBuyers } = await import("@/lib/db/b2b");
    const buyers = await getB2bBuyers();
    expect(lastBuilder.from).toHaveBeenCalledWith("b2b_buyers");
    expect(buyers[0]).toMatchObject({ id: 3, name: "Maruyama Coffee", buyerType: "roaster" });
  });
});
