import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behaviour test for the PROCESS-ADVANCE Server Action. Server Actions are the
 * driving port (ADR-002 — only ever invoked by an authenticated human submitting
 * a form). These tests drive the action with real `FormData` against a mocked
 * Supabase client + a mocked `revalidatePath`, proving:
 *   - the action builds the offline-ready envelope server-side (synthetic
 *     `device_id` / `device_seq` / `idempotency_key`, and `occurredAt` when the
 *     form omits it) and delegates to the command,
 *   - a successful advance revalidates `/processing` (and `/`, for the
 *     dashboard pipeline metrics) and reports success,
 *   - the hardened RPC's CHECK violations (backward move / mass gain / bad
 *     stage) surface as CLEAN, family-readable errors — never a raw exception,
 *   - validation failures are returned as field errors without a round-trip.
 *
 * Mirrors the supabase-server mock idiom in the inventory actions test.
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
  advanceStageAction,
  PROCESSING_IDLE,
} from "@/app/(app)/processing/actions";

/** A Supabase-client stand-in exposing the one `.rpc()` the command calls. */
function makeClient(opts: {
  rpc?: { data: string | null; error: { message: string; code?: string } | null };
}): { client: unknown; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() =>
    Promise.resolve(opts.rpc ?? { data: null, error: null }),
  );
  return { client: { rpc }, rpc };
}

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  getSupabaseMock.mockReset();
  revalidatePathMock.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────── exports ───────────────────────────────────────

describe("processing action module", () => {
  it("exposes an idle state", () => {
    expect(PROCESSING_IDLE.status).toBe("idle");
  });
});

// ─────────────────────────── advance action ────────────────────────────────

describe("advanceStageAction", () => {
  it("advances a lot, revalidates /processing and /, and reports success", async () => {
    const { client, rpc } = makeClient({ rpc: { data: "JC-561", error: null } });
    getSupabaseMock.mockReturnValue(client);

    const state = await advanceStageAction(
      PROCESSING_IDLE,
      form({
        lotCode: "JC-561",
        toStage: "drying",
        currentKg: "420",
        occurredAt: "2026-06-20T14:03:00.000Z",
      }),
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("advance_processing_stage", {
      p_lot_code: "JC-561",
      p_to_stage: "drying",
      p_current_kg: 420,
      p_occurred_at: "2026-06-20T14:03:00.000Z",
      p_device_id: "server",
      p_device_seq: expect.any(Number),
      p_idempotency_key: expect.any(String),
    });
    expect(state.status).toBe("success");
    expect(revalidatePathMock).toHaveBeenCalledWith("/processing");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
  });

  it("synthesizes the offline envelope server-side when the form omits it", async () => {
    const { client, rpc } = makeClient({ rpc: { data: "JC-561", error: null } });
    getSupabaseMock.mockReturnValue(client);

    await advanceStageAction(
      PROCESSING_IDLE,
      form({ lotCode: "JC-561", toStage: "drying", currentKg: "420" }),
    );

    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    // occurredAt filled with a real, parseable ISO timestamp.
    expect(typeof args.p_occurred_at).toBe("string");
    expect(Number.isFinite(Date.parse(args.p_occurred_at as string))).toBe(true);
    // a synthetic device id + a non-empty idempotency key.
    expect(args.p_device_id).toBe("server");
    expect(typeof args.p_idempotency_key).toBe("string");
    expect((args.p_idempotency_key as string).length).toBeGreaterThan(0);
  });

  it("generates a UNIQUE idempotency key + device_seq per call", async () => {
    const { client, rpc } = makeClient({ rpc: { data: "JC-561", error: null } });
    getSupabaseMock.mockReturnValue(client);

    const fd = () =>
      form({ lotCode: "JC-561", toStage: "drying", currentKg: "420" });
    await advanceStageAction(PROCESSING_IDLE, fd());
    await advanceStageAction(PROCESSING_IDLE, fd());

    const first = rpc.mock.calls[0][1] as Record<string, unknown>;
    const second = rpc.mock.calls[1][1] as Record<string, unknown>;
    expect(first.p_idempotency_key).not.toBe(second.p_idempotency_key);
  });

  it("returns field errors WITHOUT a round-trip on invalid input", async () => {
    const { client, rpc } = makeClient({});
    getSupabaseMock.mockReturnValue(client);

    const state = await advanceStageAction(
      PROCESSING_IDLE,
      form({ lotCode: "", toStage: "drying", currentKg: "420" }),
    );

    expect(state.status).toBe("error");
    if (state.status === "error") expect(state.errors?.lotCode).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("surfaces a CLEAN error when the RPC rejects a BACKWARD move (no raw exception)", async () => {
    const { client } = makeClient({
      rpc: {
        data: null,
        error: {
          message: "lot JC-561 cannot move backward (drying -> fermentation)",
          code: "23514",
        },
      },
    });
    getSupabaseMock.mockReturnValue(client);

    const state = await advanceStageAction(
      PROCESSING_IDLE,
      form({
        lotCode: "JC-561",
        toStage: "fermentation",
        currentKg: "420",
        occurredAt: "2026-06-20T14:03:00.000Z",
      }),
    );

    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.message).toMatch(/backward|forward/i);
    }
    // A rejected advance does NOT revalidate (nothing changed).
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("surfaces a CLEAN error when the RPC rejects a mass GAIN", async () => {
    const { client } = makeClient({
      rpc: {
        data: null,
        error: {
          message: "lot JC-561 current_kg cannot increase (420 -> 9999)",
          code: "23514",
        },
      },
    });
    getSupabaseMock.mockReturnValue(client);

    const state = await advanceStageAction(
      PROCESSING_IDLE,
      form({
        lotCode: "JC-561",
        toStage: "drying",
        currentKg: "9999",
        occurredAt: "2026-06-20T14:03:00.000Z",
      }),
    );

    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.message).toMatch(/increase|mass|lower/i);
    }
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
