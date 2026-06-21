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
    rpc.mockResolvedValue({ data: 42, error: null });
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
    rpc.mockResolvedValue({ data: null, error: { message: "unknown crew x" } });
    const state = await generateDispatchAction(
      fd({ crewId: "x", dispatchDate: "2026-06-22", season: "2026", readinessThreshold: "0.5" }),
    );
    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.message).toMatch(/no longer exists/i);
      expect(state.message).not.toMatch(/sql|exception|crew x/i);
    }
  });

  it("returns field errors for invalid input (never reaches the rpc)", async () => {
    const state = await generateDispatchAction(
      fd({ crewId: "", dispatchDate: "", season: "", readinessThreshold: "2" }),
    );
    expect(rpc).not.toHaveBeenCalled();
    expect(state.status).toBe("error");
  });
});

describe("markDispatchSentAction (defaults to $0 web-share)", () => {
  it("defaults the channel to web-share when none supplied", async () => {
    rpc.mockResolvedValue({ data: 7, error: null });
    await markDispatchSentAction(fd({ runId: "7" }));
    expect(rpc).toHaveBeenCalledWith(
      "mark_dispatch_sent",
      expect.objectContaining({ p_run_id: 7, p_channel: "web-share" }),
    );
  });
});

describe("recordDispatchAckAction (🚨 injection-safe inbound evidence)", () => {
  it("records the ack via the ack RPC ONLY (no command verb reached)", async () => {
    rpc.mockResolvedValue({ data: 1, error: null });
    const state = await recordDispatchAckAction(
      fd({ runId: "7", workerId: "w-03", channel: "whatsapp-inbound" }),
    );
    // the ONLY rpc this action may call is the evidence recorder.
    expect(rpc).toHaveBeenCalledTimes(1);
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
    rpc.mockResolvedValue({ data: 2, error: null });
    await recordDispatchAckAction(fd({ runId: "7", channel: "sms-inbound" }));
    expect(rpc).toHaveBeenCalledWith(
      "record_dispatch_ack",
      expect.objectContaining({ p_worker_id: null }),
    );
  });
});
