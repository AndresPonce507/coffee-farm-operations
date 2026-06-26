import { describe, expect, it, vi } from "vitest";

import {
  upsertContact,
  validateUpsertContact,
  type UpsertContactStore,
} from "@/lib/db/commands/upsertContact";

/**
 * Pure-domain command test for the ONLY contacts writer (P3-S18 — direct-trade
 * CRM; ADR-002 — every write flows through a SECURITY DEFINER RPC). `upsert_contact`
 * creates (contactId null) or updates the mutable CRM anchor. The load-bearing
 * lawful-basis rule is mirrored client-side so it surfaces BEFORE the round-trip:
 * marketing consent=true REQUIRES a consent_source (the DB CHECK + the RPC raise are
 * the real enforcement). Drives the command against a fake
 * `.rpc('upsert_contact', …)` store and proves the validation seam + the exact
 * snake_case argument envelope (incl. the null contact_id on create, the null
 * status default, the null buyer_id).
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: UpsertContactStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as UpsertContactStore, rpc };
}

/** A complete, valid CREATE (no contactId) — the happy-path baseline. */
const validRaw = (): Record<string, unknown> => ({
  name: "Onyx Coffee Lab",
  kind: "roaster",
  status: "active",
  countryCode: "US",
  email: "buyer@onyx.example",
  phone: "+1-555-0100",
  buyerId: "3",
  consentMarketing: false,
  consentSource: "",
  idempotencyKey: "idem-contact-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateUpsertContact", () => {
  it("accepts a complete, well-formed create (null contact id + buyer coercion)", () => {
    const r = validateUpsertContact(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.contactId).toBeNull();
      expect(r.data.name).toBe("Onyx Coffee Lab");
      expect(r.data.kind).toBe("roaster");
      expect(r.data.status).toBe("active");
      expect(r.data.buyerId).toBe(3);
      expect(r.data.consentMarketing).toBe(false);
      expect(r.data.idempotencyKey).toBe("idem-contact-1");
    }
  });

  it("carries a provided contact id (the update path)", () => {
    const r = validateUpsertContact({ ...validRaw(), contactId: "7" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.contactId).toBe(7);
  });

  it("defaults a blank status to null (the RPC coalesces to 'lead' on create)", () => {
    const r = validateUpsertContact({ ...validRaw(), status: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.status).toBeNull();
  });

  it("defaults a blank buyer id to null (no b2b master bound yet)", () => {
    const r = validateUpsertContact({ ...validRaw(), buyerId: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.buyerId).toBeNull();
  });

  it("rejects a missing name", () => {
    const r = validateUpsertContact({ ...validRaw(), name: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.name).toMatch(/name/i);
  });

  it("rejects an unknown contact kind", () => {
    const r = validateUpsertContact({ ...validRaw(), kind: "wholesaler" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.kind).toBeDefined();
  });

  it("accepts every contact_kind enum value", () => {
    for (const k of [
      "roaster",
      "importer",
      "agent",
      "distributor",
      "retailer",
      "press",
      "individual",
      "other",
    ]) {
      const r = validateUpsertContact({ ...validRaw(), kind: k });
      expect(r.ok).toBe(true);
    }
  });

  it("rejects an unknown status enum value", () => {
    const r = validateUpsertContact({ ...validRaw(), status: "vip" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.status).toBeDefined();
  });

  it("REQUIRES a consent_source when marketing consent is true (lawful basis)", () => {
    const r = validateUpsertContact({
      ...validRaw(),
      consentMarketing: true,
      consentSource: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.consentSource).toMatch(/source/i);
  });

  it("accepts marketing consent when a source is named", () => {
    const r = validateUpsertContact({
      ...validRaw(),
      consentMarketing: true,
      consentSource: "trade-show-2026",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.consentMarketing).toBe(true);
      expect(r.data.consentSource).toBe("trade-show-2026");
    }
  });

  it("coerces a checkbox-style 'on'/'true' consent to a boolean", () => {
    const on = validateUpsertContact({
      ...validRaw(),
      consentMarketing: "on",
      consentSource: "newsletter",
    });
    expect(on.ok).toBe(true);
    if (on.ok) expect(on.data.consentMarketing).toBe(true);
  });

  it("rejects a missing idempotency key", () => {
    const r = validateUpsertContact({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("upsertContact", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await upsertContact(store, { ...validRaw(), name: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.name).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls upsert_contact with the exact snake_case envelope and returns the contact id", async () => {
    const { store, rpc } = fakeStore({ data: 7, error: null });
    const result = await upsertContact(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("upsert_contact", {
      p_contact_id: null,
      p_name: "Onyx Coffee Lab",
      p_kind: "roaster",
      p_status: "active",
      p_country_code: "US",
      p_email: "buyer@onyx.example",
      p_phone: "+1-555-0100",
      p_buyer_id: 3,
      p_consent_marketing: false,
      p_consent_source: null,
      p_idempotency_key: "idem-contact-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.contactId).toBe(7);
  });

  it("forwards the contact id on the update path", async () => {
    const { store, rpc } = fakeStore({ data: 7, error: null });
    await upsertContact(store, { ...validRaw(), contactId: "7" });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_contact_id).toBe(7);
  });

  it("forwards the consent_source when consent is granted", async () => {
    const { store, rpc } = fakeStore({ data: 8, error: null });
    await upsertContact(store, {
      ...validRaw(),
      consentMarketing: true,
      consentSource: "trade-show-2026",
    });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_consent_marketing).toBe(true);
    expect(args.p_consent_source).toBe("trade-show-2026");
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "9", error: null });
    const result = await upsertContact(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.contactId).toBe(9);
  });

  it("surfaces a labelled error (never raw PG) when the RPC fails", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "marketing consent requires a consent_source" },
    });
    const result = await upsertContact(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBeTruthy();
      expect(result.message).toContain("consent_source");
    }
  });
});
