import { describe, expect, it, vi } from "vitest";

import {
  rehireWorker,
  validateRehire,
  type RehireStore,
} from "@/lib/db/commands/rehireWorker";

/**
 * Pure-domain command test for the worker-rehire write (ADR-002 — every write
 * flows through a SECURITY DEFINER command RPC). Drives the command against a
 * *fake store* (a stub of `.rpc('rehire_worker', …)`), proving the
 * friendly-validation seam and the exactly-once contract SHAPE. The RPC returns
 * a uuid → eventUid.
 */

/** Build a fake RehireStore whose `.rpc()` resolves to a fixed result. */
function fakeStore(
  result: { data: string | null; error: { message: string } | null },
): { store: RehireStore; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as RehireStore, rpc };
}

/** A complete, valid raw rehire — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  workerId: "w-lucia",
  crewId: "crew-pickers-a",
  season: "2026-2027",
  occurredAt: "2026-06-20T14:03:00.000Z",
  deviceId: "server",
  deviceSeq: "1",
  idempotencyKey: "rehire-2026-06-20-w-lucia-001",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateRehire", () => {
  it("accepts a complete, well-formed rehire", () => {
    const r = validateRehire(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.workerId).toBe("w-lucia");
      expect(r.data.crewId).toBe("crew-pickers-a");
      expect(r.data.season).toBe("2026-2027");
      expect(r.data.deviceSeq).toBe(1);
    }
  });

  it("rejects a missing worker with a friendly error", () => {
    const r = validateRehire({ ...validRaw(), workerId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.workerId).toMatch(/worker/i);
  });

  it("rejects a missing crew with a friendly error", () => {
    const r = validateRehire({ ...validRaw(), crewId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.crewId).toMatch(/crew/i);
  });

  it("rejects a missing season with a friendly error", () => {
    const r = validateRehire({ ...validRaw(), season: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.season).toMatch(/season/i);
  });

  it("rejects a non-ISO occurredAt timestamp", () => {
    const r = validateRehire({ ...validRaw(), occurredAt: "not-a-date" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.occurredAt).toBeDefined();
  });

  it("rejects a missing device id", () => {
    const r = validateRehire({ ...validRaw(), deviceId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.deviceId).toBeDefined();
  });

  it("rejects a negative / non-integer device sequence", () => {
    expect(validateRehire({ ...validRaw(), deviceSeq: "-1" }).ok).toBe(false);
    expect(validateRehire({ ...validRaw(), deviceSeq: "1.5" }).ok).toBe(false);
  });

  it("rejects a blank idempotency key (the exactly-once anchor)", () => {
    const r = validateRehire({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });

  it("collects multiple field errors at once", () => {
    const r = validateRehire({ ...validRaw(), crewId: "", season: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(["crewId", "season"]);
    }
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("rehireWorker", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });

    const result = await rehireWorker(store, { ...validRaw(), season: "" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.season).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls rehire_worker EXACTLY ONCE with the snake_case arg envelope", async () => {
    const { store, rpc } = fakeStore({ data: "evt-uuid-789", error: null });

    const result = await rehireWorker(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("rehire_worker", {
      p_worker_id: "w-lucia",
      p_crew_id: "crew-pickers-a",
      p_season: "2026-2027",
      p_occurred_at: "2026-06-20T14:03:00.000Z",
      p_device_id: "server",
      p_device_seq: 1,
      p_idempotency_key: "rehire-2026-06-20-w-lucia-001",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.eventUid).toBe("evt-uuid-789");
  });

  it("surfaces a labelled error when the RPC fails", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "duplicate key value violates unique constraint" },
    });

    const result = await rehireWorker(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("rehire_worker");
      expect(result.message).toContain("duplicate key");
    }
  });

  it("is exactly-once by key: a replay forwards the identical idempotencyKey", async () => {
    const { store, rpc } = fakeStore({ data: "evt-uuid-789", error: null });
    const raw = validRaw();

    const first = await rehireWorker(store, raw);
    const second = await rehireWorker(store, raw);

    expect(first.ok && second.ok).toBe(true);
    const firstArgs = rpc.mock.calls[0][1] as Record<string, unknown>;
    const secondArgs = rpc.mock.calls[1][1] as Record<string, unknown>;
    expect(firstArgs.p_idempotency_key).toBe(secondArgs.p_idempotency_key);
  });
});
