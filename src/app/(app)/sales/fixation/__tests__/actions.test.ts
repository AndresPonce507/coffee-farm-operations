import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => Promise.resolve({ rpc: rpcMock }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { fixLineAction } from "@/app/(app)/sales/fixation/actions";

beforeEach(() => rpcMock.mockReset());
afterEach(() => vi.clearAllMocks());

describe("fixLineAction — validation seam", () => {
  it("rejects a non-positive line id WITHOUT touching the database", async () => {
    const result = await fixLineAction({ contractLineId: 0, idempotencyKey: "idem-f1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Pick a line to fix.");
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("fixLineAction — command behaviour", () => {
  it("passes the EXACT snake_case p_ envelope to fix_contract_price", async () => {
    rpcMock.mockResolvedValue({ data: 11, error: null });
    const result = await fixLineAction({ contractLineId: 11, idempotencyKey: "idem-f2" });
    expect(result).toEqual({ ok: true, lineId: 11 });
    expect(rpcMock).toHaveBeenCalledWith("fix_contract_price", {
      p_contract_line_id: 11,
      p_idempotency_key: "idem-f2",
    });
  });

  it("surfaces the no-C-mark guard verbatim", async () => {
    const guard = 'no ICE "C" mark to fix for month MAR26';
    rpcMock.mockResolvedValue({ data: null, error: { message: guard, code: "P0002" } });
    const result = await fixLineAction({ contractLineId: 12, idempotencyKey: "idem-f3" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(guard);
  });

  it("maps an unknown structural Postgres error to clean generic copy", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'relation "v_ice_c_latest" does not exist', code: "42P01" },
    });
    const result = await fixLineAction({ contractLineId: 11, idempotencyKey: "idem-f4" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Could not fix that line. Try again.");
      expect(result.error).not.toMatch(/relation|v_ice_c_latest/);
    }
  });
});
