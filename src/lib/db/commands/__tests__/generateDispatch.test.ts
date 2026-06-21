import { describe, expect, it, vi } from "vitest";

import {
  generateDispatch,
  validateGenerateDispatch,
  type GenerateDispatchStore,
} from "@/lib/db/commands/generateDispatch";

/**
 * Pure-domain command test for the morning-dispatch GENERATE write (P2-S5,
 * ADR-002 — every write flows through a SECURITY DEFINER command RPC). This file
 * does NOT touch a database: it drives the command against a *fake store* (a
 * hand-rolled stub of the one method the command calls,
 * `.rpc('generate_dispatch', …)`), so it can prove the friendly-validation seam
 * and the exactly-once contract SHAPE in the fast jsdom loop. The SQL CHECK/raise
 * is the *real* enforcement; this test pins the friendly errors the manager sees
 * before the round-trip and the exact snake_case argument envelope the RPC gets.
 *
 * Mirrors the Supabase-client mock idiom in
 * src/lib/db/commands/__tests__/enrollCrewMember.test.ts (a vi.fn() returning a
 * configured `{ data, error }` PostgREST-shaped result). The RPC returns a bigint
 * run id (number), not a uuid.
 */

/** Build a fake GenerateDispatchStore whose `.rpc()` resolves to a fixed result. */
function fakeStore(
  result: { data: number | null; error: { message: string } | null },
): { store: GenerateDispatchStore; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as GenerateDispatchStore, rpc };
}

/** A complete, valid raw dispatch request — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  crewId: "crew-norte",
  dispatchDate: "2026-06-20",
  season: "2026",
  readinessThreshold: "0.5",
  occurredAt: "2026-06-20T05:30:00.000Z",
  deviceId: "server",
  deviceSeq: "1",
  idempotencyKey: "disp-2026-06-20-crew-norte-001",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateGenerateDispatch", () => {
  it("accepts a complete, well-formed dispatch request", () => {
    const r = validateGenerateDispatch(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.crewId).toBe("crew-norte");
      expect(r.data.dispatchDate).toBe("2026-06-20");
      expect(r.data.season).toBe("2026");
      expect(r.data.readinessThreshold).toBe(0.5);
      expect(r.data.deviceSeq).toBe(1);
    }
  });

  it("rejects a missing crew with a friendly error", () => {
    const r = validateGenerateDispatch({ ...validRaw(), crewId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.crewId).toMatch(/crew/i);
  });

  it("rejects a non-ISO-date dispatchDate", () => {
    const r = validateGenerateDispatch({ ...validRaw(), dispatchDate: "not-a-date" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.dispatchDate).toBeDefined();
  });

  it("rejects a timestamp where a calendar date is required (dispatchDate)", () => {
    const r = validateGenerateDispatch({
      ...validRaw(),
      dispatchDate: "2026-06-20T05:30:00.000Z",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.dispatchDate).toBeDefined();
  });

  it("rejects a missing season", () => {
    const r = validateGenerateDispatch({ ...validRaw(), season: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.season).toBeDefined();
  });

  it("accepts the boundary readiness thresholds 0 and 1", () => {
    expect(validateGenerateDispatch({ ...validRaw(), readinessThreshold: "0" }).ok).toBe(true);
    expect(validateGenerateDispatch({ ...validRaw(), readinessThreshold: "1" }).ok).toBe(true);
  });

  it("rejects a readiness threshold outside [0,1]", () => {
    expect(validateGenerateDispatch({ ...validRaw(), readinessThreshold: "-0.1" }).ok).toBe(false);
    expect(validateGenerateDispatch({ ...validRaw(), readinessThreshold: "1.1" }).ok).toBe(false);
  });

  it("rejects a non-numeric readiness threshold", () => {
    const r = validateGenerateDispatch({ ...validRaw(), readinessThreshold: "ripe" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.readinessThreshold).toBeDefined();
  });

  it("rejects a non-ISO occurredAt timestamp", () => {
    const r = validateGenerateDispatch({ ...validRaw(), occurredAt: "not-a-date" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.occurredAt).toBeDefined();
  });

  it("rejects a missing device id", () => {
    const r = validateGenerateDispatch({ ...validRaw(), deviceId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.deviceId).toBeDefined();
  });

  it("rejects a negative / non-integer device sequence", () => {
    expect(validateGenerateDispatch({ ...validRaw(), deviceSeq: "-1" }).ok).toBe(false);
    expect(validateGenerateDispatch({ ...validRaw(), deviceSeq: "1.5" }).ok).toBe(false);
  });

  it("rejects a blank idempotency key (the exactly-once anchor)", () => {
    const r = validateGenerateDispatch({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });

  it("collects multiple field errors at once", () => {
    const r = validateGenerateDispatch({ ...validRaw(), crewId: "", season: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(["crewId", "season"]);
    }
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("generateDispatch", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });

    const result = await generateDispatch(store, { ...validRaw(), crewId: "" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.crewId).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls generate_dispatch EXACTLY ONCE with the snake_case arg envelope", async () => {
    const { store, rpc } = fakeStore({ data: 42, error: null });

    const result = await generateDispatch(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("generate_dispatch", {
      p_crew_id: "crew-norte",
      p_dispatch_date: "2026-06-20",
      p_season: "2026",
      p_readiness_threshold: 0.5,
      p_occurred_at: "2026-06-20T05:30:00.000Z",
      p_device_id: "server",
      p_device_seq: 1,
      p_idempotency_key: "disp-2026-06-20-crew-norte-001",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.runId).toBe(42);
  });

  it("surfaces a labelled error when the RPC fails", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "unknown crew crew-norte" },
    });

    const result = await generateDispatch(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("generate_dispatch");
      expect(result.message).toContain("unknown crew");
    }
  });

  it("surfaces a labelled error when the RPC returns no run id", async () => {
    const { store } = fakeStore({ data: null, error: null });

    const result = await generateDispatch(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("generate_dispatch");
  });

  it("is exactly-once by key: a replay forwards the identical idempotencyKey", async () => {
    const { store, rpc } = fakeStore({ data: 42, error: null });
    const raw = validRaw();

    const first = await generateDispatch(store, raw);
    const second = await generateDispatch(store, raw);

    expect(first.ok && second.ok).toBe(true);
    const firstArgs = rpc.mock.calls[0][1] as Record<string, unknown>;
    const secondArgs = rpc.mock.calls[1][1] as Record<string, unknown>;
    expect(firstArgs.p_idempotency_key).toBe(secondArgs.p_idempotency_key);
  });
});
