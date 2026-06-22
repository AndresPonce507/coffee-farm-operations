import { describe, expect, it, vi } from "vitest";

import {
  recordScouting,
  type ScoutingStore,
  validateScouting,
} from "@/lib/db/commands/recordScouting";

/**
 * Pure-domain command test for the IPM scouting write (ADR-002). The economic-
 * threshold evaluation + task-firing happen in the SQL (proved in the db test);
 * here we prove the friendly-validation seam, the snake_case envelope, and the
 * exactly-once shape against a fake store.
 */

function fakeStore(
  result: { data: number | null; error: { message: string } | null },
): { store: ScoutingStore; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as ScoutingStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  plotId: "p-cuesta-piedra",
  pestKind: "broca",
  incidencePct: 8,
  notes: "borings on the south rows",
  workerId: "w-agro",
  occurredAt: "2026-06-21T09:00:00Z",
  deviceId: "server",
  deviceSeq: 11,
  idempotencyKey: "scout-001",
});

describe("validateScouting", () => {
  it("accepts a complete observation", () => {
    const r = validateScouting(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.pestKind).toBe("broca");
      expect(r.data.incidencePct).toBe(8);
    }
  });

  it("rejects a missing plot or pest", () => {
    expect(validateScouting({ ...validRaw(), plotId: "" }).ok).toBe(false);
    expect(validateScouting({ ...validRaw(), pestKind: "" }).ok).toBe(false);
  });

  it("rejects an incidence outside [0,100]", () => {
    expect(validateScouting({ ...validRaw(), incidencePct: -1 }).ok).toBe(false);
    expect(validateScouting({ ...validRaw(), incidencePct: 101 }).ok).toBe(false);
  });

  it("treats notes and worker as optional (a quick scout may omit them)", () => {
    const raw = validRaw();
    delete raw.notes;
    delete raw.workerId;
    const r = validateScouting(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.notes).toBeNull();
      expect(r.data.workerId).toBeNull();
    }
  });

  it("rejects a blank device id (offline-replay identity is required)", () => {
    expect(validateScouting({ ...validRaw(), deviceId: "" }).ok).toBe(false);
  });

  it("rejects a non-integer/negative device seq", () => {
    expect(validateScouting({ ...validRaw(), deviceSeq: -1 }).ok).toBe(false);
    expect(validateScouting({ ...validRaw(), deviceSeq: 2.5 }).ok).toBe(false);
  });

  it("rejects a blank idempotency key", () => {
    expect(validateScouting({ ...validRaw(), idempotencyKey: "" }).ok).toBe(false);
  });
});

describe("recordScouting", () => {
  it("does NOT call the RPC on invalid input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const r = await recordScouting(store, { ...validRaw(), pestKind: "" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_scouting EXACTLY ONCE with the snake_case envelope", async () => {
    const { store, rpc } = fakeStore({ data: 3, error: null });
    const r = await recordScouting(store, validRaw());
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_scouting", {
      p_plot_id: "p-cuesta-piedra",
      p_pest_kind: "broca",
      p_incidence_pct: 8,
      p_notes: "borings on the south rows",
      p_worker_id: "w-agro",
      p_occurred_at: "2026-06-21T09:00:00Z",
      p_device_id: "server",
      p_device_seq: 11,
      p_idempotency_key: "scout-001",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.observationId).toBe(3);
  });

  it("forwards null notes/worker when omitted", async () => {
    const { store, rpc } = fakeStore({ data: 3, error: null });
    const raw = validRaw();
    delete raw.notes;
    delete raw.workerId;
    await recordScouting(store, raw);
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_notes).toBeNull();
    expect(args.p_worker_id).toBeNull();
  });

  it("surfaces a labelled error when the RPC fails", async () => {
    const { store } = fakeStore({ data: null, error: { message: "unknown plot" } });
    const r = await recordScouting(store, validRaw());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("record_scouting");
  });
});
