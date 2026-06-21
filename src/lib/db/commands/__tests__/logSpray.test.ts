import { describe, expect, it, vi } from "vitest";

import {
  logSpray,
  type SprayStore,
  validateSpray,
} from "@/lib/db/commands/logSpray";

/**
 * Pure-domain command test for the cert/PHI-safe spray log (ADR-002 — every write
 * flows through a SECURITY DEFINER command RPC). Drives `logSpray` against a fake
 * store stubbing `.rpc('log_spray', …)`. The REAL cert + PHI/REI enforcement lives
 * in the SQL (proved in the db test); here we prove the friendly-validation seam,
 * the snake_case envelope, the exactly-once shape, AND that a DB-side cert refusal
 * surfaces as a clear, labelled error the UI can show the user.
 */

function fakeStore(
  result: { data: number | null; error: { message: string } | null },
): { store: SprayStore; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as SprayStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  plotId: "p-talamanca",
  product: "Verdadero 600",
  activeIngredient: "imidacloprid",
  phiDays: 14,
  reiHours: 24,
  appliedAt: "2026-06-20T08:00:00Z",
  workerId: "w-agro",
  idempotencyKey: "spray-2026-06-20-001",
});

describe("validateSpray", () => {
  it("accepts a complete, well-formed spray", () => {
    const r = validateSpray(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.product).toBe("Verdadero 600");
      expect(r.data.phiDays).toBe(14);
      expect(r.data.reiHours).toBe(24);
    }
  });

  it("rejects a missing plot", () => {
    const r = validateSpray({ ...validRaw(), plotId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.plotId).toMatch(/plot/i);
  });

  it("rejects a missing product", () => {
    const r = validateSpray({ ...validRaw(), product: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.product).toBeDefined();
  });

  it("rejects a missing applicator (the cert-gated worker)", () => {
    const r = validateSpray({ ...validRaw(), workerId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.workerId).toMatch(/worker|applicator/i);
  });

  it("rejects a negative PHI or REI (intervals cannot be negative)", () => {
    expect(validateSpray({ ...validRaw(), phiDays: -1 }).ok).toBe(false);
    expect(validateSpray({ ...validRaw(), reiHours: -5 }).ok).toBe(false);
  });

  it("defaults absent PHI/REI to 0 (a no-interval product is valid)", () => {
    const raw = validRaw();
    delete raw.phiDays;
    delete raw.reiHours;
    const r = validateSpray(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.phiDays).toBe(0);
      expect(r.data.reiHours).toBe(0);
    }
  });

  it("rejects a non-ISO appliedAt", () => {
    const r = validateSpray({ ...validRaw(), appliedAt: "nope" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.appliedAt).toBeDefined();
  });

  it("rejects a blank idempotency key", () => {
    const r = validateSpray({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

describe("logSpray", () => {
  it("does NOT call the RPC on invalid input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const r = await logSpray(store, { ...validRaw(), workerId: "" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls log_spray EXACTLY ONCE with the snake_case envelope", async () => {
    const { store, rpc } = fakeStore({ data: 7, error: null });
    const r = await logSpray(store, validRaw());
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("log_spray", {
      p_plot_id: "p-talamanca",
      p_product: "Verdadero 600",
      p_active_ingredient: "imidacloprid",
      p_phi_days: 14,
      p_rei_hours: 24,
      p_applied_at: "2026-06-20T08:00:00Z",
      p_worker_id: "w-agro",
      p_idempotency_key: "spray-2026-06-20-001",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sprayId).toBe(7);
  });

  it("surfaces the DB cert-gate refusal as a clear labelled error (the keystone UX)", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "spray gate: worker w-06 lacks a valid pesticide-handling certification — application blocked" },
    });
    const r = await logSpray(store, validRaw());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/spray gate|certification/i);
    }
  });

  it("is exactly-once by key: a replay forwards the identical idempotencyKey", async () => {
    const { store, rpc } = fakeStore({ data: 7, error: null });
    await logSpray(store, validRaw());
    await logSpray(store, validRaw());
    const a = rpc.mock.calls[0][1] as Record<string, unknown>;
    const b = rpc.mock.calls[1][1] as Record<string, unknown>;
    expect(a.p_idempotency_key).toBe(b.p_idempotency_key);
  });
});
