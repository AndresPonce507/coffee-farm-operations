import { describe, expect, it, vi } from "vitest";

import {
  recordContactEvent,
  validateRecordContactEvent,
  type RecordContactEventStore,
} from "@/lib/db/commands/recordContactEvent";

/**
 * Pure-domain command test for logging a relationship event onto a contact's
 * append-only, hash-chained timeline (P3-S18; ADR-002 — every write flows through a
 * SECURITY DEFINER RPC). `record_contact_event` REFUSES the consent kinds
 * ('consent_granted'/'consent_withdrawn') — consent state changes only via
 * `upsert_contact`, never forged independently — so the validator rejects them
 * client-side too (the RPC raise is the real enforcement). The RPC returns a uuid
 * (the event_uid), coerced to a string. Drives the command against a fake
 * `.rpc('record_contact_event', …)` store and proves the validation seam + the exact
 * snake_case argument envelope (incl. the default empty payload).
 */

interface RpcResult {
  data: string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: RecordContactEventStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as RecordContactEventStore, rpc };
}

const EVENT_UID = "11111111-1111-1111-1111-111111111111";

const validRaw = (): Record<string, unknown> => ({
  contactId: "7",
  kind: "inquiry",
  payload: { note: "asked about the BoP Geisha" },
  idempotencyKey: "idem-evt-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateRecordContactEvent", () => {
  it("accepts a complete, well-formed event", () => {
    const r = validateRecordContactEvent(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.contactId).toBe(7);
      expect(r.data.kind).toBe("inquiry");
      expect(r.data.payload).toEqual({ note: "asked about the BoP Geisha" });
      expect(r.data.idempotencyKey).toBe("idem-evt-1");
    }
  });

  it("defaults an omitted payload to an empty object", () => {
    const { payload: _omit, ...noPayload } = validRaw();
    const r = validateRecordContactEvent(noPayload);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.payload).toEqual({});
  });

  it("accepts the non-consent contact_event_kind values", () => {
    for (const k of [
      "inquiry",
      "sample_requested",
      "sample_sent",
      "sample_feedback",
      "quote_sent",
      "meeting",
      "call",
      "note",
    ]) {
      const r = validateRecordContactEvent({ ...validRaw(), kind: k });
      expect(r.ok).toBe(true);
    }
  });

  it("REFUSES consent_granted (consent flows only via upsert_contact)", () => {
    const r = validateRecordContactEvent({
      ...validRaw(),
      kind: "consent_granted",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.kind).toMatch(/consent/i);
  });

  it("REFUSES consent_withdrawn", () => {
    const r = validateRecordContactEvent({
      ...validRaw(),
      kind: "consent_withdrawn",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.kind).toBeDefined();
  });

  it("rejects an unknown kind", () => {
    const r = validateRecordContactEvent({ ...validRaw(), kind: "tweeted" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.kind).toBeDefined();
  });

  it("rejects a missing / non-positive contact id", () => {
    const missing = validateRecordContactEvent({ ...validRaw(), contactId: "" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.contactId).toBeDefined();

    const zero = validateRecordContactEvent({ ...validRaw(), contactId: "0" });
    expect(zero.ok).toBe(false);
  });

  it("rejects a missing idempotency key", () => {
    const r = validateRecordContactEvent({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("recordContactEvent", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await recordContactEvent(store, {
      ...validRaw(),
      kind: "consent_granted",
    });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_contact_event with the exact snake_case envelope and returns the event uid", async () => {
    const { store, rpc } = fakeStore({ data: EVENT_UID, error: null });
    const result = await recordContactEvent(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_contact_event", {
      p_contact_id: 7,
      p_kind: "inquiry",
      p_payload: { note: "asked about the BoP Geisha" },
      p_idempotency_key: "idem-evt-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.eventUid).toBe(EVENT_UID);
  });

  it("forwards an empty payload object when none is supplied", async () => {
    const { store, rpc } = fakeStore({ data: EVENT_UID, error: null });
    const { payload: _omit, ...noPayload } = validRaw();
    await recordContactEvent(store, noPayload);
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_payload).toEqual({});
  });

  it("surfaces a labelled error (never raw PG) when the RPC fails", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "permission denied for table contact_events" },
    });
    const result = await recordContactEvent(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBeTruthy();
      expect(result.message).toContain("permission denied");
    }
  });
});
