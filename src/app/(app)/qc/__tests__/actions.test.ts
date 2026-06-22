import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behaviour test for the P2-S6 QC & cupping Server Actions — the cup-protection
 * TEETH the family wields from the UI (place/release a QC-hold, open a cupping
 * session). Server Actions are the driving port (ADR-002 — only ever invoked by an
 * authenticated human submitting a form), so each INSERT-backed action builds the
 * offline-ready event envelope server-side and delegates to its already-tested
 * command port, whose single write door is its SECURITY DEFINER RPC.
 *
 * The load-bearing assertion is the C1 collision guard: every QC table carries
 * `unique (device_id, device_seq)`, and the single synthetic online device is
 * `device_id:"server"`. If the actions hardcode a CONSTANT seq (the pre-fix bug),
 * the SECOND online QC-hold/session of the season collides on that unique key and
 * is rejected — the hold never records, `_prevent_held_lot_commit` finds no open
 * hold, and the defective lot stays sellable. So the actions MUST draw a UNIQUE
 * monotonic `device_seq` via `next_server_seq()` (exactly as crew/weigh do), and
 * two writes on different lots must yield two DISTINCT seqs.
 *
 * Mirrors the supabase-server mock idiom in
 * src/app/(app)/crew/__tests__/actions.test.ts.
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
  placeQcHoldAction,
  recordCuppingSessionAction,
  recordDefectAction,
  releaseQcHoldAction,
  QC_IDLE,
} from "@/app/(app)/qc/actions";

/** Build a FormData from a plain record (the shape an action's form submits). */
function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/**
 * A Supabase-client stand-in. The INSERT-backed QC actions draw a unique server
 * device_seq via `.rpc("next_server_seq")` (the C1 collision fix) BEFORE the
 * command rpc, so the stub dispatches by name: `next_server_seq` → a strictly
 * monotonic integer; every other rpc → the configured `{ data, error }`. A `cmd`
 * helper isolates the COMMAND call from the seq draw for the envelope assertions.
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
      data: opts?.data ?? 42,
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

describe("placeQcHoldAction", () => {
  it("rejects a missing reason WITHOUT a write round-trip", async () => {
    const { client, cmd } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await placeQcHoldAction(
      QC_IDLE,
      form({ greenLotCode: "JC-9001" }),
    );

    expect(result.status).toBe("error");
    // the COMMAND rpc never fires on bad input (the harmless seq draw may pre-run).
    expect(cmd()).toHaveLength(0);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("places a hold with the synthetic server envelope and revalidates", async () => {
    const { client, cmd } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await placeQcHoldAction(
      QC_IDLE,
      form({
        greenLotCode: "JC-9001",
        reason: "off-flavour: phenol",
        idempotencyKey: "idem-hold-1",
      }),
    );

    expect(result.status).toBe("success");
    expect(cmd()).toHaveLength(1); // the command rpc fires exactly once
    const [name, args] = cmd()[0];
    expect(name).toBe("place_qc_hold");
    expect(args.p_green_lot_code).toBe("JC-9001");
    expect(args.p_reason).toBe("off-flavour: phenol");
    expect(args.p_device_id).toBe("server");
    // device_seq is a UNIQUE monotonic draw (the C1 fix) — never the constant 0.
    expect(typeof args.p_device_seq).toBe("number");
    expect(args.p_device_seq).toBeGreaterThan(0);
    expect(args.p_idempotency_key).toBe("idem-hold-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/qc");
  });

  /**
   * THE C1 regression. Two online QC-holds on DIFFERENT lots with DIFFERENT
   * idempotency keys must each draw a DISTINCT server device_seq. On the pre-fix
   * code the action never draws `next_server_seq()`, so both inherit the constant
   * `('server', 0)` and the second INSERT throws on `unique(device_id,device_seq)`
   * — the defective lot never gets held. This test FAILS on the pre-fix code
   * (both seqs are 0, so they are equal) and passes after.
   */
  it("draws a DISTINCT server device_seq for each hold (C1 unique-key guard)", async () => {
    const { client, cmd } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const r1 = await placeQcHoldAction(
      QC_IDLE,
      form({
        greenLotCode: "JC-9001",
        reason: "clean — calibration",
        idempotencyKey: "key-1",
      }),
    );
    const r2 = await placeQcHoldAction(
      QC_IDLE,
      form({
        greenLotCode: "JC-9002",
        reason: "off-flavour — quarantine the Geisha",
        idempotencyKey: "key-2",
      }),
    );

    expect(r1.status).toBe("success");
    expect(r2.status).toBe("success");

    const calls = cmd();
    expect(calls).toHaveLength(2);
    const seq1 = calls[0][1].p_device_seq as number;
    const seq2 = calls[1][1].p_device_seq as number;

    // both real draws (never the colliding constant 0) AND distinct from each other
    expect(seq1).toBeGreaterThan(0);
    expect(seq2).toBeGreaterThan(0);
    expect(seq2).not.toBe(seq1);

    // the second lot (JC-9002) actually got its place_qc_hold round-trip
    expect(calls[1][0]).toBe("place_qc_hold");
    expect(calls[1][1].p_green_lot_code).toBe("JC-9002");
  });

  it("surfaces a labelled DB error as a CLEAN error state (no revalidate)", async () => {
    const { client } = makeClient({
      data: null,
      error: { message: "duplicate key value violates unique constraint" },
    });
    getSupabaseMock.mockReturnValue(client);

    const result = await placeQcHoldAction(
      QC_IDLE,
      form({ greenLotCode: "JC-9001", reason: "off-flavour" }),
    );

    expect(result.status).toBe("error");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("releaseQcHoldAction", () => {
  it("releases a hold (UPDATE — no device collision) and revalidates", async () => {
    const { client, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await releaseQcHoldAction(
      QC_IDLE,
      form({ greenLotCode: "JC-9001" }),
    );

    expect(result.status).toBe("success");
    // release_qc_hold UPDATEs — it never INSERTs a qc_holds row, so it needs no
    // server-seq draw. Exactly one rpc, and it is the command (not next_server_seq).
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("release_qc_hold");
    expect(revalidatePathMock).toHaveBeenCalledWith("/qc");
  });
});

describe("recordCuppingSessionAction", () => {
  it("rejects an unknown protocol WITHOUT a write round-trip", async () => {
    const { client, cmd } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await recordCuppingSessionAction(
      QC_IDLE,
      form({ greenLotCode: "JC-9001", cupperId: "c-1", protocol: "telepathy" }),
    );

    expect(result.status).toBe("error");
    expect(cmd()).toHaveLength(0);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("opens a session with the synthetic server envelope and revalidates", async () => {
    const { client, cmd } = makeClient({ data: 7 });
    getSupabaseMock.mockReturnValue(client);

    const result = await recordCuppingSessionAction(
      QC_IDLE,
      form({
        greenLotCode: "JC-9001",
        cupperId: "c-1",
        protocol: "sca-cva",
        idempotencyKey: "idem-sess-1",
      }),
    );

    expect(result.status).toBe("success");
    expect(cmd()).toHaveLength(1);
    const [name, args] = cmd()[0];
    expect(name).toBe("record_cupping_session");
    expect(args.p_green_lot_code).toBe("JC-9001");
    expect(args.p_cupper_id).toBe("c-1");
    expect(args.p_protocol).toBe("sca-cva");
    expect(args.p_device_id).toBe("server");
    expect(typeof args.p_device_seq).toBe("number");
    expect(args.p_device_seq).toBeGreaterThan(0);
    expect(args.p_idempotency_key).toBe("idem-sess-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/qc");
  });

  /**
   * The cupping-session C1 guard — two sessions on different lots must draw two
   * distinct server seqs, or the second collides on
   * `cupping_sessions_device_id_device_seq_key`.
   */
  it("draws a DISTINCT server device_seq for each session (C1 unique-key guard)", async () => {
    const { client, cmd } = makeClient({ data: 7 });
    getSupabaseMock.mockReturnValue(client);

    await recordCuppingSessionAction(
      QC_IDLE,
      form({
        greenLotCode: "JC-9001",
        cupperId: "c-1",
        protocol: "sca-cva",
        idempotencyKey: "sess-key-1",
      }),
    );
    await recordCuppingSessionAction(
      QC_IDLE,
      form({
        greenLotCode: "JC-9002",
        cupperId: "c-1",
        protocol: "legacy-100",
        idempotencyKey: "sess-key-2",
      }),
    );

    const calls = cmd();
    expect(calls).toHaveLength(2);
    const seq1 = calls[0][1].p_device_seq as number;
    const seq2 = calls[1][1].p_device_seq as number;
    expect(seq1).toBeGreaterThan(0);
    expect(seq2).toBeGreaterThan(0);
    expect(seq2).not.toBe(seq1);
  });

  it("surfaces a labelled DB error as a CLEAN error state (no revalidate)", async () => {
    const { client } = makeClient({
      data: null,
      error: { message: "duplicate key value violates unique constraint" },
    });
    getSupabaseMock.mockReturnValue(client);

    const result = await recordCuppingSessionAction(
      QC_IDLE,
      form({ greenLotCode: "JC-9001", cupperId: "c-1", protocol: "sca-cva" }),
    );

    expect(result.status).toBe("error");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("recordDefectAction", () => {
  it("rejects a missing category WITHOUT a write round-trip", async () => {
    const { client, cmd } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await recordDefectAction(
      QC_IDLE,
      form({ greenLotCode: "JC-9001", defectKind: "full black", count: "3" }),
    );

    expect(result.status).toBe("error");
    expect(cmd()).toHaveLength(0);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("records a defect with the synthetic server envelope and revalidates", async () => {
    const { client, cmd } = makeClient({ data: 17 });
    getSupabaseMock.mockReturnValue(client);

    const result = await recordDefectAction(
      QC_IDLE,
      form({
        greenLotCode: "JC-9001",
        defectKind: "quaker",
        count: "5",
        category: "secondary",
        idempotencyKey: "idem-def-1",
      }),
    );

    expect(result.status).toBe("success");
    expect(cmd()).toHaveLength(1); // the command rpc fires exactly once
    const [name, args] = cmd()[0];
    expect(name).toBe("record_defect");
    expect(args.p_green_lot_code).toBe("JC-9001");
    expect(args.p_defect_kind).toBe("quaker");
    expect(args.p_count).toBe(5);
    expect(args.p_category).toBe("secondary");
    expect(args.p_device_id).toBe("server");
    // device_seq is a UNIQUE monotonic draw (the C1 fix) — never the constant 0.
    expect(typeof args.p_device_seq).toBe("number");
    expect(args.p_device_seq).toBeGreaterThan(0);
    expect(args.p_idempotency_key).toBe("idem-def-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/qc");
  });

  /**
   * The defect-ledger C1 guard — green_defects carries `unique(device_id,device_seq)`,
   * so two online defect rows must each draw a DISTINCT server device_seq or the
   * second INSERT throws on `green_defects_device_id_device_seq_key` and the tally
   * never lands. Two writes must yield two distinct seqs.
   */
  it("draws a DISTINCT server device_seq for each defect (C1 unique-key guard)", async () => {
    const { client, cmd } = makeClient({ data: 17 });
    getSupabaseMock.mockReturnValue(client);

    await recordDefectAction(
      QC_IDLE,
      form({
        greenLotCode: "JC-9001",
        defectKind: "full black",
        count: "2",
        category: "primary",
        idempotencyKey: "def-key-1",
      }),
    );
    await recordDefectAction(
      QC_IDLE,
      form({
        greenLotCode: "JC-9001",
        defectKind: "sour",
        count: "1",
        category: "primary",
        idempotencyKey: "def-key-2",
      }),
    );

    const calls = cmd();
    expect(calls).toHaveLength(2);
    const seq1 = calls[0][1].p_device_seq as number;
    const seq2 = calls[1][1].p_device_seq as number;
    expect(seq1).toBeGreaterThan(0);
    expect(seq2).toBeGreaterThan(0);
    expect(seq2).not.toBe(seq1);
  });

  it("surfaces a labelled DB error as a CLEAN error state (no revalidate)", async () => {
    const { client } = makeClient({
      data: null,
      error: { message: "duplicate key value violates unique constraint" },
    });
    getSupabaseMock.mockReturnValue(client);

    const result = await recordDefectAction(
      QC_IDLE,
      form({
        greenLotCode: "JC-9001",
        defectKind: "full black",
        count: "3",
        category: "primary",
      }),
    );

    expect(result.status).toBe("error");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
