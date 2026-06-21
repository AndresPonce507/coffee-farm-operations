import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Behaviour test for the P2-S7 payroll Server Actions — the money-sensitive writes
 * the family makes from the cockpit (calculate a period, approve a line, record a
 * disbursement). Server Actions are the driving port (ADR-002 — only ever invoked by
 * an authenticated human submitting a form); each delegates to its already-tested
 * command port whose single write door is a SECURITY DEFINER RPC.
 *
 * Drives each action with a FormData payload against a mocked Supabase client + a
 * mocked revalidatePath, proving: a validation failure returns an error state WITHOUT
 * calling the RPC or revalidating; the happy path calls the RPC once with the
 * snake_case envelope and returns success + revalidates; a labelled DB error surfaces
 * cleanly. Mirrors the supabase-server mock idiom in the crew actions test.
 */

const getSupabaseMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidatePathMock(p),
}));

import {
  approvePayLineAction,
  computePayPeriodAction,
  recordDisbursementAction,
} from "@/app/(app)/payroll/actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** A Supabase-client stand-in: every `.rpc()` resolves to the configured result. */
function fakeClient(result: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn(
    async (_fn: string, _args?: Record<string, unknown>) => result,
  );
  return { client: { rpc }, rpc };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("computePayPeriodAction", () => {
  it("calculates a valid period and revalidates", async () => {
    const { client, rpc } = fakeClient({ data: "pp-1", error: null });
    getSupabaseMock.mockResolvedValue(client);

    const state = await computePayPeriodAction(
      form({
        periodId: "pp-1",
        periodStart: "2026-06-15",
        periodEnd: "2026-06-21",
        season: "2026-2027",
      }),
    );

    expect(state.status).toBe("success");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("compute_pay_period");
    expect(revalidatePathMock).toHaveBeenCalledWith("/payroll");
  });

  it("rejects an invalid period (end before start) without calling the RPC", async () => {
    const { client, rpc } = fakeClient({ data: null, error: null });
    getSupabaseMock.mockResolvedValue(client);

    const state = await computePayPeriodAction(
      form({ periodId: "pp-x", periodStart: "2026-06-21", periodEnd: "2026-06-15" }),
    );

    expect(state.status).toBe("error");
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("approvePayLineAction", () => {
  it("approves a line and revalidates", async () => {
    const { client, rpc } = fakeClient({ data: 7, error: null });
    getSupabaseMock.mockResolvedValue(client);

    const state = await approvePayLineAction(form({ payLineId: "7" }));

    expect(state.status).toBe("success");
    expect(rpc.mock.calls[0][0]).toBe("approve_pay_line");
    expect(revalidatePathMock).toHaveBeenCalledWith("/payroll");
  });

  it("rejects a non-numeric pay line id", async () => {
    const { client, rpc } = fakeClient({ data: null, error: null });
    getSupabaseMock.mockResolvedValue(client);

    const state = await approvePayLineAction(form({ payLineId: "not-a-number" }));
    expect(state.status).toBe("error");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("recordDisbursementAction", () => {
  it("records a valid disbursement and revalidates costing too", async () => {
    const { client, rpc } = fakeClient({ data: 11, error: null });
    getSupabaseMock.mockResolvedValue(client);

    const state = await recordDisbursementAction(
      form({
        payPeriodId: "pp-1",
        workerId: "w-06",
        amountUsd: "89.00",
        method: "yappy",
        ref: "yappy-tx-1",
      }),
    );

    expect(state.status).toBe("success");
    expect(rpc.mock.calls[0][0]).toBe("record_disbursement");
    expect(revalidatePathMock).toHaveBeenCalledWith("/payroll");
    expect(revalidatePathMock).toHaveBeenCalledWith("/costing");
  });

  it("rejects a cash-signed disbursement with no signature, without calling the RPC", async () => {
    const { client, rpc } = fakeClient({ data: null, error: null });
    getSupabaseMock.mockResolvedValue(client);

    const state = await recordDisbursementAction(
      form({
        payPeriodId: "pp-1",
        workerId: "w-06",
        amountUsd: "50",
        method: "cash-signed",
      }),
    );

    expect(state.status).toBe("error");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces a labelled DB error cleanly", async () => {
    const { client } = fakeClient({
      data: null,
      error: { message: "pay line for worker w-06 ... is not approved" },
    });
    getSupabaseMock.mockResolvedValue(client);

    const state = await recordDisbursementAction(
      form({
        payPeriodId: "pp-1",
        workerId: "w-06",
        amountUsd: "50",
        method: "ach",
        ref: "r1",
      }),
    );
    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.message).toMatch(/not approved/);
    }
  });
});
