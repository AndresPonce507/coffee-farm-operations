import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Direct coverage of the events read-port (`src/lib/db/events.ts`).
 *
 * Mirrors the strategy in getters.test.ts: mock `@/lib/supabase/server` so
 * `getSupabase()` returns a chainable, thenable query-builder stub. This pins:
 *   - mapEvent: pure snake_case `lot_event` row → camelCase `LotEvent` domain
 *     object (event_uid→id, stream_key→streamKey, dual clocks, device_id/seq,
 *     payload passthrough).
 *   - getEventStream: queries `lot_event`, filters by stream_key, orders by
 *     device_seq then recorded_at, and maps the rows.
 *   - verifyStream: calls the `verify_chain` RPC with the stream key and returns
 *     its boolean result (the chain-verified badge's source of truth).
 *
 * These are unit tests over the port's public surface — no real DB. The SQL of
 * verify_chain itself is pinned by the PGlite db-suite; this file pins the
 * TypeScript seam that calls it.
 */

// ----- chainable Supabase query-builder + rpc stub --------------------------

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

/**
 * Records the calls a getter makes so assertions can inspect them, while
 * resolving every chain (and `.rpc`) to a configured `{ data, error }`.
 */
function makeClient<T>(result: QueryResult<T>) {
  const calls = {
    from: undefined as string | undefined,
    select: undefined as string | undefined,
    eqArgs: [] as Array<[string, unknown]>,
    orderArgs: [] as Array<[string, Record<string, unknown> | undefined]>,
    rpcName: undefined as string | undefined,
    rpcArgs: undefined as Record<string, unknown> | undefined,
  };

  const builder = {
    from: vi.fn((table: string) => {
      calls.from = table;
      return builder;
    }),
    select: vi.fn((cols: string) => {
      calls.select = cols;
      return builder;
    }),
    eq: vi.fn((col: string, val: unknown) => {
      calls.eqArgs.push([col, val]);
      return builder;
    }),
    order: vi.fn((col: string, opts?: Record<string, unknown>) => {
      calls.orderArgs.push([col, opts]);
      return builder;
    }),
    then: (
      onFulfilled: (value: QueryResult<T>) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };

  const client = {
    from: (table: string) => builder.from(table),
    rpc: vi.fn((name: string, args?: Record<string, unknown>) => {
      calls.rpcName = name;
      calls.rpcArgs = args;
      return Promise.resolve(result);
    }),
  };

  return { client, calls };
}

const getSupabaseMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));

beforeEach(() => {
  getSupabaseMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

// ----- mapEvent (pure) ------------------------------------------------------

describe("mapEvent", () => {
  it("maps a snake_case lot_event row to a camelCase LotEvent", async () => {
    const { mapEvent } = await import("@/lib/db/events");

    const row = {
      event_uid: "11111111-1111-1111-1111-111111111111",
      stream_key: "JC-700",
      kind: "cherry_intake",
      occurred_at: "2026-06-20T12:00:00.000Z",
      recorded_at: "2026-06-20T12:00:01.000Z",
      device_id: "device-A",
      device_seq: 1,
      payload: { lot_code: "JC-700", cherries_kg: 120 },
    };

    expect(mapEvent(row)).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      streamKey: "JC-700",
      kind: "cherry_intake",
      occurredAt: "2026-06-20T12:00:00.000Z",
      recordedAt: "2026-06-20T12:00:01.000Z",
      deviceId: "device-A",
      deviceSeq: 1,
      payload: { lot_code: "JC-700", cherries_kg: 120 },
    });
  });

  it("coerces a string device_seq to a number", async () => {
    const { mapEvent } = await import("@/lib/db/events");

    const mapped = mapEvent({
      event_uid: "u",
      stream_key: "s",
      kind: "k",
      occurred_at: "2026-06-20T12:00:00.000Z",
      recorded_at: "2026-06-20T12:00:01.000Z",
      device_id: "d",
      device_seq: "42",
      payload: {},
    });

    expect(mapped.deviceSeq).toBe(42);
    expect(typeof mapped.deviceSeq).toBe("number");
  });

  it("defaults a null payload to an empty object", async () => {
    const { mapEvent } = await import("@/lib/db/events");

    const mapped = mapEvent({
      event_uid: "u",
      stream_key: "s",
      kind: "k",
      occurred_at: "2026-06-20T12:00:00.000Z",
      recorded_at: "2026-06-20T12:00:01.000Z",
      device_id: "d",
      device_seq: 1,
      payload: null,
    });

    expect(mapped.payload).toEqual({});
  });
});

// ----- getEventStream -------------------------------------------------------

describe("getEventStream", () => {
  it("queries lot_event for the stream, ordered, and maps rows to LotEvent[]", async () => {
    const { client, calls } = makeClient({
      data: [
        {
          event_uid: "u1",
          stream_key: "JC-700",
          kind: "cherry_intake",
          occurred_at: "2026-06-20T12:00:00.000Z",
          recorded_at: "2026-06-20T12:00:01.000Z",
          device_id: "device-A",
          device_seq: 1,
          payload: { cherries_kg: 120 },
        },
        {
          event_uid: "u2",
          stream_key: "JC-700",
          kind: "stage_advance",
          occurred_at: "2026-06-20T13:00:00.000Z",
          recorded_at: "2026-06-20T13:00:01.000Z",
          device_id: "device-A",
          device_seq: 2,
          payload: { to_stage: "fermentation" },
        },
      ],
      error: null,
    });
    getSupabaseMock.mockReturnValue(client);

    const { getEventStream } = await import("@/lib/db/events");
    const events = await getEventStream("JC-700");

    expect(calls.from).toBe("lot_event");
    // filtered by the stream key
    expect(calls.eqArgs).toContainEqual(["stream_key", "JC-700"]);
    // ordered by device_seq (the per-stream monotonic order), then recorded_at
    expect(calls.orderArgs[0][0]).toBe("device_seq");
    expect(calls.orderArgs).toContainEqual([
      "recorded_at",
      expect.anything(),
    ]);

    expect(events).toEqual([
      {
        id: "u1",
        streamKey: "JC-700",
        kind: "cherry_intake",
        occurredAt: "2026-06-20T12:00:00.000Z",
        recordedAt: "2026-06-20T12:00:01.000Z",
        deviceId: "device-A",
        deviceSeq: 1,
        payload: { cherries_kg: 120 },
      },
      {
        id: "u2",
        streamKey: "JC-700",
        kind: "stage_advance",
        occurredAt: "2026-06-20T13:00:00.000Z",
        recordedAt: "2026-06-20T13:00:01.000Z",
        deviceId: "device-A",
        deviceSeq: 2,
        payload: { to_stage: "fermentation" },
      },
    ]);
  });

  it("throws a labelled error when the query fails", async () => {
    getSupabaseMock.mockReturnValue(makeClientWithError("boom").client);

    const { getEventStream } = await import("@/lib/db/events");
    await expect(getEventStream("JC-700")).rejects.toThrow(
      "getEventStream: boom",
    );
  });
});

// ----- verifyStream (RPC) ---------------------------------------------------

describe("verifyStream", () => {
  it("calls verify_chain with the stream key and returns its boolean", async () => {
    const { client, calls } = makeClient<boolean>({ data: true, error: null });
    getSupabaseMock.mockReturnValue(client);

    const { verifyStream } = await import("@/lib/db/events");
    const ok = await verifyStream("JC-700");

    expect(calls.rpcName).toBe("verify_chain");
    expect(calls.rpcArgs).toEqual({ stream_key: "JC-700" });
    expect(ok).toBe(true);
  });

  it("returns false for a tampered/broken chain", async () => {
    const { client } = makeClient<boolean>({ data: false, error: null });
    getSupabaseMock.mockReturnValue(client);

    const { verifyStream } = await import("@/lib/db/events");
    expect(await verifyStream("JC-700")).toBe(false);
  });

  it("throws a labelled error when the RPC fails", async () => {
    getSupabaseMock.mockReturnValue(makeClientWithError("rpc-boom").client);

    const { verifyStream } = await import("@/lib/db/events");
    await expect(verifyStream("JC-700")).rejects.toThrow(
      "verifyStream: rpc-boom",
    );
  });
});

// helper: a client whose chain + rpc both resolve to an error result.
function makeClientWithError(message: string) {
  const result = { data: null, error: { message } };
  const builder = {
    from: vi.fn(() => builder),
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    then: (
      onFulfilled: (value: typeof result) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  const client = {
    from: () => builder,
    rpc: vi.fn(() => Promise.resolve(result)),
  };
  return { client };
}
