import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behaviour test for the DRYING Server Actions — the two write surfaces that feed
 * the reposo gate from the running app (P2-S4). Server Actions are the driving
 * port (ADR-002 — only ever invoked by an authenticated human submitting a form).
 * These tests drive each action with real `FormData` against a mocked Supabase
 * client + a mocked `revalidatePath`, proving:
 *   - each action builds the offline-ready envelope server-side (synthetic
 *     `device_id` / `device_seq` / `idempotency_key`, and `occurredAt` when the
 *     form omits it) and delegates to its command,
 *   - a successful write revalidates `/drying` (the resting board), `/processing`
 *     (the pipeline the gate guards) and `/` (the dashboard) and reports success,
 *   - the hardened RPC's known failures surface as CLEAN, family-readable errors
 *     — never a raw exception,
 *   - validation failures are returned as field errors without a round-trip,
 *   - a STABLE form-carried idempotency key is forwarded verbatim (double-submit
 *     dedupes), while a missing key is synthesized fresh per call.
 *
 * Mirrors the processing/__tests__/actions.test.ts supabase-server mock idiom.
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
  assignStationAction,
  DRYING_IDLE,
  recordMoistureAction,
} from "@/app/(app)/drying/actions";

/** A Supabase-client stand-in exposing the one `.rpc()` the command calls. */
function makeClient(opts: {
  rpc?: {
    data: number | string | null;
    error: { message: string; code?: string } | null;
  };
}): { client: unknown; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() =>
    Promise.resolve(opts.rpc ?? { data: 1, error: null }),
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

describe("drying action module", () => {
  it("exposes an idle state", () => {
    expect(DRYING_IDLE.status).toBe("idle");
  });
});

// ─────────────────────────── record-moisture action ────────────────────────

describe("recordMoistureAction", () => {
  it("records a reading, revalidates /drying, /processing and /, and reports success", async () => {
    const { client, rpc } = makeClient({ rpc: { data: 42, error: null } });
    getSupabaseMock.mockReturnValue(client);

    const state = await recordMoistureAction(
      DRYING_IDLE,
      form({
        lotCode: "JC-571",
        moisturePct: "11.2",
        occurredAt: "2026-06-20T14:03:00.000Z",
      }),
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_moisture_reading", {
      p_lot_code: "JC-571",
      p_moisture_pct: 11.2,
      p_occurred_at: "2026-06-20T14:03:00.000Z",
      p_device_id: "server-drying",
      p_device_seq: expect.any(Number),
      p_idempotency_key: expect.any(String),
    });
    expect(state.status).toBe("success");
    expect(revalidatePathMock).toHaveBeenCalledWith("/drying");
    expect(revalidatePathMock).toHaveBeenCalledWith("/processing");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
  });

  it("synthesizes the offline envelope server-side when the form omits it", async () => {
    const { client, rpc } = makeClient({ rpc: { data: 1, error: null } });
    getSupabaseMock.mockReturnValue(client);

    await recordMoistureAction(
      DRYING_IDLE,
      form({ lotCode: "JC-571", moisturePct: "11.2" }),
    );

    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(typeof args.p_occurred_at).toBe("string");
    expect(Number.isFinite(Date.parse(args.p_occurred_at as string))).toBe(true);
    expect(args.p_device_id).toBe("server-drying");
    expect(typeof args.p_idempotency_key).toBe("string");
    expect((args.p_idempotency_key as string).length).toBeGreaterThan(0);
    expect(Number.isInteger(args.p_device_seq)).toBe(true);
    expect(args.p_device_seq as number).toBeGreaterThanOrEqual(0);
  });

  it("generates a UNIQUE idempotency key + device_seq per call", async () => {
    const { client, rpc } = makeClient({ rpc: { data: 1, error: null } });
    getSupabaseMock.mockReturnValue(client);

    const fd = () => form({ lotCode: "JC-571", moisturePct: "11.2" });
    await recordMoistureAction(DRYING_IDLE, fd());
    await recordMoistureAction(DRYING_IDLE, fd());

    const first = rpc.mock.calls[0][1] as Record<string, unknown>;
    const second = rpc.mock.calls[1][1] as Record<string, unknown>;
    expect(first.p_idempotency_key).not.toBe(second.p_idempotency_key);
    expect(first.p_device_seq).not.toBe(second.p_device_seq);
  });

  it("forwards a STABLE idempotency key from the form (a double-submit dedupes)", async () => {
    const { client, rpc } = makeClient({ rpc: { data: 1, error: null } });
    getSupabaseMock.mockReturnValue(client);

    const stable = () =>
      form({
        lotCode: "JC-571",
        moisturePct: "11.2",
        idempotencyKey: "form-instance-key-abc",
      });
    await recordMoistureAction(DRYING_IDLE, stable());
    await recordMoistureAction(DRYING_IDLE, stable());

    const first = rpc.mock.calls[0][1] as Record<string, unknown>;
    const second = rpc.mock.calls[1][1] as Record<string, unknown>;
    expect(first.p_idempotency_key).toBe("form-instance-key-abc");
    expect(second.p_idempotency_key).toBe("form-instance-key-abc");
  });

  it("uses a drying-specific device_id (distinct from intake/processing)", async () => {
    const { client, rpc } = makeClient({ rpc: { data: 1, error: null } });
    getSupabaseMock.mockReturnValue(client);

    await recordMoistureAction(
      DRYING_IDLE,
      form({ lotCode: "JC-571", moisturePct: "11.2" }),
    );

    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_device_id).toBe("server-drying");
    expect(args.p_device_id).not.toBe("server-processing");
    expect(args.p_device_id).not.toBe("server-intake");
  });

  it("returns field errors WITHOUT a round-trip on invalid input", async () => {
    const { client, rpc } = makeClient({});
    getSupabaseMock.mockReturnValue(client);

    const state = await recordMoistureAction(
      DRYING_IDLE,
      form({ lotCode: "", moisturePct: "11.2" }),
    );

    expect(state.status).toBe("error");
    if (state.status === "error") expect(state.errors?.lotCode).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("surfaces a CLEAN error when the RPC rejects an out-of-range pct (no raw exception)", async () => {
    const { client } = makeClient({
      rpc: {
        data: null,
        error: {
          message:
            'new row for relation "moisture_readings" violates check constraint "moisture_readings_moisture_pct_check"',
          code: "23514",
        },
      },
    });
    getSupabaseMock.mockReturnValue(client);

    const state = await recordMoistureAction(
      DRYING_IDLE,
      form({
        lotCode: "JC-571",
        moisturePct: "120",
        occurredAt: "2026-06-20T14:03:00.000Z",
      }),
    );

    // 120 fails the client-side validator first (no round-trip) — a field error.
    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(
        state.errors?.moisturePct ?? state.message,
      ).toMatch(/percentage|between 0 and 100/i);
    }
    // The raw Postgres text never leaks.
    expect(JSON.stringify(state)).not.toMatch(/check constraint|violates/i);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────── assign-station action ─────────────────────────

describe("assignStationAction", () => {
  it("assigns a lot to a station, revalidates /drying + /processing + /, reports success", async () => {
    const { client, rpc } = makeClient({ rpc: { data: 7, error: null } });
    getSupabaseMock.mockReturnValue(client);

    const state = await assignStationAction(
      DRYING_IDLE,
      form({
        lotCode: "JC-571",
        stationId: "st-bed-1",
        occurredAt: "2026-06-20T14:03:00.000Z",
      }),
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("assign_drying_station", {
      p_lot_code: "JC-571",
      p_station_id: "st-bed-1",
      p_occurred_at: "2026-06-20T14:03:00.000Z",
    });
    expect(state.status).toBe("success");
    expect(revalidatePathMock).toHaveBeenCalledWith("/drying");
    expect(revalidatePathMock).toHaveBeenCalledWith("/processing");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
  });

  it("synthesizes occurredAt server-side when the form omits it", async () => {
    const { client, rpc } = makeClient({ rpc: { data: 1, error: null } });
    getSupabaseMock.mockReturnValue(client);

    await assignStationAction(
      DRYING_IDLE,
      form({ lotCode: "JC-571", stationId: "st-bed-1" }),
    );

    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(typeof args.p_occurred_at).toBe("string");
    expect(Number.isFinite(Date.parse(args.p_occurred_at as string))).toBe(true);
  });

  it("returns field errors WITHOUT a round-trip on invalid input", async () => {
    const { client, rpc } = makeClient({});
    getSupabaseMock.mockReturnValue(client);

    const state = await assignStationAction(
      DRYING_IDLE,
      form({ lotCode: "JC-571", stationId: "" }),
    );

    expect(state.status).toBe("error");
    if (state.status === "error") expect(state.errors?.stationId).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("surfaces a CLEAN error when the overcapacity guard fires (no raw exception)", async () => {
    const { client } = makeClient({
      rpc: {
        data: null,
        error: {
          message: "capacity guard: station st-bed-1 would exceed capacity",
          code: "23514",
        },
      },
    });
    getSupabaseMock.mockReturnValue(client);

    const state = await assignStationAction(
      DRYING_IDLE,
      form({
        lotCode: "JC-571",
        stationId: "st-bed-1",
        occurredAt: "2026-06-20T14:03:00.000Z",
      }),
    );

    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.message).toMatch(/full|capacity/i);
    }
    expect(JSON.stringify(state)).not.toMatch(/capacity guard:|23514/i);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
