import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behaviour test for the P2-S1 crew Server Actions — the first WRITES the family
 * makes against the crew system-of-record from the UI (attendance, crew
 * enrollment, por-obra contracts, certifications, rehires). Server Actions are
 * the driving port (ADR-002 — only ever invoked by an authenticated human
 * submitting a form), so each action builds the offline-ready event envelope
 * server-side (D5: synthetic `device_id:"server"`, `device_seq:0`, an
 * `occurred_at` fallback to now, and a minted `idempotency_key`) and delegates to
 * its already-tested command port.
 *
 * Drives each action with a `FormData` payload against a mocked Supabase client +
 * a mocked `revalidatePath`, proving for every action:
 *   - a validation failure (the command rejects bad input app-side) returns an
 *     `error` state WITHOUT the RPC being called and WITHOUT revalidating,
 *   - the happy path calls the RPC exactly once with the snake_case envelope the
 *     SECURITY DEFINER RPC expects, returns a `success` state, and revalidates,
 *   - a labelled DB error surfaces as a CLEAN `error` state.
 *
 * Mirrors the supabase-server mock idiom in
 * src/app/(app)/costing/__tests__/actions.test.ts.
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
  enrollCrewMemberAction,
  recordAttendanceAction,
  recordCertificationAction,
  rehireWorkerAction,
  signPorObraAction,
} from "@/app/(app)/crew/actions";

/** Build a FormData from a plain record (the shape an action's form submits). */
function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/**
 * A Supabase-client stand-in. The device-bearing actions draw a unique server
 * device_seq via `.rpc("next_server_seq")` (the C1 collision fix) BEFORE the command
 * rpc, so the stub dispatches by name: `next_server_seq` → a monotonic integer; every
 * other rpc → the configured `{ data, error }` (default a uuid-ish id). A `cmd` helper
 * isolates the COMMAND call from the seq draw for the envelope assertions.
 */
function makeClient(opts?: {
  data?: unknown;
  error?: { message: string } | null;
}): {
  client: unknown;
  rpc: ReturnType<typeof vi.fn>;
  /** The command rpc calls (excludes the next_server_seq draw). */
  cmd: () => Array<[string, Record<string, unknown>]>;
} {
  let seq = 100;
  const rpc = vi.fn((name: string, args?: Record<string, unknown>) => {
    void args;
    if (name === "next_server_seq") {
      return Promise.resolve({ data: seq++, error: null });
    }
    return Promise.resolve({
      data: opts?.data ?? "evt-uuid-1",
      error: opts?.error ?? null,
    });
  });
  const cmd = (): Array<[string, Record<string, unknown>]> =>
    rpc.mock.calls
      .filter((c) => c[0] !== "next_server_seq")
      .map((c) => [c[0], (c[1] ?? {}) as Record<string, unknown>]);
  return { client: { rpc }, rpc, cmd };
}

beforeEach(() => {
  getSupabaseMock.mockReset();
  revalidatePathMock.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("recordAttendanceAction", () => {
  it("rejects a missing worker WITHOUT a write round-trip", async () => {
    const { client, cmd } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await recordAttendanceAction(
      form({ eventKind: "clock-in", occurredAt: "2026-06-20T14:00:00.000Z" }),
    );

    expect(result.status).toBe("error");
    // the COMMAND rpc never fires on bad input (the harmless seq draw may pre-run).
    expect(cmd()).toHaveLength(0);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown event kind WITHOUT a write round-trip", async () => {
    const { client, cmd } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await recordAttendanceAction(
      form({
        workerId: "w-1",
        eventKind: "teleport",
        occurredAt: "2026-06-20T14:00:00.000Z",
      }),
    );

    expect(result.status).toBe("error");
    expect(cmd()).toHaveLength(0);
  });

  it("records attendance with the synthetic server envelope and revalidates", async () => {
    const { client, cmd } = makeClient({ data: "evt-att-1" });
    getSupabaseMock.mockReturnValue(client);

    const result = await recordAttendanceAction(
      form({
        workerId: "w-1",
        eventKind: "clock-in",
        plotId: "plot-7",
        occurredAt: "2026-06-20T14:00:00.000Z",
        idempotencyKey: "idem-att-1",
      }),
    );

    expect(result.status).toBe("success");
    expect(cmd()).toHaveLength(1); // the command rpc fires exactly once
    const [name, args] = cmd()[0];
    expect(name).toBe("record_attendance");
    expect(args.p_worker_id).toBe("w-1");
    expect(args.p_event_kind).toBe("clock-in");
    expect(args.p_plot_id).toBe("plot-7");
    expect(args.p_occurred_at).toBe("2026-06-20T14:00:00.000Z");
    expect(args.p_device_id).toBe("server");
    // device_seq is a UNIQUE monotonic draw (the C1 fix) — never the constant 0.
    expect(typeof args.p_device_seq).toBe("number");
    expect(args.p_device_seq).toBeGreaterThan(0);
    expect(args.p_idempotency_key).toBe("idem-att-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/crew");
  });

  it("mints an occurredAt fallback and idempotencyKey when the form omits them", async () => {
    const { client, cmd } = makeClient({ data: "evt-att-2" });
    getSupabaseMock.mockReturnValue(client);

    const result = await recordAttendanceAction(
      form({ workerId: "w-1", eventKind: "clock-out" }),
    );

    expect(result.status).toBe("success");
    const args = cmd()[0][1];
    // a plot-less event passes a null plot id
    expect(args.p_plot_id).toBeNull();
    // occurred_at fell back to a real ISO timestamp
    expect(typeof args.p_occurred_at).toBe("string");
    expect(Number.isFinite(Date.parse(args.p_occurred_at as string))).toBe(true);
    // a fresh idempotency key was minted (non-empty)
    expect(typeof args.p_idempotency_key).toBe("string");
    expect((args.p_idempotency_key as string).length).toBeGreaterThan(0);
    expect(args.p_device_id).toBe("server");
    expect(typeof args.p_device_seq).toBe("number");
  });

  it("surfaces a labelled DB error as a CLEAN error state (no revalidate)", async () => {
    const { client } = makeClient({
      data: null,
      error: { message: "out-of-order device_seq" },
    });
    getSupabaseMock.mockReturnValue(client);

    const result = await recordAttendanceAction(
      form({
        workerId: "w-1",
        eventKind: "clock-in",
        occurredAt: "2026-06-20T14:00:00.000Z",
      }),
    );

    expect(result.status).toBe("error");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("enrollCrewMemberAction", () => {
  it("rejects a missing crew WITHOUT a write round-trip", async () => {
    const { client, cmd } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await enrollCrewMemberAction(
      form({ workerId: "w-1", occurredAt: "2026-06-20T14:00:00.000Z" }),
    );

    expect(result.status).toBe("error");
    expect(cmd()).toHaveLength(0);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("enrolls a worker with the snake_case envelope and revalidates", async () => {
    const { client, cmd } = makeClient({ data: "evt-enr-1" });
    getSupabaseMock.mockReturnValue(client);

    const result = await enrollCrewMemberAction(
      form({
        workerId: "w-1",
        crewId: "crew-norte",
        occurredAt: "2026-06-20T14:00:00.000Z",
        idempotencyKey: "idem-enr-1",
      }),
    );

    expect(result.status).toBe("success");
    expect(cmd()).toHaveLength(1);
    const [name, args] = cmd()[0];
    expect(name).toBe("enroll_crew_member");
    expect(args.p_worker_id).toBe("w-1");
    expect(args.p_crew_id).toBe("crew-norte");
    expect(args.p_occurred_at).toBe("2026-06-20T14:00:00.000Z");
    expect(args.p_device_id).toBe("server");
    expect(typeof args.p_device_seq).toBe("number");
    expect(args.p_device_seq).toBeGreaterThan(0);
    expect(args.p_idempotency_key).toBe("idem-enr-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/crew");
  });

  it("surfaces a labelled DB error as a CLEAN error state (no revalidate)", async () => {
    const { client } = makeClient({
      data: null,
      error: { message: "already enrolled" },
    });
    getSupabaseMock.mockReturnValue(client);

    const result = await enrollCrewMemberAction(
      form({
        workerId: "w-1",
        crewId: "crew-norte",
        occurredAt: "2026-06-20T14:00:00.000Z",
      }),
    );

    expect(result.status).toBe("error");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("signPorObraAction", () => {
  it("rejects an unknown rate basis WITHOUT a round-trip", async () => {
    const { client, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await signPorObraAction(
      form({
        workerId: "w-1",
        taskKind: "picking",
        rateBasis: "per-galaxy",
        rateUsd: "0.50",
        effectiveFrom: "2026-06-20",
      }),
    );

    expect(result.status).toBe("error");
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("signs a contract with the snake_case envelope (no device cols) and revalidates", async () => {
    const { client, rpc } = makeClient({ data: 4242 });
    getSupabaseMock.mockReturnValue(client);

    const result = await signPorObraAction(
      form({
        workerId: "w-1",
        taskKind: "picking",
        rateBasis: "per-lata",
        rateUsd: "0.50",
        effectiveFrom: "2026-06-20",
        effectiveTo: "2026-12-31",
        signatureRef: "sig-7",
        idempotencyKey: "idem-por-1",
      }),
    );

    expect(result.status).toBe("success");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("sign_por_obra_contract", {
      p_worker_id: "w-1",
      p_task_kind: "picking",
      p_rate_basis: "per-lata",
      p_rate_usd: 0.5,
      p_effective_from: "2026-06-20",
      p_effective_to: "2026-12-31",
      p_signature_ref: "sig-7",
      p_idempotency_key: "idem-por-1",
    });
    // signPorObra takes NO device columns
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args).not.toHaveProperty("p_device_id");
    expect(args).not.toHaveProperty("p_device_seq");
    expect(revalidatePathMock).toHaveBeenCalledWith("/crew");
  });

  it("surfaces a labelled DB error as a CLEAN error state (no revalidate)", async () => {
    const { client } = makeClient({
      data: null,
      error: { message: "overlapping contract" },
    });
    getSupabaseMock.mockReturnValue(client);

    const result = await signPorObraAction(
      form({
        workerId: "w-1",
        taskKind: "picking",
        rateBasis: "per-lata",
        rateUsd: "0.50",
        effectiveFrom: "2026-06-20",
      }),
    );

    expect(result.status).toBe("error");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("recordCertificationAction", () => {
  it("rejects a missing cert kind WITHOUT a round-trip", async () => {
    const { client, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await recordCertificationAction(
      form({ workerId: "w-1", issuedAt: "2026-06-20" }),
    );

    expect(result.status).toBe("error");
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("records a certification with the snake_case envelope (no device cols) and revalidates", async () => {
    const { client, rpc } = makeClient({ data: 99 });
    getSupabaseMock.mockReturnValue(client);

    const result = await recordCertificationAction(
      form({
        workerId: "w-1",
        certKind: "pesticide-handling",
        issuedAt: "2026-06-20",
        expiresAt: "2027-06-20",
        issuer: "MIDA",
        docRef: "doc-7",
        idempotencyKey: "idem-cert-1",
      }),
    );

    expect(result.status).toBe("success");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_certification", {
      p_worker_id: "w-1",
      p_cert_kind: "pesticide-handling",
      p_issued_at: "2026-06-20",
      p_expires_at: "2027-06-20",
      p_issuer: "MIDA",
      p_doc_ref: "doc-7",
      p_idempotency_key: "idem-cert-1",
    });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args).not.toHaveProperty("p_device_id");
    expect(args).not.toHaveProperty("p_device_seq");
    expect(revalidatePathMock).toHaveBeenCalledWith("/crew");
  });

  it("surfaces a labelled DB error as a CLEAN error state (no revalidate)", async () => {
    const { client } = makeClient({
      data: null,
      error: { message: "bad cert" },
    });
    getSupabaseMock.mockReturnValue(client);

    const result = await recordCertificationAction(
      form({
        workerId: "w-1",
        certKind: "pesticide-handling",
        issuedAt: "2026-06-20",
      }),
    );

    expect(result.status).toBe("error");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("rehireWorkerAction", () => {
  it("rejects a missing season WITHOUT a write round-trip", async () => {
    const { client, cmd } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await rehireWorkerAction(
      form({
        workerId: "w-1",
        crewId: "crew-norte",
        occurredAt: "2026-06-20T14:00:00.000Z",
      }),
    );

    expect(result.status).toBe("error");
    expect(cmd()).toHaveLength(0);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rehires a worker with the synthetic server envelope and revalidates", async () => {
    const { client, cmd } = makeClient({ data: "evt-reh-1" });
    getSupabaseMock.mockReturnValue(client);

    const result = await rehireWorkerAction(
      form({
        workerId: "w-1",
        crewId: "crew-norte",
        season: "2026-2027",
        occurredAt: "2026-06-20T14:00:00.000Z",
        idempotencyKey: "idem-reh-1",
      }),
    );

    expect(result.status).toBe("success");
    expect(cmd()).toHaveLength(1);
    const [name, args] = cmd()[0];
    expect(name).toBe("rehire_worker");
    expect(args.p_worker_id).toBe("w-1");
    expect(args.p_crew_id).toBe("crew-norte");
    expect(args.p_season).toBe("2026-2027");
    expect(args.p_occurred_at).toBe("2026-06-20T14:00:00.000Z");
    expect(args.p_device_id).toBe("server");
    expect(typeof args.p_device_seq).toBe("number");
    expect(args.p_device_seq).toBeGreaterThan(0);
    expect(args.p_idempotency_key).toBe("idem-reh-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/crew");
  });

  it("surfaces a labelled DB error as a CLEAN error state (no revalidate)", async () => {
    const { client } = makeClient({
      data: null,
      error: { message: "already active" },
    });
    getSupabaseMock.mockReturnValue(client);

    const result = await rehireWorkerAction(
      form({
        workerId: "w-1",
        crewId: "crew-norte",
        season: "2026-2027",
        occurredAt: "2026-06-20T14:00:00.000Z",
      }),
    );

    expect(result.status).toBe("error");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
