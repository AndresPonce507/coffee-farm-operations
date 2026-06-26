import { describe, expect, it, vi } from "vitest";

import {
  markCampaignSent,
  validateMarkCampaignSent,
  type MarkCampaignSentStore,
} from "@/lib/db/commands/markCampaignSent";

/**
 * Pure-domain command test for the HUMAN-CONFIRMED send (P3-S20 — the only place a
 * send happens; ADR-002 + the no-untrusted-inbound rail). mark_campaign_sent flips
 * the queued outbound rows → 'sent', flips the campaign → 'sent', and appends a
 * hash-chained 'campaign_sent' lot_event. NO AI and no untrusted inbound ever reach
 * it — a human clicks the button (this command is invoked behind that click). It
 * returns the COUNT of rows marked sent. Drives the command against a fake
 * `.rpc('mark_campaign_sent', …)` store and proves the validation seam, the exact
 * snake_case envelope, the count passthrough, and a clean unknown-campaign message.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: MarkCampaignSentStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as MarkCampaignSentStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  campaignId: "7",
  idempotencyKey: "idem-sent-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateMarkCampaignSent", () => {
  it("accepts a complete, well-formed send request", () => {
    const r = validateMarkCampaignSent(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.campaignId).toBe(7);
      expect(r.data.idempotencyKey).toBe("idem-sent-1");
    }
  });

  it("also accepts the campaign id under `id`", () => {
    const r = validateMarkCampaignSent({ id: "9", idempotencyKey: "k" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.campaignId).toBe(9);
  });

  it("rejects a missing / non-numeric campaign id", () => {
    expect(validateMarkCampaignSent({ ...validRaw(), campaignId: "" }).ok).toBe(false);
    expect(validateMarkCampaignSent({ ...validRaw(), campaignId: "abc" }).ok).toBe(false);
  });

  it("rejects a non-positive / non-integer campaign id", () => {
    expect(validateMarkCampaignSent({ ...validRaw(), campaignId: "0" }).ok).toBe(false);
    expect(validateMarkCampaignSent({ ...validRaw(), campaignId: "2.5" }).ok).toBe(false);
  });

  it("rejects a missing idempotency key", () => {
    const r = validateMarkCampaignSent({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("markCampaignSent", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await markCampaignSent(store, { ...validRaw(), campaignId: "" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls mark_campaign_sent with the exact snake_case envelope and returns the sent count", async () => {
    const { store, rpc } = fakeStore({ data: 14, error: null });
    const result = await markCampaignSent(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("mark_campaign_sent", {
      p_campaign_id: 7,
      p_idempotency_key: "idem-sent-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sentCount).toBe(14);
  });

  it("treats a 0 count (nothing queued / idempotent replay) as success", async () => {
    const { store } = fakeStore({ data: 0, error: null });
    const result = await markCampaignSent(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sentCount).toBe(0);
  });

  it("surfaces an unknown campaign as a friendly not-found message", async () => {
    const { store } = fakeStore({
      data: null,
      error: { code: "23503", message: "unknown campaign 999 for tenant" },
    });
    const result = await markCampaignSent(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/campaign|found/i);
  });

  it("falls back to a labelled message for an unrecognised RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "deadlock detected" },
    });
    const result = await markCampaignSent(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
