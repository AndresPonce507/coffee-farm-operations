import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * P2-S8 planner Server Actions — the WRITE seam over the harvest-planning command
 * RPCs (schedule_pasada / replan_pasada / record_maturation_signal). Server
 * Actions are the driving port (ADR-002 — only ever invoked by an authenticated
 * human in the /plan UI). Each action mints the device_id/device_seq/
 * idempotency_key the RPC requires and maps raw DB rejections onto friendly,
 * SQL-free messages. Driven against a mocked Supabase `.rpc` + revalidatePath.
 */

const getSupabaseMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

import {
  recordMaturationSignal,
  replanPasada,
  schedulePasada,
} from "@/app/(app)/plan/actions";

type RpcResult = { error: { message: string } | null };

function makeClient(result: RpcResult = { error: null }) {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { client: { rpc }, rpc };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("schedulePasada — fires a pasada plan + a board task", () => {
  it("calls schedule_pasada with the plan args + minted device ids, then revalidates", async () => {
    const { client, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const res = await schedulePasada({
      plotId: "p-cuesta-piedra",
      season: "2026",
      pasadaNumber: 1,
      predictedReadyDate: "2026-04-01",
      ripenessTarget: "high",
    });

    expect(res).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(fn).toBe("schedule_pasada");
    expect(args.p_plot_id).toBe("p-cuesta-piedra");
    expect(args.p_pasada_number).toBe(1);
    expect(args.p_predicted_ready_date).toBe("2026-04-01");
    expect(args.p_predicted_ripe_pct).toBe("high");
    // the offline-replayable contract: every write carries device ids + a key.
    expect(args.p_device_id).toBeTruthy();
    expect(args.p_idempotency_key).toBeTruthy();
    expect(args.p_occurred_at).toBeTruthy();
    expect(revalidatePathMock).toHaveBeenCalledWith("/plan");
  });

  it("maps a DB rejection onto a friendly, SQL-free message", async () => {
    const { client } = makeClient({ error: { message: "unknown plot p-x" } });
    getSupabaseMock.mockReturnValue(client);
    const res = await schedulePasada({
      plotId: "p-x",
      season: "2026",
      pasadaNumber: 1,
      predictedReadyDate: "2026-04-01",
      ripenessTarget: "medium",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).not.toMatch(/sql|exception|p_plot_id/i);
      expect(res.error.length).toBeGreaterThan(0);
    }
  });
});

describe("replanPasada — re-plans around a rain front (append-only supersede)", () => {
  it("calls replan_pasada with the new date + reason + minted ids", async () => {
    const { client, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const res = await replanPasada({
      plotId: "p-bambito",
      season: "2026",
      pasadaNumber: 1,
      newReadyDate: "2026-04-08",
      reason: "rain front",
    });

    expect(res).toEqual({ ok: true });
    const [fn, args] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(fn).toBe("replan_pasada");
    expect(args.p_new_ready_date).toBe("2026-04-08");
    expect(args.p_reason).toBe("rain front");
    expect(args.p_device_id).toBeTruthy();
    expect(revalidatePathMock).toHaveBeenCalledWith("/plan");
  });
});

describe("recordMaturationSignal — logs a bloom / GDD / NDVI signal", () => {
  it("calls record_maturation_signal and revalidates /plan", async () => {
    const { client, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const res = await recordMaturationSignal({
      plotId: "p-cuesta-piedra",
      bloomDate: "2026-01-15",
      gddAccumulated: 1200,
      ndviLatest: 0.7,
    });

    expect(res).toEqual({ ok: true });
    const [fn, args] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(fn).toBe("record_maturation_signal");
    expect(args.p_plot_id).toBe("p-cuesta-piedra");
    expect(args.p_bloom_date).toBe("2026-01-15");
    expect(args.p_gdd_accumulated).toBe(1200);
    expect(args.p_ndvi_latest).toBe(0.7);
    expect(revalidatePathMock).toHaveBeenCalledWith("/plan");
  });
});
