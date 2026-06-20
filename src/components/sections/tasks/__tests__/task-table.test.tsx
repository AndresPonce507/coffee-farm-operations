import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FarmTask } from "@/lib/types";

/**
 * TaskTable is an async Server Component that awaits getTasks() and renders one
 * row per task with category / plot / assignee / due / priority / status
 * badges. Overdue styling keys off a fixed TODAY = "2026-06-20". Fixtures span
 * all four statuses, include a null-plot row (renders an em-dash placeholder)
 * and one overdue row (t1, due 2026-06-18) so the overdue branch renders.
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
];

vi.mock("@/lib/db/tasks", () => ({
  getTasks: vi.fn(async (): Promise<FarmTask[]> => TASKS),
}));

// TaskRowActions imports the Server Actions; stub them so the table renders
// without pulling in next/cache or the Supabase client.
vi.mock("@/lib/actions/tasks", () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  setTaskStatus: vi.fn(),
  IDLE: { status: "idle" },
}));

import { TaskTable } from "@/components/sections/tasks/task-table";

describe("TaskTable (smoke)", () => {
  it("renders the table header and a row per task without throwing", async () => {
    const ui = await TaskTable({ plots: [], workers: [] });
    render(ui);

    // Card title + the count-driven description (4 tasks in fixtures).
    expect(screen.getByText("All tasks")).toBeInTheDocument();
    expect(
      screen.getByText(/4 agronomy tasks across the farm/i),
    ).toBeInTheDocument();

    // Column headers render.
    expect(screen.getByText("Task")).toBeInTheDocument();
    expect(screen.getByText("Assignee")).toBeInTheDocument();
    expect(screen.getByText("Priority")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();

    // Task titles render, including the null-plot row.
    expect(screen.getByText("Prune Block A shade trees")).toBeInTheDocument();
    expect(screen.getByText("Scout for broca beetle")).toBeInTheDocument();

    // The null-plot row shows the em-dash placeholder instead of a plot name.
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
