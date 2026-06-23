import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FarmTask } from "@/lib/types";

// Overdue keys off the REAL local date now; pin the clock to the date the fixtures
// are anchored to (2026-06-20) so t1 (due 2026-06-18) is overdue and the future rows
// are not, deterministically.
beforeEach(() => vi.setSystemTime(new Date("2026-06-20T12:00:00")));
afterEach(() => vi.useRealTimers());

/**
 * TaskTable is an async Server Component that awaits getTasks() and renders one
 * row per task with category / plot / assignee / due / priority / status
 * badges. Overdue styling keys off a fixed TODAY = "2026-06-20". Fixtures span
 * all four statuses, include a null-plot row (renders an em-dash placeholder)
 * and one overdue row (t1, due 2026-06-18) so the overdue branch renders.
 *
 * Phase-5 wiring:
 *  - plotName cell: EntityLink kind=plot when plotId != null; em-dash fallback otherwise.
 *  - assignee cell: EntityLink kind=worker when workerId != null; plain span otherwise.
 */
const TASKS: FarmTask[] = [
  {
    id: "t1", title: "Prune Block A shade trees", category: "Pruning",
    plotId: "p1", plotName: "Tizingal Alto", assignee: "Marisol Quintero",
    workerId: "w1",
    due: "2026-06-18", status: "todo", priority: "high",
  },
  {
    id: "t2", title: "Apply foliar fertilizer", category: "Fertilizing",
    plotId: "p2", plotName: "Paso Ancho", assignee: "Diego Santamaría",
    workerId: "w2",
    due: "2026-06-22", status: "in-progress", priority: "medium",
  },
  {
    id: "t3", title: "Scout for broca beetle", category: "Pest Control",
    plotId: null, plotName: null, assignee: "Ana Beltrán",
    workerId: null,
    due: "2026-06-25", status: "blocked", priority: "high",
  },
  {
    id: "t4", title: "Weed nursery rows", category: "Weeding",
    plotId: "p3", plotName: "Bajo Mono", assignee: "Carlos Pineda",
    workerId: "w3",
    due: "2026-06-19", status: "done", priority: "low",
  },
];

// Configurable per-test so both the populated board and the empty board render.
const getTasksMock = vi.fn();
vi.mock("@/lib/db/tasks", () => ({
  getTasks: () => getTasksMock(),
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
    getTasksMock.mockResolvedValue(TASKS);
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

  it("renders a single empty-state row when there are no tasks", async () => {
    getTasksMock.mockResolvedValue([]);
    const ui = await TaskTable({ plots: [], workers: [] });
    render(ui);

    // The card still frames the section, but no task rows render …
    expect(screen.getByText("All tasks")).toBeInTheDocument();
    expect(screen.queryByText("Prune Block A shade trees")).not.toBeInTheDocument();
    // … a tasteful empty-state stands in instead.
    expect(screen.getByText(/^No tasks\.?$/i)).toBeInTheDocument();
  });
});

describe("TaskTable — EntityLink wiring (Phase-5)", () => {
  it("wraps plotName in <a href=/plots/[id]> when plotId is non-null", async () => {
    getTasksMock.mockResolvedValue(TASKS);
    const ui = await TaskTable({ plots: [], workers: [] });
    render(ui);

    // t1 has plotId="p1", plotName="Tizingal Alto" → link to /plots/p1.
    // WCAG 2.5.3: aria-label names the parcela by its HUMAN name, not the raw id.
    const plotLink = screen.getByRole("link", { name: /Abrir parcela Tizingal Alto/i });
    expect(plotLink).toHaveAttribute("href", "/plots/p1");
    expect(plotLink).toHaveTextContent("Tizingal Alto");
  });

  it("shows em-dash fallback (no link) for null-plot rows", async () => {
    getTasksMock.mockResolvedValue(TASKS);
    const ui = await TaskTable({ plots: [], workers: [] });
    render(ui);

    // t3 has plotId=null → em-dash, not a link
    const emDash = screen.getByText("—");
    expect(emDash.closest("a")).toBeNull();
  });

  it("wraps assignee name in <a href=/workers/[id]> when workerId is non-null", async () => {
    getTasksMock.mockResolvedValue(TASKS);
    const ui = await TaskTable({ plots: [], workers: [] });
    render(ui);

    // t1 has workerId="w1", assignee="Marisol Quintero" → link to /workers/w1.
    // WCAG 2.5.3: aria-label names the trabajador by their HUMAN name, not the raw id.
    const workerLink = screen.getByRole("link", { name: /Abrir trabajador Marisol Quintero/i });
    expect(workerLink).toHaveAttribute("href", "/workers/w1");
    expect(workerLink).toHaveTextContent("Marisol Quintero");
  });

  it("shows plain-text assignee (no link) when workerId is null", async () => {
    getTasksMock.mockResolvedValue(TASKS);
    const ui = await TaskTable({ plots: [], workers: [] });
    render(ui);

    // t3 has workerId=null, assignee="Ana Beltrán" → no anchor wrapping the name
    const nameEl = screen.getByText("Ana Beltrán");
    expect(nameEl.closest("a")).toBeNull();
  });
});
