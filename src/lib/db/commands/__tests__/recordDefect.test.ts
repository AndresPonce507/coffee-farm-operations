import { describe, expect, it, vi } from "vitest";

import {
  recordDefect,
  validateDefect,
  type DefectStore,
} from "@/lib/db/commands/recordDefect";

/**
 * Pure-domain command test for the green-grading defect write (P2-S6 — append one
 * defect tally to a green lot via the `record_defect` SECURITY DEFINER RPC). No DB:
 * the command runs against a FAKE store stubbing the one `.rpc()` it uses, proving
 * (a) the friendly-validation seam (the DB CHECKs mirrored so errors surface before
 * the round-trip — count >= 0 integer, category in primary/secondary), (b) the exact
 * snake_case argument envelope the RPC receives, and (c) clean error surfacing. The
 * SQL CHECK / append-only block trigger is the real enforcement (proven in the db
 * test). Mirrors recordCupScore exactly — this is the missing WRITE half of the
 * defect ledger (read port getGreenDefects + v_qc_status tallies already exist, but
 * nothing could ever append a green_defects row).
 */

interface RpcResult {
  data: number | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: DefectStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as DefectStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  greenLotCode: "JC-9001",
  defectKind: "full black",
  count: "3",
  category: "primary",
  deviceId: "srv",
  deviceSeq: "12",
  idempotencyKey: "def-1",
});

describe("validateDefect", () => {
  it("accepts a complete, valid raw defect", () => {
    const r = validateDefect(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.greenLotCode).toBe("JC-9001");
      expect(r.data.defectKind).toBe("full black");
      expect(r.data.count).toBe(3);
      expect(r.data.category).toBe("primary");
    }
  });

  it("rejects a missing green lot code", () => {
    const r = validateDefect({ ...validRaw(), greenLotCode: "  " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.greenLotCode).toBeTruthy();
  });

  it("rejects a missing defect kind", () => {
    const r = validateDefect({ ...validRaw(), defectKind: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.defectKind).toBeTruthy();
  });

  it("rejects a negative, non-numeric, or fractional count (mirrors count >= 0 integer)", () => {
    expect(validateDefect({ ...validRaw(), count: "-1" }).ok).toBe(false);
    expect(validateDefect({ ...validRaw(), count: "x" }).ok).toBe(false);
    expect(validateDefect({ ...validRaw(), count: "2.5" }).ok).toBe(false);
  });

  it("accepts a zero count (the CHECK is count >= 0, not > 0)", () => {
    const r = validateDefect({ ...validRaw(), count: "0" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.count).toBe(0);
  });

  it("rejects a category outside primary/secondary (mirrors the CHECK)", () => {
    const r = validateDefect({ ...validRaw(), category: "tertiary" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.category).toBeTruthy();
  });
});

describe("recordDefect", () => {
  it("calls record_defect with the snake_case envelope on valid input", async () => {
    const { store, rpc } = fakeStore({ data: 42, error: null });
    const out = await recordDefect(store, validRaw());
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.defectId).toBe(42);
    expect(rpc).toHaveBeenCalledWith("record_defect", {
      p_green_lot_code: "JC-9001",
      p_defect_kind: "full black",
      p_count: 3,
      p_category: "primary",
      p_device_id: "srv",
      p_device_seq: 12,
      p_idempotency_key: "def-1",
    });
  });

  it("never reaches the RPC on bad input (friendly errors)", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const out = await recordDefect(store, { ...validRaw(), category: "nope" });
    expect(out.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces a labelled message on an RPC error", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "boom", code: "XX000" },
    });
    const out = await recordDefect(store, validRaw());
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/record_defect/i);
  });
});
