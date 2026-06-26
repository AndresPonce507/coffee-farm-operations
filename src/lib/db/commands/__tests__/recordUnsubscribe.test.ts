import { describe, expect, it, vi } from "vitest";

import {
  recordUnsubscribe,
  validateRecordUnsubscribe,
  type RecordUnsubscribeStore,
} from "@/lib/db/commands/recordUnsubscribe";

/**
 * Pure-domain command test for a contact's own opt-out (P3-S20 — CAN-SPAM/GDPR;
 * ADR-002). record_unsubscribe stamps `unsubscribed_at`, withdraws marketing
 * consent, and logs a hash-chained 'consent_withdrawn' contact_event. Suppression
 * only REMOVES capability (never a send / money write), so it honours the
 * no-untrusted-inbound rail even when auto-applied. The RPC returns VOID, so the
 * command resolves to a bare `{ ok: true }` on success (no id). Drives the command
 * against a fake `.rpc('record_unsubscribe', …)` store and proves the validation
 * seam, the exact snake_case envelope, and a clean unknown-contact message.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: RecordUnsubscribeStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as RecordUnsubscribeStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  contactId: "4",
  idempotencyKey: "idem-unsub-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateRecordUnsubscribe", () => {
  it("accepts a complete, well-formed unsubscribe", () => {
    const r = validateRecordUnsubscribe(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.contactId).toBe(4);
      expect(r.data.idempotencyKey).toBe("idem-unsub-1");
    }
  });

  it("rejects a missing / non-numeric contact id", () => {
    expect(validateRecordUnsubscribe({ ...validRaw(), contactId: "" }).ok).toBe(false);
    expect(validateRecordUnsubscribe({ ...validRaw(), contactId: "abc" }).ok).toBe(false);
  });

  it("rejects a non-positive / non-integer contact id", () => {
    expect(validateRecordUnsubscribe({ ...validRaw(), contactId: "0" }).ok).toBe(false);
    expect(validateRecordUnsubscribe({ ...validRaw(), contactId: "3.5" }).ok).toBe(false);
  });

  it("rejects a missing idempotency key", () => {
    const r = validateRecordUnsubscribe({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("recordUnsubscribe", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await recordUnsubscribe(store, { ...validRaw(), contactId: "" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_unsubscribe with the exact snake_case envelope and resolves ok (void RPC)", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await recordUnsubscribe(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_unsubscribe", {
      p_contact_id: 4,
      p_idempotency_key: "idem-unsub-1",
    });
    expect(result.ok).toBe(true);
  });

  it("surfaces an unknown contact as a friendly not-found message", async () => {
    const { store } = fakeStore({
      data: null,
      error: { code: "23503", message: "unknown contact 999 for tenant" },
    });
    const result = await recordUnsubscribe(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/contact|found/i);
  });

  it("falls back to a labelled message for an unrecognised RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "deadlock detected" },
    });
    const result = await recordUnsubscribe(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
