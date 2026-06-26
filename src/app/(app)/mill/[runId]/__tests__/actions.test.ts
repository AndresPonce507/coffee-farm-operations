import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Server Actions call `await (await getSupabase()).rpc(...)`. Mock one rpc spy.
// next-intl/server is globally mocked in setup.ts so getTranslations resolves the real
// EN copy. finalize mints green inventory + posts a cost_entry, so it must bust the
// inventory caches via reactiveRefresh; stub the ripple SSOT so no Next runtime is needed.
const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => Promise.resolve({ rpc: rpcMock }),
}));
const { reactiveRefreshMock } = vi.hoisted(() => ({ reactiveRefreshMock: vi.fn() }));
vi.mock("@/lib/revalidate", () => ({ reactiveRefresh: reactiveRefreshMock }));

import {
  finalizeMillingRunAction,
  recordGreenGradeAction,
} from "@/app/(app)/mill/[runId]/actions";

beforeEach(() => {
  rpcMock.mockReset();
  reactiveRefreshMock.mockReset();
});
afterEach(() => vi.clearAllMocks());

const baseFinalize = {
  runId: 7,
  greenKgOut: 82,
  cuppingScore: 91,
  location: "Bodega A",
  cat1Defects: 0,
  cat2Defects: 3,
  screenSize: 17,
  processingCostUsd: 120,
  idempotencyKey: "k1",
};

describe("finalizeMillingRunAction", () => {
  it("rejects a non-positive green outturn WITHOUT touching the database", async () => {
    const result = await finalizeMillingRunAction({ ...baseFinalize, greenKgOut: 0 });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a blank store location WITHOUT touching the database", async () => {
    const result = await finalizeMillingRunAction({ ...baseFinalize, location: "  " });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a negative defect count WITHOUT touching the database", async () => {
    const result = await finalizeMillingRunAction({ ...baseFinalize, cat1Defects: -1 });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a negative milling cost WITHOUT touching the database", async () => {
    const result = await finalizeMillingRunAction({ ...baseFinalize, processingCostUsd: -5 });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes the EXACT snake_case p_ envelope and returns the minted green code", async () => {
    rpcMock.mockResolvedValue({ data: "JC-742", error: null });
    const result = await finalizeMillingRunAction(baseFinalize);
    expect(result).toEqual({ ok: true, greenLotCode: "JC-742" });
    expect(rpcMock).toHaveBeenCalledWith("finalize_milling_run", {
      p_run_id: 7,
      p_green_kg_out: 82,
      p_cupping_score: 91,
      p_location: "Bodega A",
      p_cat1_defects: 0,
      p_cat2_defects: 3,
      p_screen_size: 17,
      p_processing_cost_usd: 120,
      p_idempotency_key: "k1",
    });
    // green inventory / COGS moved → the inventory ripple fires.
    expect(reactiveRefreshMock).toHaveBeenCalledWith("inventory-update");
  });

  it("passes nulls through for an uncupped lot / no screen size (never fabricated)", async () => {
    rpcMock.mockResolvedValue({ data: "JC-743", error: null });
    await finalizeMillingRunAction({
      ...baseFinalize,
      cuppingScore: null,
      screenSize: null,
    });
    expect(rpcMock).toHaveBeenCalledWith(
      "finalize_milling_run",
      expect.objectContaining({ p_cupping_score: null, p_screen_size: null }),
    );
  });

  it("surfaces the unbalanced-mass guard message verbatim (never a raw SQLSTATE leak)", async () => {
    const guard =
      "mill mass-balance unbalanced: run 7 outturn 64.000 kg leaves unaccounted loss beyond the per-variety ceiling — cannot finalize";
    rpcMock.mockResolvedValue({ data: null, error: { message: guard, code: "23514" } });
    const result = await finalizeMillingRunAction(baseFinalize);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(guard);
      expect(result.error).not.toMatch(/SQLSTATE|23514/);
    }
    // a failed write must NOT bust caches.
    expect(reactiveRefreshMock).not.toHaveBeenCalled();
  });

  it("maps an unknown structural Postgres error to clean generic copy (no raw leak)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'relation "mill_grade" does not exist', code: "42P01" },
    });
    const result = await finalizeMillingRunAction(baseFinalize);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Could not complete that. Check the details and try again.");
      expect(result.error).not.toMatch(/relation|mill_grade/);
    }
  });
});

describe("recordGreenGradeAction", () => {
  const baseGrade = {
    greenLotCode: "JC-742",
    cat1Defects: 0,
    cat2Defects: 3,
    screenSize: 17,
    idempotencyKey: "g1",
  };

  it("rejects a blank green lot code WITHOUT touching the database", async () => {
    const result = await recordGreenGradeAction({ ...baseGrade, greenLotCode: "" });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a fractional defect count WITHOUT touching the database", async () => {
    const result = await recordGreenGradeAction({ ...baseGrade, cat2Defects: 1.5 });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes the EXACT envelope to record_green_grade and returns the grade id", async () => {
    rpcMock.mockResolvedValue({ data: 55, error: null });
    const result = await recordGreenGradeAction(baseGrade);
    expect(result).toEqual({ ok: true, gradeId: 55 });
    expect(rpcMock).toHaveBeenCalledWith("record_green_grade", {
      p_green_lot_code: "JC-742",
      p_cat1_defects: 0,
      p_cat2_defects: 3,
      p_screen_size: 17,
      p_idempotency_key: "g1",
    });
  });
});
