import { describe, expect, it, vi } from "vitest";

import {
  signPorObra,
  validatePorObra,
  type PorObraStore,
} from "@/lib/db/commands/signPorObra";

/**
 * Pure-domain command test for the por-obra (piece-rate) contract write (ADR-002
 * — every write flows through a SECURITY DEFINER command RPC). Drives the command
 * against a *fake store* (a stub of `.rpc('sign_por_obra_contract', …)`), proving
 * the friendly-validation seam (including the cross-field effective-range rule)
 * and the exactly-once contract SHAPE. The RPC returns a bigint → contractId.
 */

/** Build a fake PorObraStore whose `.rpc()` resolves to a fixed result. */
function fakeStore(
  result: { data: number | null; error: { message: string } | null },
): { store: PorObraStore; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as PorObraStore, rpc };
}

/** A complete, valid raw contract — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  workerId: "w-lucia",
  taskKind: "harvest-pick",
  rateBasis: "per-lata",
  rateUsd: "3.50",
  effectiveFrom: "2026-06-20",
  effectiveTo: "2026-12-31",
  signatureRef: "sig-abc-123",
  idempotencyKey: "porobra-2026-06-20-w-lucia-001",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validatePorObra", () => {
  it("accepts a complete, well-formed contract", () => {
    const r = validatePorObra(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.rateBasis).toBe("per-lata");
      expect(r.data.rateUsd).toBe(3.5);
      expect(r.data.effectiveFrom).toBe("2026-06-20");
      expect(r.data.effectiveTo).toBe("2026-12-31");
      expect(r.data.signatureRef).toBe("sig-abc-123");
    }
  });

  it("accepts a contract with no effectiveTo (open-ended) and no signatureRef", () => {
    const raw = validRaw();
    delete raw.effectiveTo;
    delete raw.signatureRef;
    const r = validatePorObra(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.effectiveTo).toBeNull();
      expect(r.data.signatureRef).toBeNull();
    }
  });

  it("rejects a missing worker", () => {
    const r = validatePorObra({ ...validRaw(), workerId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.workerId).toMatch(/worker/i);
  });

  it("rejects a missing task kind", () => {
    const r = validatePorObra({ ...validRaw(), taskKind: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.taskKind).toBeDefined();
  });

  it("rejects an unknown rate basis", () => {
    const r = validatePorObra({ ...validRaw(), rateBasis: "per-hour" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.rateBasis).toBeDefined();
  });

  it("accepts every recognised rate basis", () => {
    for (const basis of ["per-lata", "per-kg", "per-tarea", "per-tree"]) {
      const r = validatePorObra({ ...validRaw(), rateBasis: basis });
      expect(r.ok).toBe(true);
    }
  });

  it("rejects a negative rate", () => {
    const r = validatePorObra({ ...validRaw(), rateUsd: "-1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.rateUsd).toBeDefined();
  });

  it("accepts a zero rate (>= 0)", () => {
    const r = validatePorObra({ ...validRaw(), rateUsd: "0" });
    expect(r.ok).toBe(true);
  });

  it("rejects a non-numeric rate", () => {
    const r = validatePorObra({ ...validRaw(), rateUsd: "free" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.rateUsd).toBeDefined();
  });

  it("rejects a missing / non-ISO effectiveFrom", () => {
    expect(validatePorObra({ ...validRaw(), effectiveFrom: "" }).ok).toBe(false);
    expect(validatePorObra({ ...validRaw(), effectiveFrom: "nope" }).ok).toBe(false);
  });

  it("rejects an effectiveTo earlier than effectiveFrom (cross-field rule)", () => {
    const r = validatePorObra({
      ...validRaw(),
      effectiveFrom: "2026-06-20",
      effectiveTo: "2026-06-01",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.effectiveTo).toMatch(/on or after|after|before|range/i);
  });

  it("accepts effectiveTo equal to effectiveFrom (>= boundary)", () => {
    const r = validatePorObra({
      ...validRaw(),
      effectiveFrom: "2026-06-20",
      effectiveTo: "2026-06-20",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a present-but-non-ISO effectiveTo", () => {
    const r = validatePorObra({ ...validRaw(), effectiveTo: "not-a-date" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.effectiveTo).toBeDefined();
  });

  it("rejects a blank idempotency key (the exactly-once anchor)", () => {
    const r = validatePorObra({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("signPorObra", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });

    const result = await signPorObra(store, { ...validRaw(), taskKind: "" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.taskKind).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls sign_por_obra_contract EXACTLY ONCE with the snake_case arg envelope", async () => {
    const { store, rpc } = fakeStore({ data: 42, error: null });

    const result = await signPorObra(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("sign_por_obra_contract", {
      p_worker_id: "w-lucia",
      p_task_kind: "harvest-pick",
      p_rate_basis: "per-lata",
      p_rate_usd: 3.5,
      p_effective_from: "2026-06-20",
      p_effective_to: "2026-12-31",
      p_signature_ref: "sig-abc-123",
      p_idempotency_key: "porobra-2026-06-20-w-lucia-001",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.contractId).toBe(42);
  });

  it("forwards p_effective_to and p_signature_ref as null when omitted", async () => {
    const { store, rpc } = fakeStore({ data: 42, error: null });
    const raw = validRaw();
    delete raw.effectiveTo;
    delete raw.signatureRef;

    await signPorObra(store, raw);

    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_effective_to).toBeNull();
    expect(args.p_signature_ref).toBeNull();
  });

  it("surfaces a labelled error when the RPC fails", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "check constraint violated" },
    });

    const result = await signPorObra(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("sign_por_obra_contract");
      expect(result.message).toContain("check constraint");
    }
  });

  it("is exactly-once by key: a replay forwards the identical idempotencyKey", async () => {
    const { store, rpc } = fakeStore({ data: 42, error: null });
    const raw = validRaw();

    const first = await signPorObra(store, raw);
    const second = await signPorObra(store, raw);

    expect(first.ok && second.ok).toBe(true);
    const firstArgs = rpc.mock.calls[0][1] as Record<string, unknown>;
    const secondArgs = rpc.mock.calls[1][1] as Record<string, unknown>;
    expect(firstArgs.p_idempotency_key).toBe(secondArgs.p_idempotency_key);
  });
});
