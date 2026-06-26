import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AccoladeRow,
  ReputationPublicRow,
  ReputationViewRow,
} from "@/lib/db/reputation";

/**
 * Coverage of the `reputation.ts` READ-port (P3-S19 — the reputation ledger). The
 * sibling shared port the Wiring pass collapses the co-located route `data.ts` into:
 * it binds to the SAME authoritative SQL surface the migration shipped —
 *
 *   - `v_lot_reputation`        the per-lot aggregate (best live cup score, award/cert/press
 *                               counts + name arrays, reconciled to green_lots QC truth).
 *   - `lot_accolades`           the append-only ledger (originals + 'score-revision' rows).
 *   - `verify_chain('accolade:<lot>')`  the tamper-evident stamp.
 *   - `v_lot_reputation_public` the NARROW public projection (title/score/awarded_by/
 *                               award_year) — authenticated-only here, anon in P3-S13.
 *
 * Proves the pure mappers (snake_case → camelCase, numeric coercion of score columns
 * PostgREST may serialize as strings, NULL preservation for an un-cupped lot, count
 * null→0, name-array null→[], and the derived `reversed` flag across a ledger) and the
 * `cache()`-wrapped getters' fetch + map round-trip. Strategy mirrors pricing.test.ts:
 * a chainable, thenable per-table query-builder stub plus a top-level `.rpc()`.
 */

// ----- chainable, per-table Supabase query-builder stub ---------------------

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

type TableResults = Record<string, QueryResult<unknown>>;

function makeClient(results: TableResults, rpcResult?: QueryResult<unknown>) {
  const fromCalls: string[] = [];
  const rpcCalls: { fn: string; args: unknown }[] = [];
  const client = {
    from: (table: string) => {
      fromCalls.push(table);
      const result = results[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {
        select: vi.fn(() => builder),
        order: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        maybeSingle: vi.fn(() => Promise.resolve(result)),
        then: (
          onFulfilled: (value: QueryResult<unknown>) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => Promise.resolve(result).then(onFulfilled, onRejected),
      };
      return builder;
    },
    rpc: vi.fn((fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(rpcResult ?? { data: null, error: null });
    }),
  };
  return { client, fromCalls, rpcCalls };
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

// ----- sample rows ----------------------------------------------------------

const geishaRow: ReputationViewRow = {
  lot_code: "JC-701",
  qc_cupping_score: "89.5", // PostgREST may serialize numeric as a string
  sca_grade: "Presidential",
  best_cup_score: "89.5",
  accolade_count: "3",
  award_count: "1",
  awards: ["Best of Panama — Champion Lot"],
  cert_count: "1",
  certs: ["Organic"],
  press_count: "1",
  last_accolade_at: "2026-06-20T10:00:00Z",
};

const uncuppedRow: ReputationViewRow = {
  lot_code: "JC-820",
  qc_cupping_score: null, // not cupped yet ⇒ preserved as null, never a 0 floor
  sca_grade: null,
  best_cup_score: null,
  accolade_count: "1",
  award_count: null,
  awards: null,
  cert_count: null,
  certs: null,
  press_count: null,
  last_accolade_at: null,
};

const publicRow: ReputationPublicRow = {
  lot_code: "JC-701",
  title: "Best of Panama — Champion Lot",
  score: "89.5",
  awarded_by: "SCAP",
  award_year: 2025,
};

// ----- pure mapper: mapReputationSummary ------------------------------------

describe("mapReputationSummary", () => {
  it("maps a v_lot_reputation row, coercing scores and folding in the variety", async () => {
    const { mapReputationSummary } = await import("@/lib/db/reputation");
    expect(mapReputationSummary(geishaRow, "Geisha")).toEqual({
      lotCode: "JC-701",
      variety: "Geisha",
      qcCuppingScore: 89.5,
      scaGrade: "Presidential",
      bestCupScore: 89.5,
      accoladeCount: 3,
      awardCount: 1,
      awards: ["Best of Panama — Champion Lot"],
      certCount: 1,
      certs: ["Organic"],
      pressCount: 1,
      lastAccoladeAt: "2026-06-20T10:00:00Z",
    });
  });

  it("preserves a NULL cup/QC score (never a fabricated 0) and folds null counts to 0 / arrays to []", async () => {
    const { mapReputationSummary } = await import("@/lib/db/reputation");
    const s = mapReputationSummary(uncuppedRow, null);
    expect(s.qcCuppingScore).toBeNull();
    expect(s.bestCupScore).toBeNull();
    expect(s.scaGrade).toBeNull();
    expect(s.awardCount).toBe(0);
    expect(s.awards).toEqual([]);
    expect(s.certCount).toBe(0);
    expect(s.certs).toEqual([]);
    expect(s.pressCount).toBe(0);
    expect(s.variety).toBeNull();
  });
});

// ----- pure mapper: mapAccolade / mapAccoladeLedger -------------------------

describe("mapAccoladeLedger", () => {
  it("maps rows and derives the `reversed` flag from the set of reverses_id", async () => {
    const { mapAccoladeLedger } = await import("@/lib/db/reputation");
    const rows: AccoladeRow[] = [
      {
        id: 1,
        kind: "cup-score",
        title: null,
        score: "88",
        awarded_by: "lab",
        award_year: null,
        evidence_url: null,
        reverses_id: null,
        occurred_at: "2026-06-01T00:00:00Z",
      },
      {
        id: 2,
        kind: "score-revision",
        title: "re-cupped",
        score: "89.5",
        awarded_by: null,
        award_year: null,
        evidence_url: null,
        reverses_id: "1", // reverses #1 ⇒ #1 is reversed, #2 is live
        occurred_at: "2026-06-10T00:00:00Z",
      },
    ];
    const ledger = mapAccoladeLedger(rows);
    expect(ledger).toHaveLength(2);
    const first = ledger.find((a) => a.id === 1)!;
    const second = ledger.find((a) => a.id === 2)!;
    expect(first.reversed).toBe(true);
    expect(first.score).toBe(88);
    expect(second.reversed).toBe(false);
    expect(second.reversesId).toBe(1);
    expect(second.score).toBe(89.5);
  });
});

// ----- pure mapper: mapReputationPublic -------------------------------------

describe("mapReputationPublic", () => {
  it("maps the narrow public projection with numeric coercion of the score", async () => {
    const { mapReputationPublic } = await import("@/lib/db/reputation");
    expect(mapReputationPublic(publicRow)).toEqual({
      lotCode: "JC-701",
      title: "Best of Panama — Champion Lot",
      score: 89.5,
      awardedBy: "SCAP",
      awardYear: 2025,
    });
  });

  it("preserves a null score / title / awardedBy / awardYear", async () => {
    const { mapReputationPublic } = await import("@/lib/db/reputation");
    const p = mapReputationPublic({
      ...publicRow,
      title: null,
      score: null,
      awarded_by: null,
      award_year: null,
    });
    expect(p.title).toBeNull();
    expect(p.score).toBeNull();
    expect(p.awardedBy).toBeNull();
    expect(p.awardYear).toBeNull();
  });
});

// ----- getter: getReputationWall --------------------------------------------

describe("getReputationWall", () => {
  it("reads v_lot_reputation + lots and ranks by best cup score (nulls last)", async () => {
    const { client, fromCalls } = makeClient({
      v_lot_reputation: { data: [uncuppedRow, geishaRow], error: null },
      lots: {
        data: [
          { code: "JC-701", variety: "Geisha" },
          { code: "JC-820", variety: "Catuai" },
        ],
        error: null,
      },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getReputationWall } = await import("@/lib/db/reputation");
    const wall = await getReputationWall();

    expect(fromCalls).toContain("v_lot_reputation");
    expect(fromCalls).toContain("lots");
    expect(wall).toHaveLength(2);
    // the 89.5 Geisha ranks above the un-cupped (null) lot
    expect(wall[0].lotCode).toBe("JC-701");
    expect(wall[0].variety).toBe("Geisha");
    expect(wall[1].lotCode).toBe("JC-820");
    expect(wall[1].bestCupScore).toBeNull();
  });

  it("throws a labelled error when the aggregate query fails", async () => {
    const { client } = makeClient({
      v_lot_reputation: { data: null, error: { message: "wall boom" } },
      lots: { data: [], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getReputationWall } = await import("@/lib/db/reputation");
    await expect(getReputationWall()).rejects.toThrow("getReputationWall: wall boom");
  });
});

// ----- getter: getLotReputation ---------------------------------------------

describe("getLotReputation", () => {
  it("assembles the per-lot detail (summary + ledger + chain stamp)", async () => {
    const ledgerRows: AccoladeRow[] = [
      {
        id: 1,
        kind: "cup-score",
        title: null,
        score: "88",
        awarded_by: "lab",
        award_year: null,
        evidence_url: null,
        reverses_id: null,
        occurred_at: "2026-06-01T00:00:00Z",
      },
      {
        id: 2,
        kind: "score-revision",
        title: "re-cupped",
        score: "89.5",
        awarded_by: null,
        award_year: null,
        evidence_url: null,
        reverses_id: 1,
        occurred_at: "2026-06-10T00:00:00Z",
      },
    ];
    const { client, fromCalls, rpcCalls } = makeClient(
      {
        lots: { data: { code: "JC-701", variety: "Geisha" }, error: null },
        green_lots: {
          data: { cupping_score: "89.5", sca_grade: "Presidential" },
          error: null,
        },
        v_lot_reputation: { data: geishaRow, error: null },
        lot_accolades: { data: ledgerRows, error: null },
      },
      { data: true, error: null }, // verify_chain('accolade:JC-701') → true
    );
    getSupabaseMock.mockReturnValue(client);

    const { getLotReputation } = await import("@/lib/db/reputation");
    const detail = await getLotReputation("JC-701");

    expect(detail).not.toBeNull();
    expect(fromCalls).toContain("lot_accolades");
    expect(rpcCalls[0]).toEqual({
      fn: "verify_chain",
      args: { stream_key: "accolade:JC-701" },
    });
    expect(detail?.lotCode).toBe("JC-701");
    expect(detail?.variety).toBe("Geisha");
    expect(detail?.bestCupScore).toBe(89.5);
    expect(detail?.accolades).toHaveLength(2);
    expect(detail?.accolades.find((a) => a.id === 1)?.reversed).toBe(true);
    expect(detail?.chainVerified).toBe(true);
  });

  it("returns null when the lot does not exist in the caller's tenant", async () => {
    const { client } = makeClient({
      lots: { data: null, error: null }, // maybeSingle miss
    });
    getSupabaseMock.mockReturnValue(client);
    const { getLotReputation } = await import("@/lib/db/reputation");
    expect(await getLotReputation("JC-000")).toBeNull();
  });

  it("verifies an empty ledger honestly (chainVerified true, no fabricated rows)", async () => {
    const { client } = makeClient(
      {
        lots: { data: { code: "JC-900", variety: null }, error: null },
        green_lots: { data: null, error: null },
        v_lot_reputation: { data: null, error: null },
        lot_accolades: { data: [], error: null },
      },
      { data: null, error: { message: "no chain" } }, // even an rpc error: empty ⇒ verified
    );
    getSupabaseMock.mockReturnValue(client);
    const { getLotReputation } = await import("@/lib/db/reputation");
    const detail = await getLotReputation("JC-900");
    expect(detail).not.toBeNull();
    expect(detail?.accolades).toEqual([]);
    expect(detail?.chainVerified).toBe(true);
  });
});

// ----- getter: getLotReputationPublic ---------------------------------------

describe("getLotReputationPublic", () => {
  it("reads v_lot_reputation_public and returns the narrow projection", async () => {
    const { client, fromCalls } = makeClient({
      v_lot_reputation_public: { data: [publicRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getLotReputationPublic } = await import("@/lib/db/reputation");
    const rows = await getLotReputationPublic();

    expect(fromCalls).toContain("v_lot_reputation_public");
    expect(rows).toEqual([
      {
        lotCode: "JC-701",
        title: "Best of Panama — Champion Lot",
        score: 89.5,
        awardedBy: "SCAP",
        awardYear: 2025,
      },
    ]);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_lot_reputation_public: { data: null, error: { message: "pub boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getLotReputationPublic } = await import("@/lib/db/reputation");
    await expect(getLotReputationPublic()).rejects.toThrow(
      "getLotReputationPublic: pub boom",
    );
  });
});
