import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Server Actions call `await (await getSupabase()).rpc(...)`. Mock a single rpc
// spy whose result each test sets. next-intl/server is mocked globally in setup.ts, so
// getTranslations resolves the real EN copy. The SEND is human-confirmed in the UI (a
// glass dialog); these actions are the thin command seam. No untrusted inbound ever
// reaches them (rail §7) and nothing is inventory-shaped — the island router.refresh()es.
const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => Promise.resolve({ rpc: rpcMock }),
}));

import {
  draftCampaignAction,
  markCampaignSentAction,
  queueCampaignSendAction,
  recordUnsubscribeAction,
} from "@/app/(app)/marketing/actions";

beforeEach(() => rpcMock.mockReset());
afterEach(() => vi.clearAllMocks());

const draftInput = () => ({
  name: "Lot launch — JC-901",
  triggerKind: "lot-launch" as const,
  greenLotCode: "JC-901",
  subject: "New release: {{lot_code}}",
  bodyTemplate: "Fresh from Janson, cup {{cup_score}}.",
  idempotencyKey: "idem-d1",
});

describe("draftCampaignAction — validation seam", () => {
  it("rejects an empty name WITHOUT touching the database", async () => {
    const r = await draftCampaignAction({ ...draftInput(), name: "  " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Give the campaign a name.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects an empty subject AND body WITHOUT touching the database", async () => {
    const r = await draftCampaignAction({ ...draftInput(), subject: "  ", bodyTemplate: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/subject or a message/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("draftCampaignAction — command behaviour", () => {
  it("passes the EXACT snake_case p_ envelope to draft_campaign", async () => {
    rpcMock.mockResolvedValue({ data: 5, error: null });
    const r = await draftCampaignAction(draftInput());
    expect(r).toEqual({ ok: true, campaignId: 5 });
    expect(rpcMock).toHaveBeenCalledWith("draft_campaign", {
      p_name: "Lot launch — JC-901",
      p_trigger_kind: "lot-launch",
      p_green_lot_code: "JC-901",
      p_subject: "New release: {{lot_code}}",
      p_body_template: "Fresh from Janson, cup {{cup_score}}.",
      p_idempotency_key: "idem-d1",
    });
  });

  it("forwards a null lot for a lot-less manual campaign", async () => {
    rpcMock.mockResolvedValue({ data: 6, error: null });
    await draftCampaignAction({
      ...draftInput(),
      triggerKind: "manual",
      greenLotCode: null,
    });
    expect(rpcMock).toHaveBeenCalledWith(
      "draft_campaign",
      expect.objectContaining({ p_green_lot_code: null, p_trigger_kind: "manual" }),
    );
  });
});

describe("queueCampaignSendAction — building the consent-gated draft queue", () => {
  it("rejects a non-positive campaign id WITHOUT touching the database", async () => {
    const r = await queueCampaignSendAction({ campaignId: 0, idempotencyKey: "k" });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns the queued count on the happy path", async () => {
    rpcMock.mockResolvedValue({ data: 14, error: null });
    const r = await queueCampaignSendAction({ campaignId: 2, idempotencyKey: "k-q" });
    expect(r).toEqual({ ok: true, queuedCount: 14 });
    expect(rpcMock).toHaveBeenCalledWith("queue_campaign_send", {
      p_campaign_id: 2,
      p_idempotency_key: "k-q",
    });
  });

  it("surfaces the author-written consent guard verbatim (a non-consenting contact can't be queued)", async () => {
    const guard =
      "marketing consent guard: contact 11 has not consented (or has unsubscribed) — cannot enqueue";
    rpcMock.mockResolvedValue({ data: null, error: { message: guard, code: "23514" } });
    const r = await queueCampaignSendAction({ campaignId: 2, idempotencyKey: "k" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(guard);
  });
});

describe("markCampaignSentAction — the human-confirmed send", () => {
  it("returns the sent count on the happy path", async () => {
    rpcMock.mockResolvedValue({ data: 14, error: null });
    const r = await markCampaignSentAction({ campaignId: 2, idempotencyKey: "k-s" });
    expect(r).toEqual({ ok: true, sentCount: 14 });
    expect(rpcMock).toHaveBeenCalledWith("mark_campaign_sent", {
      p_campaign_id: 2,
      p_idempotency_key: "k-s",
    });
  });
});

describe("recordUnsubscribeAction — the contact's own opt-out", () => {
  it("rejects a non-positive contact id WITHOUT touching the database", async () => {
    const r = await recordUnsubscribeAction({ contactId: 0, idempotencyKey: "k" });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("calls record_unsubscribe and returns ok (void RPC)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const r = await recordUnsubscribeAction({ contactId: 11, idempotencyKey: "k-u" });
    expect(r).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("record_unsubscribe", {
      p_contact_id: 11,
      p_idempotency_key: "k-u",
    });
  });
});
