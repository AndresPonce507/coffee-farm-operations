import { afterEach, describe, expect, it, vi } from "vitest";

import {
  mapPasadaPlan,
  mapPlotReadiness,
  type PasadaPlanRow,
  type PlotReadinessRow,
} from "@/lib/db/planning";

/**
 * P2-S8 planning read-port: pin the pure row → domain mappers (snake_case →
 * camelCase, numeric/Date coercion, honest-null handling) and the getter
 * fetch/order contract against a mocked PostgREST builder. The readiness model
 * itself is pinned in agronomy/gdd.test.ts + the DB test; this file pins the
 * READ surface the /plan UI and S5 dispatch consume.
 */

// ── mapPlotReadiness — v_harvest_readiness row → domain ───────────────────────
describe("mapPlotReadiness — derived readiness row mapper", () => {
  const row: PlotReadinessRow = {
    plot_id: "p-cuesta-piedra",
    plot_name: "Cuesta de Piedra",
    variety: "Catuaí",
    altitude_masl: 1360,
    bloom_date: "2026-01-15",
    gdd_accumulated: "2200",
    gdd_to_cherry: "2200",
    ndvi_latest: "0.72",
    recent_ripeness_pct: "94",
    readiness: "1",
    confidence: "high",
    stagger_days: "0",
    predicted_ready_date: "2026-04-01",
  };

  it("coerces numerics and keeps the derived readiness in [0,1]", () => {
    const r = mapPlotReadiness(row);
    expect(r.plotId).toBe("p-cuesta-piedra");
    expect(r.altitudeMasl).toBe(1360);
    expect(r.readiness).toBeCloseTo(1, 5);
    expect(r.ndviLatest).toBeCloseTo(0.72, 5);
    expect(r.confidence).toBe("high");
  });

  it("surfaces an honest null predicted date / NDVI when the model lacks the signal", () => {
    const r = mapPlotReadiness({
      ...row,
      bloom_date: null,
      ndvi_latest: null,
      predicted_ready_date: null,
      confidence: "low",
      readiness: "0",
    });
    expect(r.predictedReadyDate).toBeNull();
    expect(r.ndviLatest).toBeNull();
    expect(r.bloomDate).toBeNull();
    expect(r.confidence).toBe("low");
  });
});

// ── mapPasadaPlan — v_pasada_calendar row → domain ────────────────────────────
describe("mapPasadaPlan — pasada calendar row mapper", () => {
  const row: PasadaPlanRow = {
    id: 7,
    plot_id: "p-las-lagunas",
    plot_name: "Las Lagunas",
    variety: "Geisha",
    altitude_masl: 1700,
    season: "2026",
    pasada_number: 2,
    predicted_ready_date: "2026-04-20",
    predicted_ripe_pct: "high",
    status: "planned",
    reason: "rain front",
    fired_task_id: "task-abc",
  };

  it("maps the calendar fields and coerces the pasada number / altitude", () => {
    const p = mapPasadaPlan(row);
    expect(p.id).toBe(7);
    expect(p.plotId).toBe("p-las-lagunas");
    expect(p.pasadaNumber).toBe(2);
    expect(p.altitudeMasl).toBe(1700);
    expect(p.ripenessTarget).toBe("high");
    expect(p.status).toBe("planned");
    expect(p.firedTaskId).toBe("task-abc");
  });
});

// ── getters: fetch + order contract against a mocked builder ──────────────────
interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

function makeBuilder<T>(result: QueryResult<T>) {
  const builder = {
    from: vi.fn(() => builder),
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    eq: vi.fn(() => builder),
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
  // getSupabase() resolves to a (non-thenable) client whose .from() returns the
  // chainable, thenable builder. `from` is a spy so we can assert the table name;
  // `order` is exposed so we can assert the ORDER contract (most-ready-first /
  // wave-up-the-mountain) the getter docstrings promise — the spy lives on the
  // inner builder, so the bare `{ from }` shape hid it from every test.
  const from = vi.fn(() => builder);
  getSupabaseMock.mockReturnValue({ from });
  return { from, order: builder.order };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("getHarvestReadiness — reads v_harvest_readiness, ranked most-ready-first", () => {
  it("queries the readiness view and maps every row", async () => {
    const { getHarvestReadiness } = await import("@/lib/db/planning");
    const builder = stubQuery([
      {
        plot_id: "p-cuesta-piedra",
        plot_name: "Cuesta de Piedra",
        variety: "Catuaí",
        altitude_masl: 1360,
        bloom_date: "2026-01-15",
        gdd_accumulated: "2200",
        gdd_to_cherry: "2200",
        ndvi_latest: null,
        recent_ripeness_pct: null,
        readiness: "1",
        confidence: "medium",
        stagger_days: "0",
        predicted_ready_date: "2026-04-01",
      },
    ]);
    const rows = await getHarvestReadiness();
    expect(builder.from).toHaveBeenCalledWith("v_harvest_readiness");
    // The "most-ready-first" ranking S5's morning dispatch consumes is sourced
    // SOLELY by this descending order (the view has no terminal ORDER BY and the
    // ReadinessList consumer never re-sorts). Pin the direction so a refactor/
    // fat-finger flip to ascending — greenest, weeks-early plots first — fails here.
    expect(builder.order).toHaveBeenCalledWith("readiness", { ascending: false });
    expect(rows).toHaveLength(1);
    expect(rows[0].plotId).toBe("p-cuesta-piedra");
    expect(rows[0].readiness).toBe(1);
  });

  it("throws a labelled error when PostgREST errors", async () => {
    const { getHarvestReadiness } = await import("@/lib/db/planning");
    stubQuery([], { message: "boom" });
    await expect(getHarvestReadiness()).rejects.toThrow(/getHarvestReadiness/);
  });
});

describe("getPasadaCalendar — reads v_pasada_calendar (active plans only)", () => {
  it("queries the calendar view and maps every row", async () => {
    const { getPasadaCalendar } = await import("@/lib/db/planning");
    const builder = stubQuery([
      {
        id: 1,
        plot_id: "p-las-lagunas",
        plot_name: "Las Lagunas",
        variety: "Geisha",
        altitude_masl: 1700,
        season: "2026",
        pasada_number: 1,
        predicted_ready_date: "2026-04-20",
        predicted_ripe_pct: "high",
        status: "planned",
        reason: null,
        fired_task_id: "t-1",
      },
    ]);
    const rows = await getPasadaCalendar();
    expect(builder.from).toHaveBeenCalledWith("v_pasada_calendar");
    // The timeline reads as a wave moving up the mountain: ready-date asc, then
    // altitude asc as the tiebreak. Pin both legs in sequence so flipping either
    // direction or dropping the altitude tiebreak fails here.
    expect(builder.order).toHaveBeenNthCalledWith(1, "predicted_ready_date", {
      ascending: true,
    });
    expect(builder.order).toHaveBeenNthCalledWith(2, "altitude_masl", {
      ascending: true,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].pasadaNumber).toBe(1);
  });
});
