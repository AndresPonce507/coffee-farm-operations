import { describe, expect, it, vi } from "vitest";

import {
  draftCampaign,
  validateDraftCampaign,
  type DraftCampaignStore,
} from "@/lib/db/commands/draftCampaign";

/**
 * Pure-domain command test for the manual campaign drafter (P3-S20 — the composer's
 * Save; ADR-002). Drafting only creates a 'draft' campaign — NObody is targeted and
 * NO consent gate runs at draft time (the gate fires later, at queue time). Drives
 * the command against a fake `.rpc('draft_campaign', …)` store and proves: (a) the
 * friendly-validation seam (name + idempotency required; the trigger enum default
 * 'manual'; an OPTIONAL lot), (b) the exact snake_case envelope (a blank lot passes
 * null — a lot-less manual campaign is legal), and (c) the unknown-lot rejection
 * surfaces a clean message. The tenant clamp + idempotency are the RPC's job.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: DraftCampaignStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as DraftCampaignStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  name: "Spring newsletter",
  triggerKind: "manual",
  greenLotCode: "JC-701",
  subject: "New release: {{lot_code}}",
  bodyTemplate: "Fresh from Janson — cup {{cup_score}}, {{sca_grade}}.",
  idempotencyKey: "idem-camp-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateDraftCampaign", () => {
  it("accepts a complete, well-formed campaign draft", () => {
    const r = validateDraftCampaign(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.name).toBe("Spring newsletter");
      expect(r.data.triggerKind).toBe("manual");
      expect(r.data.greenLotCode).toBe("JC-701");
      expect(r.data.subject).toBe("New release: {{lot_code}}");
      expect(r.data.idempotencyKey).toBe("idem-camp-1");
    }
  });

  it("defaults a blank trigger kind to 'manual'", () => {
    const r = validateDraftCampaign({ ...validRaw(), triggerKind: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.triggerKind).toBe("manual");
  });

  it("accepts every campaign_trigger enum value", () => {
    for (const k of ["lot-launch", "replenishment", "sample-follow-up", "manual"]) {
      const r = validateDraftCampaign({ ...validRaw(), triggerKind: k });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.triggerKind).toBe(k);
    }
  });

  it("rejects an unknown trigger kind", () => {
    const r = validateDraftCampaign({ ...validRaw(), triggerKind: "blast" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.triggerKind).toBeDefined();
  });

  it("treats a blank lot / subject / body as null (a lot-less manual campaign is legal)", () => {
    const r = validateDraftCampaign({
      name: "Spring newsletter",
      triggerKind: "manual",
      greenLotCode: "",
      subject: "",
      bodyTemplate: "",
      idempotencyKey: "idem-camp-1",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.greenLotCode).toBeNull();
      expect(r.data.subject).toBeNull();
      expect(r.data.bodyTemplate).toBeNull();
    }
  });

  it("rejects a missing name", () => {
    const r = validateDraftCampaign({ ...validRaw(), name: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.name).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateDraftCampaign({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("draftCampaign", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await draftCampaign(store, { ...validRaw(), name: "" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls draft_campaign with the exact snake_case envelope and returns the id", async () => {
    const { store, rpc } = fakeStore({ data: 8, error: null });
    const result = await draftCampaign(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("draft_campaign", {
      p_name: "Spring newsletter",
      p_trigger_kind: "manual",
      p_green_lot_code: "JC-701",
      p_subject: "New release: {{lot_code}}",
      p_body_template: "Fresh from Janson — cup {{cup_score}}, {{sca_grade}}.",
      p_idempotency_key: "idem-camp-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.campaignId).toBe(8);
  });

  it("forwards a null lot when blank (a lot-less manual campaign)", async () => {
    const { store, rpc } = fakeStore({ data: 9, error: null });
    await draftCampaign(store, {
      name: "Spring newsletter",
      idempotencyKey: "idem-camp-1",
    });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_green_lot_code).toBeNull();
    expect(args.p_trigger_kind).toBe("manual");
  });

  it("surfaces an unknown lot as a friendly not-found message", async () => {
    const { store } = fakeStore({
      data: null,
      error: { code: "23503", message: "unknown green lot JC-999 for tenant" },
    });
    const result = await draftCampaign(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/lot|found/i);
  });

  it("falls back to a labelled message for an unrecognised RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "deadlock detected" },
    });
    const result = await draftCampaign(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
