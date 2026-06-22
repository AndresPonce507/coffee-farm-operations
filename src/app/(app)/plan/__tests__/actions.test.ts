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

/**
 * A Supabase mock whose `.rpc` answers `next_server_seq` with a strictly-increasing
 * sequence (the real SECURITY DEFINER draw) and the command RPCs with `result`. The
 * planner envelope draws device_seq from `next_server_seq` (NOT the wall clock), so a
 * faithful mock must service both call shapes.
 */
function makeClient(result: RpcResult = { error: null }) {
  let seq = 0;
  const rpc = vi.fn((fn: string) => {
    if (fn === "next_server_seq") {
      seq += 1;
      return Promise.resolve({ data: seq, error: null });
    }
    return Promise.resolve(result);
  });
  return { client: { rpc }, rpc };
}

/** Return only the command-RPC calls (filtering out the next_server_seq draws). */
function commandCalls(rpc: ReturnType<typeof vi.fn>) {
  return rpc.mock.calls.filter((c) => c[0] !== "next_server_seq");
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
    const calls = commandCalls(rpc);
    expect(calls.length).toBe(1);
    const [fn, args] = calls[0] as unknown as [string, Record<string, unknown>];
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
    const [fn, args] = commandCalls(rpc)[0] as unknown as [string, Record<string, unknown>];
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
    const [fn, args] = commandCalls(rpc)[0] as unknown as [string, Record<string, unknown>];
    expect(fn).toBe("record_maturation_signal");
    expect(args.p_plot_id).toBe("p-cuesta-piedra");
    expect(args.p_bloom_date).toBe("2026-01-15");
    expect(args.p_gdd_accumulated).toBe(1200);
    expect(args.p_ndvi_latest).toBe(0.7);
    expect(revalidatePathMock).toHaveBeenCalledWith("/plan");
  });
});

describe("device_seq is collision-free (drawn from next_server_seq, not the wall clock)", () => {
  // REGRESSION (review MED idx 18/113): the planner shared one device_id and minted
  // device_seq from now.getTime(); two writes in the same millisecond collided on the
  // pasada_schedule (device_id, device_seq) UNIQUE key and the second silently failed.
  // The envelope now draws a strictly-increasing server sequence, so two distinct
  // writes get DISTINCT device_seqs even under a frozen clock.
  it("two back-to-back plans get DISTINCT device_seqs", async () => {
    const { client, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);
    // freeze the wall clock so the OLD now.getTime() approach would collide.
    const frozen = new Date("2026-04-01T00:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(frozen.getTime());

    await schedulePasada({
      plotId: "p-a",
      season: "2026",
      pasadaNumber: 1,
      predictedReadyDate: "2026-04-01",
      ripenessTarget: "high",
    });
    await schedulePasada({
      plotId: "p-b",
      season: "2026",
      pasadaNumber: 1,
      predictedReadyDate: "2026-04-02",
      ripenessTarget: "high",
    });

    const seqs = commandCalls(rpc).map(
      (c) => (c[1] as Record<string, unknown>).p_device_seq,
    );
    expect(seqs.length).toBe(2);
    expect(seqs[0]).not.toBe(seqs[1]); // distinct despite the frozen clock
  });

  it("draws device_seq from next_server_seq() before the command RPC", async () => {
    const { client, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);
    await recordMaturationSignal({
      plotId: "p-a",
      bloomDate: "2026-01-15",
      gddAccumulated: 1200,
      ndviLatest: 0.7,
    });
    // the first rpc call is the seq draw; the command carries that seq.
    expect(rpc.mock.calls[0][0]).toBe("next_server_seq");
    const cmd = commandCalls(rpc)[0] as unknown as [string, Record<string, unknown>];
    expect(cmd[1].p_device_seq).toBe(1);
  });

  it("maps a duplicate-key collision onto a retryable, SQL-free message", async () => {
    const { client } = makeClient({
      error: {
        message:
          'duplicate key value violates unique constraint "pasada_schedule_device_id_device_seq_key"',
      },
    });
    getSupabaseMock.mockReturnValue(client);
    const res = await schedulePasada({
      plotId: "p-a",
      season: "2026",
      pasadaNumber: 1,
      predictedReadyDate: "2026-04-01",
      ripenessTarget: "high",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).not.toMatch(/duplicate key|constraint|sql/i);
      expect(res.error).toMatch(/try again/i);
    }
  });
});

describe("planner actions validate before the round-trip (the DB CHECKs are the backstop)", () => {
  // REGRESSION (review LOW idx 117): args reached the RPC unvalidated, so a negative
  // GDD / out-of-[0,1] NDVI / non-enum ripeness only failed at the DB CHECK and
  // surfaced as the generic, falsely-retryable "couldn't save" message. The action now
  // validates first and never calls rpc on bad input.
  it("rejects a negative GDD WITHOUT calling the RPC", async () => {
    const { client, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);
    const res = await recordMaturationSignal({
      plotId: "p-a",
      bloomDate: null,
      gddAccumulated: -500,
      ndviLatest: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/gdd/i);
    expect(commandCalls(rpc).length).toBe(0);
  });

  it("rejects an NDVI outside [0,1] WITHOUT calling the RPC", async () => {
    const { client, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);
    const res = await recordMaturationSignal({
      plotId: "p-a",
      bloomDate: null,
      gddAccumulated: null,
      ndviLatest: 1.5,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/ndvi/i);
    expect(commandCalls(rpc).length).toBe(0);
  });

  it("rejects a pasada number below 1 WITHOUT calling the RPC", async () => {
    const { client, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);
    const res = await schedulePasada({
      plotId: "p-a",
      season: "2026",
      pasadaNumber: 0,
      predictedReadyDate: "2026-04-01",
      ripenessTarget: "high",
    });
    expect(res.ok).toBe(false);
    expect(commandCalls(rpc).length).toBe(0);
  });

  it("maps a DB CHECK violation onto an actionable, SQL-free message", async () => {
    const { client } = makeClient({
      error: {
        message:
          'new row for relation "maturation_signal" violates check constraint "maturation_signal_gdd_accumulated_check"',
      },
    });
    getSupabaseMock.mockReturnValue(client);
    // a valid-shaped input that the DB still rejects (the backstop path).
    const res = await recordMaturationSignal({
      plotId: "p-a",
      bloomDate: null,
      gddAccumulated: 1200,
      ndviLatest: 0.5,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).not.toMatch(/check constraint|relation|sql/i);
      expect(res.error).toMatch(/out of range|try again/i);
    }
  });
});
