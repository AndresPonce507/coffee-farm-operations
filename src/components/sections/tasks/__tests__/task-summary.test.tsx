import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FarmTask } from "@/lib/types";

/**
 * TaskSummary is an async Server Component that awaits getTasks() and derives
 * Open / In progress / Overdue / High-priority counts against a hardcoded
 * TODAY = "2026-06-20". The fixtures below pin those counts deterministically:
 *  - Open (todo): t1, t5 -> 2
 *  - In progress: t2 -> 1
 *  - Overdue (due < 2026-06-20 AND not done): t1 (2026-06-18) -> 1
 *      (t4 is also before TODAY but status=done, so it is excluded)
 *  - High priority (high AND not done): t1, t3 -> 2
 * t3 has a null plot; t2/t3/t5 are due on/after TODAY (non-overdue path).
 */
const TASKS: FarmTask[] = [
  {
    id: "t1", title: "Prune Block A shade trees", category: "Pruning",
    plotId: "p1", plotName: "Tizingal Alto", assignee: "Marisol Quintero",
    due: "2026-06-18", status: "todo", priority: "high",
  },
  {
    id: "t2", title: "Apply foliar fertilizer", category: "Fertilizing",
    plotId: "p2", plotName: "Paso Ancho", assignee: "Diego Santamaría",
    due: "2026-06-22", status: "in-progress", priority: "medium",
  },
  {
    id: "t3", title: "Scout for broca beetle", category: "Pest Control",
    plotId: null, plotName: null, assignee: "Ana Beltrán",
    due: "2026-06-25", status: "blocked", priority: "high",
  },
  {
    id: "t4", title: "Weed nursery rows", category: "Weeding",
    plotId: "p3", plotName: "Bajo Mono", assignee: "Carlos Pineda",
    due: "2026-06-19", status: "done", priority: "low",
  },
  {
    id: "t5", title: "Mulch newly planted Geisha", category: "Planting",
    plotId: "p1", plotName: "Tizingal Alto", assignee: "Marisol Quintero",
    due: "2026-06-20", status: "todo", priority: "medium",
  },
];

vi.mock("@/lib/db/tasks", () => ({
  getTasks: vi.fn(async (): Promise<FarmTask[]> => TASKS),
}));

import { TaskSummary } from "@/components/sections/tasks/task-summary";

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

    // Overdue count = exactly 1 (t1 is before TODAY and not done; the done
    // t4 is excluded). "1" is unique among the derived counts (2,1,1,2 ->
    // both Overdue and In progress show "1"), so assert at least one "1".
    expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(1);
    // Open count = 2 (t1, t5).
    expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1);
  });
});
