import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Server Actions call `await (await getSupabase()).rpc(...)` then (for a
// pre-shipment draw, which moves ATP) reactiveRefresh. Mock both: one rpc spy whose
// result each test sets, and a no-op revalidatePath. next-intl/server is mocked
// globally in setup.ts, so getTranslations resolves the REAL EN copy — validation
// messages come back as the actual English strings the UI shows.
const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => Promise.resolve({ rpc: rpcMock }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  logSampleAction,
  recordVerdictAction,
} from "@/app/(app)/sales/samples/actions";

beforeEach(() => rpcMock.mockReset());
afterEach(() => vi.clearAllMocks());

const logInput = () => ({
  greenLotCode: "JC-204",
  buyerId: 7,
  sampleKind: "pre_shipment" as const,
  grams: 200,
  courier: "DHL",
  trackingNo: "JD0001",
  idempotencyKey: "idem-1",
});

describe("logSampleAction — validation seam", () => {
  it("rejects an empty green lot WITHOUT touching the database", async () => {
    const r = await logSampleAction({ ...logInput(), greenLotCode: "  " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Pick a green lot to sample.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects non-positive grams WITHOUT touching the database", async () => {
    const r = await logSampleAction({ ...logInput(), grams: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Grams must be greater than zero.");
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("logSampleAction — command behaviour", () => {
  it("passes the EXACT snake_case p_ envelope to log_sample on the happy path", async () => {
    rpcMock.mockResolvedValue({ data: 42, error: null });
    const r = await logSampleAction(logInput());
    expect(r).toEqual({ ok: true, sampleId: 42 });
    expect(rpcMock).toHaveBeenCalledWith("log_sample", {
      p_green_lot_code: "JC-204",
      p_buyer_id: 7,
      p_sample_kind: "pre_shipment",
      p_grams: 200,
      p_courier: "DHL",
      p_tracking_no: "JD0001",
      p_idempotency_key: "idem-1",
    });
  });

  it("forwards a null buyer (spec/type sample) and trims a blank courier/tracking to null", async () => {
    rpcMock.mockResolvedValue({ data: 9, error: null });
    await logSampleAction({
      ...logInput(),
      buyerId: null,
      courier: "  ",
      trackingNo: "",
    });
    expect(rpcMock).toHaveBeenCalledWith(
      "log_sample",
      expect.objectContaining({
        p_buyer_id: null,
        p_courier: null,
        p_tracking_no: null,
      }),
    );
  });

  it("surfaces the oversell guard message verbatim on an over-draw (never a raw SQLSTATE leak)", async () => {
    const guard =
      "oversell guard: drawing 0.2 kg from green lot JC-204 would exceed its available-to-promise";
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: guard, code: "23514" },
    });
    const r = await logSampleAction(logInput());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(guard);
      expect(r.error).not.toMatch(/SQLSTATE|23514/);
    }
  });

  it("maps an unknown structural Postgres error to clean generic copy (no raw leak)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'relation "green_samples" does not exist', code: "42P01" },
    });
    const r = await logSampleAction(logInput());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("Could not save that. Check the details and try again.");
      expect(r.error).not.toMatch(/relation|green_samples/);
    }
  });
});

describe("recordVerdictAction — the buyer-feedback write", () => {
  it("rejects an out-of-range score WITHOUT touching the database", async () => {
    const r = await recordVerdictAction({
      sampleId: 1,
      buyerScore: 120,
      buyerVerdict: "approved",
      idempotencyKey: "k",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("A buyer score must be between 0 and 100.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a bad verdict WITHOUT touching the database", async () => {
    const r = await recordVerdictAction({
      sampleId: 1,
      buyerScore: null,
      // @ts-expect-error — exercising the runtime guard on an invalid verdict
      buyerVerdict: "maybe",
      idempotencyKey: "k",
    });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes the exact envelope to record_sample_verdict and returns the sample id", async () => {
    rpcMock.mockResolvedValue({ data: 5, error: null });
    const r = await recordVerdictAction({
      sampleId: 5,
      buyerScore: 92,
      buyerVerdict: "approved",
      idempotencyKey: "k2",
    });
    expect(r).toEqual({ ok: true, sampleId: 5 });
    expect(rpcMock).toHaveBeenCalledWith("record_sample_verdict", {
      p_sample_id: 5,
      p_buyer_score: 92,
      p_buyer_verdict: "approved",
      p_idempotency_key: "k2",
    });
  });

  it("allows a null score (a verdict without a number)", async () => {
    rpcMock.mockResolvedValue({ data: 5, error: null });
    const r = await recordVerdictAction({
      sampleId: 5,
      buyerScore: null,
      buyerVerdict: "rejected",
      idempotencyKey: "k3",
    });
    expect(r.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith(
      "record_sample_verdict",
      expect.objectContaining({ p_buyer_score: null }),
    );
  });
});
