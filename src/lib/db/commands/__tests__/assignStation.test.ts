import { describe, expect, it, vi } from "vitest";

import {
  assignStation,
  validateAssignStation,
  type AssignStationStore,
} from "@/lib/db/commands/assignStation";

/**
 * Pure-domain command test for the drying-station assignment write (P2-S4;
 * ADR-002). Drives the command against a *fake store* (a stub of the one
 * `.rpc('assign_drying_station', …)` method): proves the validation seam, the
 * snake_case envelope, and that the fail-closed overcapacity guard surfaces as a
 * clean, family-readable reason. The capacity enforcement is the trigger's job
 * (pinned by the migration's PGlite tests). Mirrors advanceProcessingStage.test.ts.
 */

function fakeStore(result: {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}): { store: AssignStationStore; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as AssignStationStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  lotCode: "JC-571",
  stationId: "st-bed-1",
  occurredAt: "2026-06-20T08:00:00.000Z",
});

describe("validateAssignStation", () => {
  it("accepts a complete, valid assignment", () => {
    expect(validateAssignStation(validRaw()).ok).toBe(true);
  });

  it("rejects a missing station", () => {
    const r = validateAssignStation({ ...validRaw(), stationId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.stationId).toBeTruthy();
  });
});

describe("assignStation", () => {
  it("calls the RPC once with the exact snake_case envelope and returns the id", async () => {
    const { store, rpc } = fakeStore({ data: 9, error: null });
    const r = await assignStation(store, validRaw());
    expect(r).toEqual({ ok: true, assignmentId: 9 });
    expect(rpc).toHaveBeenCalledWith("assign_drying_station", {
      p_lot_code: "JC-571",
      p_station_id: "st-bed-1",
      p_occurred_at: "2026-06-20T08:00:00.000Z",
    });
  });

  it("translates the fail-closed overcapacity guard into a clean reason", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message:
          "capacity guard: committing 5000 kg to station st-small would exceed its 80 kg capacity",
        code: "23514",
      },
    });
    const r = await assignStation(store, validRaw());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/full|capacity/i);
  });

  it("translates a no-declared-mass raise into a clean reason", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "cannot assign station: lot JC-571 has no declared mass" },
    });
    const r = await assignStation(store, validRaw());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/no recorded weight/i);
  });
});
