import { describe, expect, it, vi } from "vitest";

import {
  queueCampaignSend,
  validateQueueCampaignSend,
  type QueueCampaignSendStore,
} from "@/lib/db/commands/queueCampaignSend";

/**
 * Pure-domain command test for building the DRAFT outbound queue (P3-S20 — AI/owner
 * drafting; ADR-002). queue_campaign_send selects ONLY consenting, non-unsubscribed
 * contacts (the CONSENT GATE; the before-insert guard double-checks each row),
 * renders the merge tags, and inserts 'queued' rows — NOTHING is sent here. It
 * returns the COUNT of newly-queued rows (idempotent: a replay queues nothing more
 * → 0). Drives the command against a fake `.rpc('queue_campaign_send', …)` store and
 * proves the validation seam, the exact snake_case envelope, the count passthrough
 * (incl. 0), and a clean unknown-campaign message. The consent gate is the RPC's job.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: QueueCampaignSendStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as QueueCampaignSendStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  campaignId: "7",
  idempotencyKey: "idem-queue-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateQueueCampaignSend", () => {
  it("accepts a complete, well-formed queue request", () => {
    const r = validateQueueCampaignSend(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.campaignId).toBe(7);
      expect(r.data.idempotencyKey).toBe("idem-queue-1");
    }
  });

  it("also accepts the campaign id under `id`", () => {
    const r = validateQueueCampaignSend({ id: "9", idempotencyKey: "k" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.campaignId).toBe(9);
  });

  it("rejects a missing / non-numeric campaign id", () => {
    const missing = validateQueueCampaignSend({ ...validRaw(), campaignId: "" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.campaignId).toBeDefined();

    const nan = validateQueueCampaignSend({ ...validRaw(), campaignId: "abc" });
    expect(nan.ok).toBe(false);
  });

  it("rejects a non-positive / non-integer campaign id", () => {
    expect(validateQueueCampaignSend({ ...validRaw(), campaignId: "0" }).ok).toBe(false);
    expect(validateQueueCampaignSend({ ...validRaw(), campaignId: "1.5" }).ok).toBe(false);
  });

  it("rejects a missing idempotency key", () => {
    const r = validateQueueCampaignSend({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("queueCampaignSend", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await queueCampaignSend(store, { ...validRaw(), campaignId: "" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls queue_campaign_send with the exact snake_case envelope and returns the queued count", async () => {
    const { store, rpc } = fakeStore({ data: 14, error: null });
    const result = await queueCampaignSend(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("queue_campaign_send", {
      p_campaign_id: 7,
      p_idempotency_key: "idem-queue-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.queuedCount).toBe(14);
  });

  it("treats a 0 count (idempotent replay / no consenting contacts) as success", async () => {
    const { store } = fakeStore({ data: 0, error: null });
    const result = await queueCampaignSend(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.queuedCount).toBe(0);
  });

  it("surfaces an unknown campaign as a friendly not-found message", async () => {
    const { store } = fakeStore({
      data: null,
      error: { code: "23503", message: "unknown campaign 999 for tenant" },
    });
    const result = await queueCampaignSend(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/campaign|found/i);
  });

  it("falls back to a labelled message for an unrecognised RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "deadlock detected" },
    });
    const result = await queueCampaignSend(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
