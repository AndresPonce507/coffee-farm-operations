import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Server Action calls `await (await getSupabase()).rpc("record_fx_rate", ...)`.
// Mock the client: one rpc spy whose result each test sets. next-intl/server is
// mocked globally in setup.ts, so getTranslations resolves the real EN copy —
// validation messages come back as the actual strings the UI shows.
const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => Promise.resolve({ rpc: rpcMock }),
}));

import { recordFxRateAction } from "@/app/(app)/margins/actions";

const input = () => ({
  asOf: "2026-06-20",
  base: "eur",
  quote: "usd",
  rate: 1.08,
  source: "ecb",
  idempotencyKey: "idem-1",
});

beforeEach(() => rpcMock.mockReset());
afterEach(() => vi.clearAllMocks());

describe("recordFxRateAction — validation seam (no DB touch)", () => {
  it("rejects an empty base currency WITHOUT touching the database", async () => {
    const result = await recordFxRateAction({ ...input(), base: "  " });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Enter the base currency, for example EUR.");
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a non-positive rate WITHOUT touching the database", async () => {
    const result = await recordFxRateAction({ ...input(), rate: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("The rate must be greater than zero.");
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed date WITHOUT touching the database", async () => {
    const result = await recordFxRateAction({ ...input(), asOf: "20-06-2026" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Pick the date the rate applies to.");
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("recordFxRateAction — command behaviour", () => {
  it("passes the EXACT snake_case p_ envelope to record_fx_rate (currencies upper-cased)", async () => {
    rpcMock.mockResolvedValue({ data: 9, error: null });
    const result = await recordFxRateAction(input());
    expect(result).toEqual({ ok: true, rateId: 9 });
    expect(rpcMock).toHaveBeenCalledWith("record_fx_rate", {
      p_as_of: "2026-06-20",
      p_base: "EUR",
      p_quote: "USD",
      p_rate: 1.08,
      p_source: "ecb",
      p_idempotency_key: "idem-1",
    });
  });

  it("surfaces an author-written guard message verbatim (never a raw SQLSTATE leak)", async () => {
    const guard = "no tenant in session";
    rpcMock.mockResolvedValue({ data: null, error: { message: guard, code: "P0001" } });
    const result = await recordFxRateAction(input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(guard);
      expect(result.error).not.toMatch(/SQLSTATE|P0001/);
    }
  });

  it("maps a duplicate-pair unique violation to clean copy", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "duplicate key value violates unique constraint", code: "23505" },
    });
    const result = await recordFxRateAction(input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "A rate for that day and currency pair is already on the books.",
      );
    }
  });

  it("maps an unknown structural Postgres error to clean generic copy (no raw leak)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'relation "fx_rate" does not exist', code: "42P01" },
    });
    const result = await recordFxRateAction(input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "Could not record that rate. Check the values and try again.",
      );
      expect(result.error).not.toMatch(/relation|fx_rate/);
    }
  });
});
