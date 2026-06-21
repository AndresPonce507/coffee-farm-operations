import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behaviour test for the cherry-intake Server Action (the WRITE seam that mints a
 * traceable JC-NNN lot). Server Actions are the driving port (ADR-002 — only ever
 * invoked by an authenticated human submitting a form). It drives the action
 * against a mocked Supabase client + mocked `revalidatePath`, proving:
 *   - a valid intake calls `record_cherry_intake` with the snake_case envelope and
 *     reports the minted lot code in the success state,
 *   - REVIEW FINDING #10 (ROOT C): the action NEVER hardcodes `device_seq = 0` —
 *     two distinct intakes from the single online `device_id` carry DISTINCT
 *     `device_seq` values, so the second one cannot collide on lot_event's
 *     (device_id, device_seq) key,
 *   - a DB error surfaces as a friendly, labelled message and does NOT revalidate.
 *
 * Mirrors the supabase-server mock idiom in src/app/(app)/eudr/__tests__/actions.test.ts.
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
  recordCherryIntakeAction,
  INTAKE_IDLE,
} from "@/app/(app)/harvests/actions";

/** A Supabase-client stand-in whose single `.rpc()` resolves the given result. */
function makeClient(result: {
  data: string | null;
  error: { message: string } | null;
}): { client: unknown; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { client: { rpc }, rpc };
}

/** A populated FormData for a complete, valid intake. */
function intakeForm(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    plotId: "p-tizingal-alto",
    workerId: "w-lucia",
    cherriesKg: "88",
    variety: "Geisha",
    ...over,
  };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  getSupabaseMock.mockReset();
  revalidatePathMock.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("recordCherryIntakeAction", () => {
  it("mints a lot, reports the JC-NNN code in the success state, and revalidates", async () => {
    const { client, rpc } = makeClient({ data: "JC-742", error: null });
    getSupabaseMock.mockReturnValue(client);

    const state = await recordCherryIntakeAction(INTAKE_IDLE, intakeForm());

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe("record_cherry_intake");
    expect(args.p_plot_id).toBe("p-tizingal-alto");
    expect(args.p_worker_id).toBe("w-lucia");
    expect(args.p_cherries_kg).toBe(88);
    expect(args.p_variety).toBe("Geisha");

    expect(state.status).toBe("success");
    if (state.status === "success") {
      expect(state.lotCode).toBe("JC-742");
      expect(state.message).toContain("JC-742");
    }
    expect(revalidatePathMock).toHaveBeenCalledWith("/harvests");
  });

  // REVIEW FINDING #10 / ROOT C — a hardcoded device_seq=0 collides on the
  // second intake. This FAILS on the pre-fix action (both calls send 0).
  it("sends a DISTINCT device_seq per intake so a second intake never collides", async () => {
    const { client, rpc } = makeClient({ data: "JC-742", error: null });
    getSupabaseMock.mockReturnValue(client);

    await recordCherryIntakeAction(INTAKE_IDLE, intakeForm());
    await recordCherryIntakeAction(INTAKE_IDLE, intakeForm());

    const first = rpc.mock.calls[0][1] as Record<string, unknown>;
    const second = rpc.mock.calls[1][1] as Record<string, unknown>;

    // Every device_seq must be a non-negative integer (the Lamport counter)…
    expect(Number.isInteger(first.p_device_seq)).toBe(true);
    expect(Number(first.p_device_seq)).toBeGreaterThanOrEqual(0);
    // …and the two intakes must NOT share one (no (device_id, device_seq) collision).
    expect(first.p_device_seq).not.toBe(second.p_device_seq);
  });

  it("mints a fresh idempotency key per submit when the form omits one", async () => {
    const { client, rpc } = makeClient({ data: "JC-742", error: null });
    getSupabaseMock.mockReturnValue(client);

    await recordCherryIntakeAction(INTAKE_IDLE, intakeForm());
    await recordCherryIntakeAction(INTAKE_IDLE, intakeForm());

    const first = rpc.mock.calls[0][1] as Record<string, unknown>;
    const second = rpc.mock.calls[1][1] as Record<string, unknown>;
    expect(first.p_idempotency_key).toBeTruthy();
    expect(first.p_idempotency_key).not.toBe(second.p_idempotency_key);
  });

  it("rejects an invalid intake WITHOUT a round-trip and reports field errors", async () => {
    const { client, rpc } = makeClient({ data: null, error: null });
    getSupabaseMock.mockReturnValue(client);

    const state = await recordCherryIntakeAction(
      INTAKE_IDLE,
      intakeForm({ cherriesKg: "0", plotId: "" }),
    );

    expect(rpc).not.toHaveBeenCalled();
    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.errors?.plotId).toBeDefined();
      expect(state.errors?.cherriesKg).toBeDefined();
    }
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("surfaces a labelled DB error and does NOT revalidate", async () => {
    const { client } = makeClient({
      data: null,
      error: { message: "duplicate key value violates unique constraint" },
    });
    getSupabaseMock.mockReturnValue(client);

    const state = await recordCherryIntakeAction(INTAKE_IDLE, intakeForm());

    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.message).toContain("record_cherry_intake");
    }
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
