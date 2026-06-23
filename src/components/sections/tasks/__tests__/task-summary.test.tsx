import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FarmTask } from "@/lib/types";

/**
 * TaskSummary is an async Server Component that awaits getTasks() and derives
 * Open / In progress / Overdue / High-priority counts against the LIVE today()
 * (same source the board + table use — not a frozen constant). The clock is pinned
 * to 2026-06-23 below; against that date the fixtures give:
 *  - Open (todo): t1, t5 -> 2
 *  - In progress: t2 -> 1
 *  - Overdue (due < 2026-06-23 AND not done): t1 (06-18) + t2 (06-22) + t5 (06-20) -> 3
 *      (t4 06-19 is before today but status=done → excluded; t3 06-25 is future)
 *  - High priority (high AND not done): t1, t3 -> 2
 * Overdue=3 is unique among the counts, so it proves the live-date wiring: a frozen
 * TODAY="2026-06-20" would compute 1 and the assertion below would fail.
 */
const TASKS: FarmTask[] = [
  {
    id: "t1", title: "Prune Block A shade trees", category: "Pruning",
    plotId: "p1", plotName: "Tizingal Alto", assignee: "Marisol Quintero",
    workerId: null, due: "2026-06-18", status: "todo", priority: "high",
  },
  {
    id: "t2", title: "Apply foliar fertilizer", category: "Fertilizing",
    plotId: "p2", plotName: "Paso Ancho", assignee: "Diego Santamaría",
    workerId: null, due: "2026-06-22", status: "in-progress", priority: "medium",
  },
  {
    id: "t3", title: "Scout for broca beetle", category: "Pest Control",
    plotId: null, plotName: null, assignee: "Ana Beltrán",
    workerId: null, due: "2026-06-25", status: "blocked", priority: "high",
  },
  {
    id: "t4", title: "Weed nursery rows", category: "Weeding",
    plotId: "p3", plotName: "Bajo Mono", assignee: "Carlos Pineda",
    workerId: null, due: "2026-06-19", status: "done", priority: "low",
  },
  {
    id: "t5", title: "Mulch newly planted Geisha", category: "Planting",
    plotId: "p1", plotName: "Tizingal Alto", assignee: "Marisol Quintero",
    workerId: null, due: "2026-06-20", status: "todo", priority: "medium",
  },
];

vi.mock("@/lib/db/tasks", () => ({
  getTasks: vi.fn(async (): Promise<FarmTask[]> => TASKS),
}));

import { TaskSummary } from "@/components/sections/tasks/task-summary";

// Pin the clock — deliberately NOT 2026-06-20 (the old frozen anchor) — so the test
// proves the overdue tile keys off the live today(), matching the board/table.
beforeEach(() => vi.setSystemTime(new Date("2026-06-23T12:00:00")));
afterEach(() => vi.useRealTimers());

describe("TaskSummary (smoke)", () => {
  it("renders the four count tiles with derived values without throwing", async () => {
    const ui = await TaskSummary();
    render(ui);

    // Tile labels render.
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("High priority")).toBeInTheDocument();

    // A stable sub-label confirming the overdue tile rendered.
    expect(screen.getByText("Past due, not done")).toBeInTheDocument();

    // Overdue count = exactly 3 against the live 2026-06-23 (t1, t2, t5; t4 is done,
    // t3 is future). 3 is unique among the counts, so a frozen-date regression that
    // computed 1 would make this assertion fail.
    expect(screen.getByText("3")).toBeInTheDocument();
    // Open count = 2 (t1, t5); In progress = 1 (t2).
    expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(1);
  });
});
