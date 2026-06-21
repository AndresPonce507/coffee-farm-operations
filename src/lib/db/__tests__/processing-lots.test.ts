import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Read-port test for `getLotStages` — the SSOT bridge that surfaces the LOT's
 * authoritative `lots.stage` per `lot_code`, keyed for the Processing board.
 *
 * The pipeline-UI review found the board rendered `processing_batches.stage`
 * while the advance write moved `lots.stage` — two different tables. So a lot
 * could show a stale stage and one lot_code with several batches rendered
 * several Advance buttons all mutating one shared lot. This port lets the board
 * read the LOT's stage (the table the advance actually moves), deduped per
 * lot_code, so the displayed "from" stage and the post-advance refresh are
 * coherent with the write.
 *
 * Strategy mirrors getters.test.ts: mock `@/lib/supabase/server` so
 * `getSupabase()` returns a chainable, thenable query-builder stub resolving to
 * `{ data, error }` — no database, no network.
 */

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

function makeBuilder<T>(result: QueryResult<T>) {
  const builder = {
    from: vi.fn(() => builder),
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    then: (
      onFulfilled: (value: QueryResult<T>) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return builder;
}

const getSupabaseMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));

function stubQuery<T>(data: T, error: { message: string } | null = null) {
  const builder = makeBuilder({ data, error });
  getSupabaseMock.mockReturnValue({ from: () => builder });
}

beforeEach(() => {
  getSupabaseMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe("getLotStages", () => {
  it("returns a Map of lot_code -> the LOT's stage", async () => {
    stubQuery([
      { code: "JC-561", stage: "drying" },
      { code: "JC-564", stage: "fermentation" },
    ]);

    const { getLotStages } = await import("@/lib/db/processing-lots");
    const stages = await getLotStages();

    expect(stages.get("JC-561")).toBe("drying");
    expect(stages.get("JC-564")).toBe("fermentation");
  });

  it("coerces a NULL lots.stage to 'cherry' (the pipeline start, per the DB guard)", async () => {
    // Bare seed lots can have a NULL stage; the advance RPC treats NULL as the
    // 'cherry' start, so the board must surface the same so the 'from' is coherent.
    stubQuery([{ code: "JC-900", stage: null }]);

    const { getLotStages } = await import("@/lib/db/processing-lots");
    const stages = await getLotStages();

    expect(stages.get("JC-900")).toBe("cherry");
  });

  it("throws a labelled error when the query fails (never a silent empty map)", async () => {
    stubQuery(null, { message: "permission denied for table lots" });

    const { getLotStages } = await import("@/lib/db/processing-lots");
    await expect(getLotStages()).rejects.toThrow(/getLotStages/);
  });
});
