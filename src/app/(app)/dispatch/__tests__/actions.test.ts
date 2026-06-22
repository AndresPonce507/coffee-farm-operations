import { describe, expect, it, vi, beforeEach } from "vitest";

// The Server Actions delegate to the command ports (which call the supabase rpc) and
// revalidatePath. Mock the supabase server client + next/cache so we exercise the
// action's envelope-minting + result mapping in isolation (the RPC behaviour itself
// is proven by the PGlite db test).

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: async () => ({ rpc }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * The actions now draw a UNIQUE device_seq from the SECURITY DEFINER `next_server_seq()`
 * RPC (the crew-slice C1 collision fix) instead of a bare `Date.now()`. So every action
 * issues TWO rpc calls: `next_server_seq` first, then its command verb. This helper wires
 * a monotonic seq draw + a fixed command reply so the existing assertions still hold and
 * we can read back the device_seq each command received.
 */
let seqCounter = 0;
function wireRpc(commandReply: { data: number | null; error: { message: string } | null }) {
  seqCounter = 0;
  rpc.mockImplementation((fn: string) => {
    if (fn === "next_server_seq") {
      // strictly-increasing integers — the online draw that makes (device_id, seq) unique
      return Promise.resolve({ data: 1000 + seqCounter++, error: null });
    }
    return Promise.resolve(commandReply);
  });
}

/** The args the command verb (not next_server_seq) received on a given call index. */
function commandCallArgs(fn: string): Record<string, unknown> {
  const call = rpc.mock.calls.find((c) => c[0] === fn);
  if (!call) throw new Error(`no rpc call to ${fn}`);
  return call[1] as Record<string, unknown>;
}

import {
  generateDispatchAction,
  markDispatchSentAction,
  recordDispatchAckAction,
} from "@/app/(app)/dispatch/actions";

beforeEach(() => {
  rpc.mockReset();
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("generateDispatchAction", () => {
  it("mints the device envelope and returns success with the run id", async () => {
    wireRpc({ data: 42, error: null });
    const state = await generateDispatchAction(
      fd({ crewId: "crew-norte", dispatchDate: "2026-06-22", season: "2026", readinessThreshold: "0.5" }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "generate_dispatch",
      expect.objectContaining({
        p_crew_id: "crew-norte",
        p_dispatch_date: "2026-06-22",
        p_season: "2026",
        p_device_id: "dispatch-console",
      }),
    );
    expect(state).toEqual(expect.objectContaining({ status: "success", runId: 42 }));
  });

  it("maps a friendly error on a DB rejection (no raw SQL leaks)", async () => {
    wireRpc({ data: null, error: { message: "unknown crew x" } });
    const state = await generateDispatchAction(
      fd({ crewId: "x", dispatchDate: "2026-06-22", season: "2026", readinessThreshold: "0.5" }),
    );
    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.message).toMatch(/no longer exists/i);
      expect(state.message).not.toMatch(/sql|exception|crew x/i);
    }
  });

  it("returns field errors for invalid input (never reaches the write command)", async () => {
    wireRpc({ data: 42, error: null });
    const state = await generateDispatchAction(
      fd({ crewId: "", dispatchDate: "", season: "", readinessThreshold: "2" }),
    );
    // bad input NEVER reaches the write door — only the envelope-minting seq draw may run.
    expect(rpc).not.toHaveBeenCalledWith("generate_dispatch", expect.anything());
    expect(state.status).toBe("error");
  });

  // 🚨 C1 COLLISION REGRESSION (HIGH): the bare `Date.now()` device_seq collided on the
  // `unique (device_id, device_seq)` key when two crews were dispatched in the same dawn
  // millisecond — the second INSERT raised duplicate-key. The fix draws a UNIQUE seq from
  // the SECURITY DEFINER `next_server_seq()` online draw, so two same-instant dispatches
  // get DISTINCT device_seq even when the wall clock is frozen.
  it("draws a UNIQUE device_seq from next_server_seq (not bare Date.now)", async () => {
    wireRpc({ data: 7, error: null });
    // pin the wall clock so a Date.now()-based seq would be identical on both calls
    const fixed = new Date("2026-06-22T05:30:00.000Z").getTime();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(fixed);
    try {
      await generateDispatchAction(
        fd({ crewId: "crew-norte", dispatchDate: "2026-06-22", season: "2026", readinessThreshold: "0.5" }),
      );
      await generateDispatchAction(
        fd({ crewId: "crew-sur", dispatchDate: "2026-06-22", season: "2026", readinessThreshold: "0.5" }),
      );
    } finally {
      nowSpy.mockRestore();
    }

    // the action must consult the server-seq draw before each command write
    expect(rpc).toHaveBeenCalledWith("next_server_seq");

    const seqs = rpc.mock.calls
      .filter((c) => c[0] === "generate_dispatch")
      .map((c) => (c[1] as Record<string, unknown>).p_device_seq);
    expect(seqs).toHaveLength(2);
    // even with Date.now() frozen, the two writes carry DISTINCT, integer seqs
    expect(seqs[0]).not.toBe(seqs[1]);
    expect(Number.isInteger(seqs[0])).toBe(true);
    expect(Number.isInteger(seqs[1])).toBe(true);
  });

  // A genuine offline replay must REUSE its envelope's seq (paired with its idempotency
  // key) rather than minting a fresh one — otherwise the same business intent lands twice
  // under two seqs. A form-supplied deviceSeq wins over the online draw.
  it("honors a form-supplied deviceSeq (offline replay reuses its envelope)", async () => {
    wireRpc({ data: 9, error: null });
    await generateDispatchAction(
      fd({
        crewId: "crew-norte",
        dispatchDate: "2026-06-22",
        season: "2026",
        readinessThreshold: "0.5",
        deviceSeq: "424242",
        idempotencyKey: "replay-key-1",
      }),
    );
    expect(commandCallArgs("generate_dispatch")).toMatchObject({
      p_device_seq: 424242,
      p_idempotency_key: "replay-key-1",
    });
  });
});

// LOW (defensive completeness): the unique-violation that the seq collision could surface
// must map to a friendly retry sentence, not the generic fall-through — and never leak SQL.
describe("friendlyError covers the dispatch tables' unique constraint", () => {
  it("maps a duplicate-key unique violation to a retry message (no SQL leak)", async () => {
    wireRpc({
      data: null,
      error: {
        message:
          'duplicate key value violates unique constraint "dispatch_run_device_id_device_seq_key"',
      },
    });
    const state = await generateDispatchAction(
      fd({ crewId: "crew-norte", dispatchDate: "2026-06-22", season: "2026", readinessThreshold: "0.5" }),
    );
    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.message).toMatch(/at once|try that one again/i);
      expect(state.message).not.toMatch(/duplicate key|unique constraint|sql|exception/i);
    }
  });
});

describe("markDispatchSentAction (defaults to $0 web-share)", () => {
  it("defaults the channel to web-share when none supplied", async () => {
    wireRpc({ data: 7, error: null });
    await markDispatchSentAction(fd({ runId: "7" }));
    expect(rpc).toHaveBeenCalledWith(
      "mark_dispatch_sent",
      expect.objectContaining({ p_run_id: 7, p_channel: "web-share" }),
    );
  });
});

describe("recordDispatchAckAction (🚨 injection-safe inbound evidence)", () => {
  it("records the ack via the ack RPC ONLY (no command verb reached)", async () => {
    wireRpc({ data: 1, error: null });
    const state = await recordDispatchAckAction(
      fd({ runId: "7", workerId: "w-03", channel: "whatsapp-inbound" }),
    );
    // the ONLY command verb this action may call is the evidence recorder. (The seq draw,
    // next_server_seq, is an envelope-minting read — it writes nothing and reaches no verb.)
    const verbCalls = rpc.mock.calls.filter((c) => c[0] !== "next_server_seq");
    expect(verbCalls).toHaveLength(1);
    expect(verbCalls[0][0]).toBe("record_dispatch_ack");
    expect(rpc).toHaveBeenCalledWith(
      "record_dispatch_ack",
      expect.objectContaining({ p_run_id: 7, p_channel: "whatsapp-inbound" }),
    );
    // it never calls generate / mark-sent / any action verb.
    expect(rpc).not.toHaveBeenCalledWith("generate_dispatch", expect.anything());
    expect(rpc).not.toHaveBeenCalledWith("mark_dispatch_sent", expect.anything());
    expect(state.status).toBe("success");
  });

  it("accepts an unknown sender (workerId omitted → null, never an error)", async () => {
    wireRpc({ data: 2, error: null });
    await recordDispatchAckAction(fd({ runId: "7", channel: "sms-inbound" }));
    expect(rpc).toHaveBeenCalledWith(
      "record_dispatch_ack",
      expect.objectContaining({ p_worker_id: null }),
    );
  });
});
