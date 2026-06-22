import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Direct coverage of the people read-port (`src/lib/db/people.ts`) — the P2-S1
 * crew + worker system-of-record read surface.
 *
 * Mirrors the strategy in events.test.ts: mock `@/lib/supabase/server` so
 * `getSupabase()` returns a chainable, thenable query-builder stub recording
 * from/select/eq/order calls and resolving to a configured `{ data, error }`.
 * `.rpc` is recorded separately (the chain-verified badge's source of truth).
 *
 * Pins, against the FROZEN DB contract (v_crew_roster / worker_attendance_today /
 * v_worker_certs_valid views + attendance_event / por_obra_contracts /
 * worker_certifications / worker_stream_event tables + the verify_chain RPC):
 *   - mapCrewRosterRow: pure snake_case → camelCase domain mapper.
 *   - getCrewRoster / getAttendanceToday / getWorkerAttendanceTimeline /
 *     getWorkerPorObraHistory / getWorkerCertsValid / getWorkerStream: query the
 *     right relation, filter/order per the contract, and map rows.
 *   - verifyAttendanceChain: calls the stream-aware verify_chain with the
 *     'attendance:<id>' stream key — the 'attendance:' prefix is the load-bearing
 *     token that routes the verifier to attendance_event (the badge's ledger),
 *     not lot_event — and returns its boolean.
 *
 * Unit tests over the port's public surface — no real DB. The SQL of the views,
 * tables, and verify_chain is pinned by the db-suite; this file pins the
 * TypeScript seam.
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

// ----- mapCrewRosterRow (pure) ----------------------------------------------

describe("mapCrewRosterRow", () => {
  it("maps a snake_case v_crew_roster row to a camelCase CrewRosterMember", async () => {
    const { mapCrewRosterRow } = await import("@/lib/db/people");

    const row = {
      worker_id: "W-001",
      name: "Aracelys Quintero",
      role: "Picker",
      crew_name: "Crew Alpha",
      crew_id: "C-1",
      attendance: "present",
      preferred_name: "Ara",
      comarca_origin: "Ngäbe-Buglé",
      languages: ["es", "ngäbere"],
      rehire_eligible: true,
    };

    expect(mapCrewRosterRow(row)).toEqual({
      workerId: "W-001",
      name: "Aracelys Quintero",
      role: "Picker",
      crewName: "Crew Alpha",
      crewId: "C-1",
      attendance: "present",
      preferredName: "Ara",
      comarcaOrigin: "Ngäbe-Buglé",
      languages: ["es", "ngäbere"],
      rehireEligible: true,
    });
  });

  it("passes through null crew_id / preferred_name / comarca_origin", async () => {
    const { mapCrewRosterRow } = await import("@/lib/db/people");

    const mapped = mapCrewRosterRow({
      worker_id: "W-002",
      name: "Solo Worker",
      role: "Mill",
      crew_name: "Unassigned",
      crew_id: null,
      attendance: "absent",
      preferred_name: null,
      comarca_origin: null,
      languages: ["es"],
      rehire_eligible: false,
    });

    expect(mapped.crewId).toBeNull();
    expect(mapped.preferredName).toBeNull();
    expect(mapped.comarcaOrigin).toBeNull();
    expect(mapped.rehireEligible).toBe(false);
  });

  it("defaults a null/absent languages array to []", async () => {
    const { mapCrewRosterRow } = await import("@/lib/db/people");

    const mapped = mapCrewRosterRow({
      worker_id: "W-003",
      name: "No Langs",
      role: "Picker",
      crew_name: "Crew Beta",
      crew_id: "C-2",
      attendance: "present",
      preferred_name: null,
      comarca_origin: null,
      languages: null as unknown as string[],
      rehire_eligible: true,
    });

    expect(mapped.languages).toEqual([]);
  });
});

// ----- getCrewRoster --------------------------------------------------------

describe("getCrewRoster", () => {
  it("reads v_crew_roster ordered by worker_id and maps rows", async () => {
    const { client, calls } = makeClient({
      data: [
        {
          worker_id: "W-001",
          name: "Aracelys Quintero",
          role: "Picker",
          crew_name: "Crew Alpha",
          crew_id: "C-1",
          attendance: "present",
          preferred_name: "Ara",
          comarca_origin: "Ngäbe-Buglé",
          languages: ["es", "ngäbere"],
          rehire_eligible: true,
        },
      ],
      error: null,
    });
    getSupabaseMock.mockReturnValue(client);

    const { getCrewRoster } = await import("@/lib/db/people");
    const roster = await getCrewRoster();

    expect(calls.from).toBe("v_crew_roster");
    expect(calls.orderArgs[0][0]).toBe("worker_id");
    expect(roster).toEqual([
      {
        workerId: "W-001",
        name: "Aracelys Quintero",
        role: "Picker",
        crewName: "Crew Alpha",
        crewId: "C-1",
        attendance: "present",
        preferredName: "Ara",
        comarcaOrigin: "Ngäbe-Buglé",
        languages: ["es", "ngäbere"],
        rehireEligible: true,
      },
    ]);
  });

  it("throws a labelled error when the query fails", async () => {
    getSupabaseMock.mockReturnValue(makeClientWithError("boom").client);

    const { getCrewRoster } = await import("@/lib/db/people");
    await expect(getCrewRoster()).rejects.toThrow("getCrewRoster: boom");
  });
});

// ----- getAttendanceToday ---------------------------------------------------

describe("getAttendanceToday", () => {
  it("reads worker_attendance_today and maps rows", async () => {
    const { client, calls } = makeClient({
      data: [
        {
          worker_id: "W-001",
          crew_id: "C-1",
          event_kind: "clock-in",
          plot_id: "P-9",
          occurred_at: "2026-06-21T11:00:00.000Z",
        },
        {
          worker_id: "W-002",
          crew_id: null,
          event_kind: "rest-day",
          plot_id: null,
          occurred_at: "2026-06-21T06:00:00.000Z",
        },
      ],
      error: null,
    });
    getSupabaseMock.mockReturnValue(client);

    const { getAttendanceToday } = await import("@/lib/db/people");
    const rows = await getAttendanceToday();

    expect(calls.from).toBe("worker_attendance_today");
    expect(rows).toEqual([
      {
        workerId: "W-001",
        crewId: "C-1",
        eventKind: "clock-in",
        plotId: "P-9",
        occurredAt: "2026-06-21T11:00:00.000Z",
      },
      {
        workerId: "W-002",
        crewId: null,
        eventKind: "rest-day",
        plotId: null,
        occurredAt: "2026-06-21T06:00:00.000Z",
      },
    ]);
  });

  it("throws a labelled error when the query fails", async () => {
    getSupabaseMock.mockReturnValue(makeClientWithError("boom").client);

    const { getAttendanceToday } = await import("@/lib/db/people");
    await expect(getAttendanceToday()).rejects.toThrow(
      "getAttendanceToday: boom",
    );
  });
});

// ----- getWorkerAttendanceTimeline ------------------------------------------

describe("getWorkerAttendanceTimeline", () => {
  it("reads attendance_event filtered by worker_id, ordered occurred_at desc, maps rows", async () => {
    const { client, calls } = makeClient({
      data: [
        {
          event_uid: "ae-2",
          worker_id: "W-001",
          crew_id: "C-1",
          event_kind: "clock-out",
          plot_id: "P-9",
          occurred_at: "2026-06-21T20:00:00.000Z",
          recorded_at: "2026-06-21T20:00:01.000Z",
          device_id: "device-A",
          device_seq: 2,
        },
        {
          event_uid: "ae-1",
          worker_id: "W-001",
          crew_id: "C-1",
          event_kind: "clock-in",
          plot_id: "P-9",
          occurred_at: "2026-06-21T11:00:00.000Z",
          recorded_at: "2026-06-21T11:00:01.000Z",
          device_id: "device-A",
          device_seq: "1",
        },
      ],
      error: null,
    });
    getSupabaseMock.mockReturnValue(client);

    const { getWorkerAttendanceTimeline } = await import("@/lib/db/people");
    const timeline = await getWorkerAttendanceTimeline("W-001");

    expect(calls.from).toBe("attendance_event");
    expect(calls.eqArgs).toContainEqual(["worker_id", "W-001"]);
    expect(calls.orderArgs[0][0]).toBe("occurred_at");
    expect(calls.orderArgs[0][1]).toEqual({ ascending: false });

    expect(timeline).toEqual([
      {
        eventUid: "ae-2",
        workerId: "W-001",
        crewId: "C-1",
        eventKind: "clock-out",
        plotId: "P-9",
        occurredAt: "2026-06-21T20:00:00.000Z",
        recordedAt: "2026-06-21T20:00:01.000Z",
        deviceId: "device-A",
        deviceSeq: 2,
      },
      {
        eventUid: "ae-1",
        workerId: "W-001",
        crewId: "C-1",
        eventKind: "clock-in",
        plotId: "P-9",
        occurredAt: "2026-06-21T11:00:00.000Z",
        recordedAt: "2026-06-21T11:00:01.000Z",
        deviceId: "device-A",
        deviceSeq: 1,
      },
    ]);
  });

  it("coerces a string device_seq to a number", async () => {
    const { client } = makeClient({
      data: [
        {
          event_uid: "ae-1",
          worker_id: "W-001",
          crew_id: null,
          event_kind: "absent",
          plot_id: null,
          occurred_at: "2026-06-21T11:00:00.000Z",
          recorded_at: "2026-06-21T11:00:01.000Z",
          device_id: "device-A",
          device_seq: "42",
        },
      ],
      error: null,
    });
    getSupabaseMock.mockReturnValue(client);

    const { getWorkerAttendanceTimeline } = await import("@/lib/db/people");
    const [row] = await getWorkerAttendanceTimeline("W-001");

    expect(row.deviceSeq).toBe(42);
    expect(typeof row.deviceSeq).toBe("number");
  });

  it("throws a labelled error when the query fails", async () => {
    getSupabaseMock.mockReturnValue(makeClientWithError("boom").client);

    const { getWorkerAttendanceTimeline } = await import("@/lib/db/people");
    await expect(getWorkerAttendanceTimeline("W-001")).rejects.toThrow(
      "getWorkerAttendanceTimeline: boom",
    );
  });
});

// ----- getWorkerPorObraHistory ----------------------------------------------

describe("getWorkerPorObraHistory", () => {
  it("reads por_obra_contracts filtered by worker_id, ordered effective_from desc, maps rows", async () => {
    const { client, calls } = makeClient({
      data: [
        {
          id: 2,
          worker_id: "W-001",
          task_kind: "harvest",
          rate_basis: "per-lata",
          rate_usd: "3.50",
          effective_from: "2026-06-01",
          effective_to: null,
          signed_at: "2026-05-30T12:00:00.000Z",
          signature_ref: "sig-2",
          superseded_by: null,
        },
        {
          id: 1,
          worker_id: "W-001",
          task_kind: "harvest",
          rate_basis: "per-lata",
          rate_usd: "3.00",
          effective_from: "2025-11-01",
          effective_to: "2026-05-31",
          signed_at: "2025-10-30T12:00:00.000Z",
          signature_ref: null,
          superseded_by: 2,
        },
      ],
      error: null,
    });
    getSupabaseMock.mockReturnValue(client);

    const { getWorkerPorObraHistory } = await import("@/lib/db/people");
    const history = await getWorkerPorObraHistory("W-001");

    expect(calls.from).toBe("por_obra_contracts");
    expect(calls.eqArgs).toContainEqual(["worker_id", "W-001"]);
    expect(calls.orderArgs[0][0]).toBe("effective_from");
    expect(calls.orderArgs[0][1]).toEqual({ ascending: false });

    expect(history).toEqual([
      {
        id: 2,
        workerId: "W-001",
        taskKind: "harvest",
        rateBasis: "per-lata",
        rateUsd: 3.5,
        effectiveFrom: "2026-06-01",
        effectiveTo: null,
        signedAt: "2026-05-30T12:00:00.000Z",
        signatureRef: "sig-2",
        supersededBy: null,
      },
      {
        id: 1,
        workerId: "W-001",
        taskKind: "harvest",
        rateBasis: "per-lata",
        rateUsd: 3,
        effectiveFrom: "2025-11-01",
        effectiveTo: "2026-05-31",
        signedAt: "2025-10-30T12:00:00.000Z",
        signatureRef: null,
        supersededBy: 2,
      },
    ]);
  });

  it("coerces a string rate_usd to a number", async () => {
    const { client } = makeClient({
      data: [
        {
          id: 1,
          worker_id: "W-001",
          task_kind: "harvest",
          rate_basis: "per-kg",
          rate_usd: "0.85",
          effective_from: "2026-06-01",
          effective_to: null,
          signed_at: "2026-05-30T12:00:00.000Z",
          signature_ref: null,
          superseded_by: null,
        },
      ],
      error: null,
    });
    getSupabaseMock.mockReturnValue(client);

    const { getWorkerPorObraHistory } = await import("@/lib/db/people");
    const [row] = await getWorkerPorObraHistory("W-001");

    expect(row.rateUsd).toBe(0.85);
    expect(typeof row.rateUsd).toBe("number");
  });

  it("throws a labelled error when the query fails", async () => {
    getSupabaseMock.mockReturnValue(makeClientWithError("boom").client);

    const { getWorkerPorObraHistory } = await import("@/lib/db/people");
    await expect(getWorkerPorObraHistory("W-001")).rejects.toThrow(
      "getWorkerPorObraHistory: boom",
    );
  });
});

// ----- getWorkerCertsValid --------------------------------------------------

describe("getWorkerCertsValid", () => {
  it("reads v_worker_certs_valid filtered by worker_id and maps rows", async () => {
    const { client, calls } = makeClient({
      data: [
        {
          worker_id: "W-001",
          cert_kind: "pesticide-handling",
          issued_at: "2026-01-15",
          expires_at: "2027-01-15",
          issuer: "MIDA",
        },
        {
          worker_id: "W-001",
          cert_kind: "first-aid",
          issued_at: "2025-09-01",
          expires_at: null,
          issuer: null,
        },
      ],
      error: null,
    });
    getSupabaseMock.mockReturnValue(client);

    const { getWorkerCertsValid } = await import("@/lib/db/people");
    const certs = await getWorkerCertsValid("W-001");

    expect(calls.from).toBe("v_worker_certs_valid");
    expect(calls.eqArgs).toContainEqual(["worker_id", "W-001"]);
    expect(certs).toEqual([
      {
        workerId: "W-001",
        certKind: "pesticide-handling",
        issuedAt: "2026-01-15",
        expiresAt: "2027-01-15",
        issuer: "MIDA",
      },
      {
        workerId: "W-001",
        certKind: "first-aid",
        issuedAt: "2025-09-01",
        expiresAt: null,
        issuer: null,
      },
    ]);
  });

  it("throws a labelled error when the query fails", async () => {
    getSupabaseMock.mockReturnValue(makeClientWithError("boom").client);

    const { getWorkerCertsValid } = await import("@/lib/db/people");
    await expect(getWorkerCertsValid("W-001")).rejects.toThrow(
      "getWorkerCertsValid: boom",
    );
  });
});

// ----- getWorkerStream ------------------------------------------------------

describe("getWorkerStream", () => {
  it("reads worker_stream_event filtered by the worker stream key, ordered device_seq, maps rows", async () => {
    const { client, calls } = makeClient({
      data: [
        {
          event_uid: "ws-1",
          stream_key: "worker:W-001",
          kind: "hired",
          payload: { role: "Picker" },
          occurred_at: "2025-01-01T12:00:00.000Z",
          recorded_at: "2025-01-01T12:00:01.000Z",
          device_id: "device-A",
          device_seq: 1,
        },
        {
          event_uid: "ws-2",
          stream_key: "worker:W-001",
          kind: "cert-added",
          payload: null,
          occurred_at: "2026-01-15T12:00:00.000Z",
          recorded_at: "2026-01-15T12:00:01.000Z",
          device_id: "device-A",
          device_seq: "2",
        },
      ],
      error: null,
    });
    getSupabaseMock.mockReturnValue(client);

    const { getWorkerStream } = await import("@/lib/db/people");
    const stream = await getWorkerStream("W-001");

    expect(calls.from).toBe("worker_stream_event");
    expect(calls.eqArgs).toContainEqual(["stream_key", "worker:W-001"]);
    expect(calls.orderArgs[0][0]).toBe("device_seq");

    expect(stream).toEqual([
      {
        eventUid: "ws-1",
        streamKey: "worker:W-001",
        kind: "hired",
        payload: { role: "Picker" },
        occurredAt: "2025-01-01T12:00:00.000Z",
        recordedAt: "2025-01-01T12:00:01.000Z",
        deviceId: "device-A",
        deviceSeq: 1,
      },
      {
        eventUid: "ws-2",
        streamKey: "worker:W-001",
        kind: "cert-added",
        payload: {},
        occurredAt: "2026-01-15T12:00:00.000Z",
        recordedAt: "2026-01-15T12:00:01.000Z",
        deviceId: "device-A",
        deviceSeq: 2,
      },
    ]);
  });

  it("throws a labelled error when the query fails", async () => {
    getSupabaseMock.mockReturnValue(makeClientWithError("boom").client);

    const { getWorkerStream } = await import("@/lib/db/people");
    await expect(getWorkerStream("W-001")).rejects.toThrow(
      "getWorkerStream: boom",
    );
  });
});

// ----- verifyAttendanceChain (RPC) ------------------------------------------

describe("verifyAttendanceChain", () => {
  it("calls verify_chain with the attendance stream key and returns its boolean", async () => {
    const { client, calls } = makeClient<boolean>({ data: true, error: null });
    getSupabaseMock.mockReturnValue(client);

    const { verifyAttendanceChain } = await import("@/lib/db/people");
    const ok = await verifyAttendanceChain("W-001");

    expect(calls.rpcName).toBe("verify_chain");
    expect(calls.rpcArgs).toEqual({ stream_key: "attendance:W-001" });
    expect(ok).toBe(true);
  });

  it("returns false for a tampered/broken chain", async () => {
    const { client } = makeClient<boolean>({ data: false, error: null });
    getSupabaseMock.mockReturnValue(client);

    const { verifyAttendanceChain } = await import("@/lib/db/people");
    expect(await verifyAttendanceChain("W-001")).toBe(false);
  });

  it("throws a labelled error when the RPC fails", async () => {
    getSupabaseMock.mockReturnValue(makeClientWithError("rpc-boom").client);

    const { verifyAttendanceChain } = await import("@/lib/db/people");
    await expect(verifyAttendanceChain("W-001")).rejects.toThrow(
      "verifyAttendanceChain: rpc-boom",
    );
  });

  // REGRESSION (review HIGH idx 153, test-efficacy): the chain-verified badge's
  // trust depends entirely on the RPC routing to the ATTENDANCE ledger. The
  // original Phase-1 verify_chain iterated only lot_event, so verify_chain(
  // 'attendance:<id>') found zero rows and returned a vacuous `true` — the badge
  // was permanently green and verified nothing. The DB suite now proves the SQL
  // is stream-aware (p2s1_people.db.test.ts); THIS seam test must pin the TS side
  // so a future refactor cannot silently re-point the badge at the wrong stream
  // (the exact failure mode) and still pass. We lock the load-bearing routing
  // token explicitly: the single arg is `stream_key`, it carries the
  // `attendance:` prefix that selects attendance_event (NOT the bare id, NOT the
  // `worker:`/lot stream), and it embeds the worker id verbatim.
  it("routes to the stream-aware verify_chain via the load-bearing 'attendance:' stream key", async () => {
    const { client, calls } = makeClient<boolean>({ data: true, error: null });
    getSupabaseMock.mockReturnValue(client);

    const { verifyAttendanceChain } = await import("@/lib/db/people");
    await verifyAttendanceChain("W-042");

    // Names the stream-aware verifier — not a bespoke per-worker RPC.
    expect(calls.rpcName).toBe("verify_chain");

    // Exactly one arg, keyed `stream_key` — the prefix is what drives the SQL's
    // table branch, so the key must be present and unique.
    expect(Object.keys(calls.rpcArgs ?? {})).toEqual(["stream_key"]);

    const streamKey = (calls.rpcArgs as { stream_key: string }).stream_key;
    // The 'attendance:' prefix routes verify_chain to attendance_event. Dropping
    // it (bare id) or using 'worker:'/a lot stream would verify the WRONG ledger
    // and re-introduce the vacuous-green badge — assert it can never regress to that.
    expect(streamKey.startsWith("attendance:")).toBe(true);
    expect(streamKey.startsWith("worker:")).toBe(false);
    // Carries the worker id verbatim so each worker's own ledger is verified.
    expect(streamKey).toBe("attendance:W-042");
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
