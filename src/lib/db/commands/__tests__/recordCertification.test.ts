import { describe, expect, it, vi } from "vitest";

import {
  recordCertification,
  validateCertification,
  type CertificationStore,
} from "@/lib/db/commands/recordCertification";

/**
 * Pure-domain command test for the worker-certification write (ADR-002 — every
 * write flows through a SECURITY DEFINER command RPC). Drives the command against
 * a *fake store* (a stub of `.rpc('record_certification', …)`), proving the
 * friendly-validation seam (including the cross-field issued/expires rule) and
 * the exactly-once contract SHAPE. The RPC returns a bigint → certId.
 */

/** Build a fake CertificationStore whose `.rpc()` resolves to a fixed result. */
function fakeStore(
  result: { data: number | null; error: { message: string } | null },
): { store: CertificationStore; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as CertificationStore, rpc };
}

/** A complete, valid raw certification — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  workerId: "w-lucia",
  certKind: "pesticide-handling",
  issuedAt: "2026-01-15",
  expiresAt: "2027-01-15",
  issuer: "MIDA Panamá",
  docRef: "doc-xyz-789",
  idempotencyKey: "cert-2026-06-20-w-lucia-001",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateCertification", () => {
  it("accepts a complete, well-formed certification", () => {
    const r = validateCertification(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.certKind).toBe("pesticide-handling");
      expect(r.data.issuedAt).toBe("2026-01-15");
      expect(r.data.expiresAt).toBe("2027-01-15");
      expect(r.data.issuer).toBe("MIDA Panamá");
      expect(r.data.docRef).toBe("doc-xyz-789");
    }
  });

  it("accepts a certification with no expiry, issuer or docRef (all optional)", () => {
    const raw = validRaw();
    delete raw.expiresAt;
    delete raw.issuer;
    delete raw.docRef;
    const r = validateCertification(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.expiresAt).toBeNull();
      expect(r.data.issuer).toBeNull();
      expect(r.data.docRef).toBeNull();
    }
  });

  it("rejects a missing worker", () => {
    const r = validateCertification({ ...validRaw(), workerId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.workerId).toMatch(/worker/i);
  });

  it("rejects a missing cert kind", () => {
    const r = validateCertification({ ...validRaw(), certKind: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.certKind).toBeDefined();
  });

  it("rejects a missing / non-ISO issuedAt", () => {
    expect(validateCertification({ ...validRaw(), issuedAt: "" }).ok).toBe(false);
    expect(validateCertification({ ...validRaw(), issuedAt: "nope" }).ok).toBe(false);
  });

  it("rejects an expiresAt earlier than issuedAt (cross-field rule)", () => {
    const r = validateCertification({
      ...validRaw(),
      issuedAt: "2026-01-15",
      expiresAt: "2025-01-15",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.expiresAt).toMatch(/on or after|after|before|issue/i);
  });

  it("accepts expiresAt equal to issuedAt (>= boundary)", () => {
    const r = validateCertification({
      ...validRaw(),
      issuedAt: "2026-01-15",
      expiresAt: "2026-01-15",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a present-but-non-ISO expiresAt", () => {
    const r = validateCertification({ ...validRaw(), expiresAt: "not-a-date" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.expiresAt).toBeDefined();
  });

  it("rejects a blank idempotency key (the exactly-once anchor)", () => {
    const r = validateCertification({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("recordCertification", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });

    const result = await recordCertification(store, { ...validRaw(), certKind: "" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.certKind).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_certification EXACTLY ONCE with the snake_case arg envelope", async () => {
    const { store, rpc } = fakeStore({ data: 99, error: null });

    const result = await recordCertification(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_certification", {
      p_worker_id: "w-lucia",
      p_cert_kind: "pesticide-handling",
      p_issued_at: "2026-01-15",
      p_expires_at: "2027-01-15",
      p_issuer: "MIDA Panamá",
      p_doc_ref: "doc-xyz-789",
      p_idempotency_key: "cert-2026-06-20-w-lucia-001",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.certId).toBe(99);
  });

  it("forwards p_expires_at, p_issuer and p_doc_ref as null when omitted", async () => {
    const { store, rpc } = fakeStore({ data: 99, error: null });
    const raw = validRaw();
    delete raw.expiresAt;
    delete raw.issuer;
    delete raw.docRef;

    await recordCertification(store, raw);

    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_expires_at).toBeNull();
    expect(args.p_issuer).toBeNull();
    expect(args.p_doc_ref).toBeNull();
  });

  it("surfaces a labelled error when the RPC fails", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "check constraint violated" },
    });

    const result = await recordCertification(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("record_certification");
      expect(result.message).toContain("check constraint");
    }
  });

  it("is exactly-once by key: a replay forwards the identical idempotencyKey", async () => {
    const { store, rpc } = fakeStore({ data: 99, error: null });
    const raw = validRaw();

    const first = await recordCertification(store, raw);
    const second = await recordCertification(store, raw);

    expect(first.ok && second.ok).toBe(true);
    const firstArgs = rpc.mock.calls[0][1] as Record<string, unknown>;
    const secondArgs = rpc.mock.calls[1][1] as Record<string, unknown>;
    expect(firstArgs.p_idempotency_key).toBe(secondArgs.p_idempotency_key);
  });
});
