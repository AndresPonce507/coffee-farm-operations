import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 5 L2 dossier getter — `getWorkerWeighSummary(workerId)` (facet-02 §7).
 *
 * The /workers/[id] dossier's Kg/weigh section: one picker's running today-tally
 * (lata count + kg). Reads the SAME `v_weigh_today_by_picker` view
 * `getWeighTodayByPicker()` reads, narrowed to a single worker, and maps it via
 * `mapWeighByPicker` (pinned in weigh.test.ts). Returns null when the worker has
 * not weighed in today (honest empty — the section renders its zero/empty state,
 * not a fabricated tally).
 *
 * NOTE (flag): the task brief listed this getter under people.ts; the DESIGN
 * (02-dossiers.md §7) places it in weigh.ts, co-located with the
 * v_weigh_today_by_picker view + mapWeighByPicker mapper it reuses. Followed the
 * design to avoid splitting the weigh read-port across two files.
 */

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

function makeBuilder<T>(result: QueryResult<T>) {
  const calls = {
    from: undefined as string | undefined,
    eqArgs: [] as Array<[string, unknown]>,
  };
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((col: string, val: unknown) => {
      calls.eqArgs.push([col, val]);
      return builder;
    }),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (
      onFulfilled: (value: QueryResult<T>) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  const client = {
    from: (table: string) => {
      calls.from = table;
      return builder;
    },
  };
  return { client, calls };
}

const getSupabaseMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));

beforeEach(() => getSupabaseMock.mockReset());
afterEach(() => vi.resetModules());

const row = {
  worker_id: "w-06",
  name: "Lucía Morales",
  crew_id: "crew-tizingal",
  lata_count: "3",
  kg_today: "37.4",
  last_weigh_at: "2026-06-21T16:00:00Z",
};

describe("getWorkerWeighSummary", () => {
  it("reads v_weigh_today_by_picker filtered by worker_id and maps the tally", async () => {
    const { client, calls } = makeBuilder({ data: row, error: null });
    getSupabaseMock.mockReturnValue(client);

    const { getWorkerWeighSummary } = await import("@/lib/db/weigh");
    const summary = await getWorkerWeighSummary("w-06");

    expect(calls.from).toBe("v_weigh_today_by_picker");
    expect(calls.eqArgs).toContainEqual(["worker_id", "w-06"]);

    // The id handle is worker id — the same handle entityHref.worker links with.
    expect(summary).toEqual({
      workerId: "w-06",
      name: "Lucía Morales",
      crewId: "crew-tizingal",
      lataCount: 3,
      kgToday: 37.4,
      lastWeighAt: "2026-06-21T16:00:00Z",
    });
  });

  it("returns null when the worker has no weigh-in today (honest empty)", async () => {
    const { client } = makeBuilder({ data: null, error: null });
    getSupabaseMock.mockReturnValue(client);

    const { getWorkerWeighSummary } = await import("@/lib/db/weigh");
    expect(await getWorkerWeighSummary("w-99")).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeBuilder({ data: null, error: { message: "boom" } });
    getSupabaseMock.mockReturnValue(client);

    const { getWorkerWeighSummary } = await import("@/lib/db/weigh");
    await expect(getWorkerWeighSummary("w-06")).rejects.toThrow(
      "getWorkerWeighSummary: boom",
    );
  });
});
