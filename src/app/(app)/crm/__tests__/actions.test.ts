import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Server Actions call `await (await getSupabase()).rpc(...)` and then, for the
// money-shaped sample dispatch, reactiveRefresh → revalidatePath. Mock both: a single
// rpc spy whose result each test sets, and a no-op revalidatePath. next-intl/server is
// mocked globally in setup.ts, so getTranslations resolves the REAL EN copy — the
// validation messages come back as the actual English strings the UI shows.
const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => Promise.resolve({ rpc: rpcMock }),
}));
const { revalidatePathMock } = vi.hoisted(() => ({ revalidatePathMock: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import {
  recordContactEventAction,
  recordSampleDispatchAction,
  recordSampleFeedbackAction,
  upsertContactAction,
} from "@/app/(app)/crm/actions";

beforeEach(() => {
  rpcMock.mockReset();
  revalidatePathMock.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("upsertContactAction — validation seam", () => {
  it("rejects an empty name WITHOUT touching the database", async () => {
    const result = await upsertContactAction({
      contactId: null,
      name: "   ",
      kind: "roaster",
      status: "lead",
      countryCode: "US",
      email: null,
      phone: null,
      buyerId: null,
      consentMarketing: false,
      consentSource: null,
      idempotencyKey: "k-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Enter the contact's name.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects marketing consent without a source (lawful basis) BEFORE the DB", async () => {
    const result = await upsertContactAction({
      contactId: null,
      name: "Onyx Coffee Lab",
      kind: "roaster",
      status: "lead",
      countryCode: "US",
      email: null,
      phone: null,
      buyerId: null,
      consentMarketing: true,
      consentSource: "  ",
      idempotencyKey: "k-2",
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe(
        "Marketing consent needs a source for lawful basis.",
      );
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes the EXACT snake_case p_ envelope to upsert_contact on the happy path", async () => {
    rpcMock.mockResolvedValue({ data: 12, error: null });
    const result = await upsertContactAction({
      contactId: null,
      name: "  Onyx Coffee Lab ",
      kind: "roaster",
      status: "active",
      countryCode: "US",
      email: "buyers@onyx.test",
      phone: null,
      buyerId: 7,
      consentMarketing: true,
      consentSource: "trade-show-2026",
      idempotencyKey: "k-3",
    });
    expect(result).toEqual({ ok: true, contactId: 12 });
    expect(rpcMock).toHaveBeenCalledWith("upsert_contact", {
      p_contact_id: null,
      p_name: "Onyx Coffee Lab",
      p_kind: "roaster",
      p_status: "active",
      p_country_code: "US",
      p_email: "buyers@onyx.test",
      p_phone: null,
      p_buyer_id: 7,
      p_consent_marketing: true,
      p_consent_source: "trade-show-2026",
      p_idempotency_key: "k-3",
    });
  });
});

describe("recordContactEventAction — the relationship ledger", () => {
  it("refuses to forge a consent event (consent flips only via upsert_contact)", async () => {
    const result = await recordContactEventAction({
      contactId: 1,
      kind: "consent_granted",
      note: "x",
      idempotencyKey: "k-4",
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe(
        "Consent changes are made by editing the contact, not as an activity.",
      );
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes the p_ envelope with a JSON payload for a normal event", async () => {
    rpcMock.mockResolvedValue({ data: "evt-uid", error: null });
    const result = await recordContactEventAction({
      contactId: 1,
      kind: "call",
      note: "Talked through the DEC lot",
      idempotencyKey: "k-5",
    });
    expect(result).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("record_contact_event", {
      p_contact_id: 1,
      p_kind: "call",
      p_payload: { note: "Talked through the DEC lot" },
      p_idempotency_key: "k-5",
    });
  });
});

describe("recordSampleDispatchAction — the money-shaped write", () => {
  it("rejects non-positive grams WITHOUT touching the database", async () => {
    const result = await recordSampleDispatchAction({
      greenLotCode: "JC-901",
      contactId: 1,
      grams: 0,
      courier: null,
      trackingNo: null,
      idempotencyKey: "k-6",
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe("Grams must be greater than zero.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes the exact envelope to record_sample_dispatch and busts inventory reads", async () => {
    rpcMock.mockResolvedValue({ data: 55, error: null });
    const result = await recordSampleDispatchAction({
      greenLotCode: "JC-901",
      contactId: 1,
      grams: 250,
      courier: "DHL",
      trackingNo: "1Z-XYZ",
      idempotencyKey: "k-7",
    });
    expect(result).toEqual({ ok: true, sampleId: 55 });
    expect(rpcMock).toHaveBeenCalledWith("record_sample_dispatch", {
      p_green_lot_code: "JC-901",
      p_contact_id: 1,
      p_grams: 250,
      p_courier: "DHL",
      p_tracking_no: "1Z-XYZ",
      p_idempotency_key: "k-7",
    });
    // A sample draws green ATP → the ripple busts the inventory consumer routes.
    expect(revalidatePathMock).toHaveBeenCalled();
  });

  it("surfaces the oversell guard message verbatim (never a raw SQLSTATE leak)", async () => {
    const guard =
      "oversell guard: committing 0.25 kg to green lot JC-901 would exceed its 0.2 kg available-to-promise (0 already committed)";
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: guard, code: "23514" },
    });
    const result = await recordSampleDispatchAction({
      greenLotCode: "JC-901",
      contactId: 1,
      grams: 250,
      courier: null,
      trackingNo: null,
      idempotencyKey: "k-8",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(guard);
      expect(result.error).not.toMatch(/SQLSTATE|23514/);
    }
  });

  it("maps an unknown structural Postgres error to clean generic copy", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'relation "sample_dispatches" does not exist', code: "42P01" },
    });
    const result = await recordSampleDispatchAction({
      greenLotCode: "JC-901",
      contactId: 1,
      grams: 250,
      courier: null,
      trackingNo: null,
      idempotencyKey: "k-9",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "Could not save that. Check the details and try again.",
      );
      expect(result.error).not.toMatch(/relation|sample_dispatches/);
    }
  });
});

describe("recordSampleFeedbackAction — the buyer's cup verdict", () => {
  it("rejects an invalid verdict WITHOUT touching the database", async () => {
    const result = await recordSampleFeedbackAction({
      sampleDispatchId: 55,
      score: 88,
      verdict: "maybe",
      notes: null,
      idempotencyKey: "k-10",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Choose a verdict.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes the exact envelope to record_sample_feedback", async () => {
    rpcMock.mockResolvedValue({ data: "fb-uid", error: null });
    const result = await recordSampleFeedbackAction({
      sampleDispatchId: 55,
      score: 88.5,
      verdict: "approved",
      notes: "Loved the jasmine",
      idempotencyKey: "k-11",
    });
    expect(result).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("record_sample_feedback", {
      p_sample_dispatch_id: 55,
      p_score: 88.5,
      p_verdict: "approved",
      p_notes: "Loved the jasmine",
      p_idempotency_key: "k-11",
    });
  });
});
