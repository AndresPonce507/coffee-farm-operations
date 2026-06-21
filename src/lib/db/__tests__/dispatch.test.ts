import { afterEach, describe, expect, it, vi } from "vitest";

import {
  mapDispatchCard,
  mapDispatchPlot,
  type DispatchCardPlotRow,
  type DispatchCardRow,
} from "@/lib/db/dispatch";

/**
 * P2-S5 morning-dispatch read-port: pin the pure row → domain mappers (snake_case
 * → camelCase, numeric coercion, honest-null target_kg) and the getter's
 * fetch/order contract against a mocked PostgREST builder. mapDispatchCard
 * assembles a card's plot lines in pasada/readiness order (ord asc, then
 * readiness desc) so the rendered card always reads as the wave down the gradient.
 * The dispatch lifecycle + injection invariant are pinned in the DB test; this
 * file pins the READ surface the /dispatch board consumes.
 */

// ── mapDispatchPlot — v_dispatch_card_plots row → domain ──────────────────────
describe("mapDispatchPlot — dispatch card plot-line row mapper", () => {
  const row: DispatchCardPlotRow = {
    id: 12,
    dispatch_run_id: 3,
    plot_id: "p-norte-bajo",
    plot_name: "Norte Bajo",
    variety: "Catuaí",
    altitude_masl: "1400",
    task_kind: "picking",
    target_kg: "120",
    ripeness_target: "high",
    readiness: "0.92",
    ord: "1",
  };

  it("coerces numerics and maps snake_case → camelCase", () => {
    const p = mapDispatchPlot(row);
    expect(p.id).toBe(12);
    expect(p.dispatchRunId).toBe(3);
    expect(p.plotId).toBe("p-norte-bajo");
    expect(p.plotName).toBe("Norte Bajo");
    expect(p.variety).toBe("Catuaí");
    expect(p.altitudeMasl).toBe(1400);
    expect(p.taskKind).toBe("picking");
    expect(p.targetKg).toBe(120);
    expect(p.ripenessTarget).toBe("high");
    expect(p.readiness).toBeCloseTo(0.92, 5);
    expect(p.ord).toBe(1);
  });

  it("keeps an honest null target_kg when no per-plot target is set", () => {
    const p = mapDispatchPlot({ ...row, target_kg: null });
    expect(p.targetKg).toBeNull();
  });

  it("coerces a target_kg that arrives as a number (not a string)", () => {
    const p = mapDispatchPlot({ ...row, target_kg: 0 });
    expect(p.targetKg).toBe(0);
  });
});

// ── mapDispatchCard — v_dispatch_card row + plot rows → assembled card ─────────
describe("mapDispatchCard — assembles a card from its run row + plot lines", () => {
  const cardRow: DispatchCardRow = {
    id: 3,
    crew_id: "crew-norte",
    crew_name: "Crew Norte",
    dispatch_date: "2026-06-21",
    season: "2026",
    status: "draft",
    sent_channel: null,
    readiness_threshold: "0.5",
    idempotency_key: "idem-abc",
    plot_count: "2",
  };

  const plotRows: DispatchCardPlotRow[] = [
    {
      id: 21,
      dispatch_run_id: 3,
      plot_id: "p-norte-alto",
      plot_name: "Norte Alto",
      variety: "Geisha",
      altitude_masl: "1700",
      task_kind: "picking",
      target_kg: null,
      ripeness_target: "medium",
      readiness: "0.6",
      ord: "2",
    },
    {
      id: 20,
      dispatch_run_id: 3,
      plot_id: "p-norte-bajo",
      plot_name: "Norte Bajo",
      variety: "Catuaí",
      altitude_masl: "1400",
      task_kind: "picking",
      target_kg: "120",
      ripeness_target: "high",
      readiness: "0.92",
      ord: "1",
    },
  ];

  it("maps the run fields, coerces numerics, and keeps a null sent channel", () => {
    const card = mapDispatchCard(cardRow, plotRows);
    expect(card.id).toBe(3);
    expect(card.crewId).toBe("crew-norte");
    expect(card.crewName).toBe("Crew Norte");
    expect(card.dispatchDate).toBe("2026-06-21");
    expect(card.season).toBe("2026");
    expect(card.status).toBe("draft");
    expect(card.sentChannel).toBeNull();
    expect(card.readinessThreshold).toBeCloseTo(0.5, 5);
    expect(card.idempotencyKey).toBe("idem-abc");
    expect(card.plotCount).toBe(2);
  });

  it("orders the plot lines by ord asc (then readiness desc)", () => {
    const card = mapDispatchCard(cardRow, plotRows);
    expect(card.plots.map((p) => p.ord)).toEqual([1, 2]);
    expect(card.plots[0].plotId).toBe("p-norte-bajo");
    expect(card.plots[1].plotId).toBe("p-norte-alto");
  });

  it("breaks an ord tie by readiness desc (most-ready first)", () => {
    const tied: DispatchCardPlotRow[] = [
      { ...plotRows[0], ord: "1", readiness: "0.40", plot_id: "p-less-ready" },
      { ...plotRows[1], ord: "1", readiness: "0.95", plot_id: "p-more-ready" },
    ];
    const card = mapDispatchCard(cardRow, tied);
    expect(card.plots.map((p) => p.plotId)).toEqual([
      "p-more-ready",
      "p-less-ready",
    ]);
  });

  it("keeps a non-null sent channel when the run was shared", () => {
    const card = mapDispatchCard(
      { ...cardRow, status: "sent", sent_channel: "web-share" },
      plotRows,
    );
    expect(card.status).toBe("sent");
    expect(card.sentChannel).toBe("web-share");
  });

  it("yields an empty plots array when the run has no assignments", () => {
    const card = mapDispatchCard(cardRow, []);
    expect(card.plots).toEqual([]);
  });
});

// ── getDispatchToday: fetch + order + group contract against a mocked builder ──
interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

const getSupabaseMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));

/**
 * Stub a client whose .from(table) hands back a thenable, chainable builder whose
 * resolved data is keyed per-table — so one client serves both the card query and
 * the plots query in a single getDispatchToday() call. `from`/`order` are spies so
 * we can assert the table names + the order columns.
 */
function stubByTable(byTable: Record<string, unknown[]>, error: { message: string } | null = null) {
  const from = vi.fn();
  const order = vi.fn();
  from.mockImplementation((table: string) => {
    const result: QueryResult<unknown[]> = {
      data: byTable[table] ?? [],
      error,
    };
    const builder = {
      select: vi.fn(() => builder),
      order: vi.fn((...args: unknown[]) => {
        order(table, ...args);
        return builder;
      }),
      then: (
        onFulfilled: (value: QueryResult<unknown[]>) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve(result).then(onFulfilled, onRejected),
    };
    return builder;
  });
  getSupabaseMock.mockReturnValue({ from });
  return { from, order };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("getDispatchToday — reads the active cards + groups their plot lines", () => {
  const cardRows: DispatchCardRow[] = [
    {
      id: 3,
      crew_id: "crew-norte",
      crew_name: "Crew Norte",
      dispatch_date: "2026-06-21",
      season: "2026",
      status: "draft",
      sent_channel: null,
      readiness_threshold: "0.5",
      idempotency_key: "idem-abc",
      plot_count: "2",
    },
    {
      id: 4,
      crew_id: "crew-sur",
      crew_name: "Crew Sur",
      dispatch_date: "2026-06-21",
      season: "2026",
      status: "sent",
      sent_channel: "web-share",
      readiness_threshold: "0.5",
      idempotency_key: "idem-xyz",
      plot_count: "1",
    },
  ];

  const plotRows: DispatchCardPlotRow[] = [
    {
      id: 21,
      dispatch_run_id: 3,
      plot_id: "p-norte-alto",
      plot_name: "Norte Alto",
      variety: "Geisha",
      altitude_masl: "1700",
      task_kind: "picking",
      target_kg: null,
      ripeness_target: "medium",
      readiness: "0.6",
      ord: "2",
    },
    {
      id: 20,
      dispatch_run_id: 3,
      plot_id: "p-norte-bajo",
      plot_name: "Norte Bajo",
      variety: "Catuaí",
      altitude_masl: "1400",
      task_kind: "picking",
      target_kg: "120",
      ripeness_target: "high",
      readiness: "0.92",
      ord: "1",
    },
    {
      id: 30,
      dispatch_run_id: 4,
      plot_id: "p-sur-bajo",
      plot_name: "Sur Bajo",
      variety: "Caturra",
      altitude_masl: "1300",
      task_kind: "picking",
      target_kg: "80",
      ripeness_target: "high",
      readiness: "0.88",
      ord: "1",
    },
  ];

  it("queries both views, groups plots by run, and orders cards by crew name", async () => {
    const { getDispatchToday } = await import("@/lib/db/dispatch");
    const { from } = stubByTable({
      v_dispatch_card: cardRows,
      v_dispatch_card_plots: plotRows,
    });
    const cards = await getDispatchToday();

    expect(from).toHaveBeenCalledWith("v_dispatch_card");
    expect(from).toHaveBeenCalledWith("v_dispatch_card_plots");
    expect(cards).toHaveLength(2);

    const norte = cards.find((c) => c.crewId === "crew-norte")!;
    expect(norte.plots).toHaveLength(2);
    expect(norte.plots.map((p) => p.plotId)).toEqual([
      "p-norte-bajo",
      "p-norte-alto",
    ]);

    const sur = cards.find((c) => c.crewId === "crew-sur")!;
    expect(sur.plots).toHaveLength(1);
    expect(sur.plots[0].plotId).toBe("p-sur-bajo");
  });

  it("orders the card query by crew_name ascending", async () => {
    const { getDispatchToday } = await import("@/lib/db/dispatch");
    const { order } = stubByTable({
      v_dispatch_card: cardRows,
      v_dispatch_card_plots: plotRows,
    });
    await getDispatchToday();
    expect(order).toHaveBeenCalledWith("v_dispatch_card", "crew_name", {
      ascending: true,
    });
  });

  it("gives a card with no plot lines an empty plots array", async () => {
    const { getDispatchToday } = await import("@/lib/db/dispatch");
    stubByTable({
      v_dispatch_card: [cardRows[0]],
      v_dispatch_card_plots: [],
    });
    const cards = await getDispatchToday();
    expect(cards).toHaveLength(1);
    expect(cards[0].plots).toEqual([]);
  });

  it("throws a labelled error when the card query errors", async () => {
    const { getDispatchToday } = await import("@/lib/db/dispatch");
    stubByTable({}, { message: "boom" });
    await expect(getDispatchToday()).rejects.toThrow(/getDispatchToday/);
  });
});
