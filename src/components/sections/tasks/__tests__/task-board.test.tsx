import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FarmTask } from "@/lib/types";

/**
 * TaskBoard is an async Server Component that awaits getTasks() from the DB
 * layer. Mock the getter so the smoke test renders against a known shape with
 * no network. Rows span every status column (todo | in-progress | blocked |
 * done) so each column renders, with one null-plot row and one overdue row
 * (due before the component's fixed 2026-06-20 "today").
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
  {
    id: "t5", title: "Mulch newly planted Geisha", category: "Planting",
    plotId: "p1", plotName: "Tizingal Alto", assignee: "Marisol Quintero",
    workerId: "w1",
    due: "2026-06-20", status: "todo", priority: "medium",
  },
];

vi.mock("@/lib/db/tasks", () => ({
  getTasks: vi.fn(async (): Promise<FarmTask[]> => TASKS),
}));

import { TaskBoard } from "@/components/sections/tasks/task-board";

describe("TaskBoard (smoke)", () => {
  it("renders all status columns and task tiles without throwing", async () => {
    const ui = await TaskBoard();
    render(ui);

    // Every column header renders.
    expect(screen.getByText("To do")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();

    // A representative task title from a populated column renders.
    expect(
      screen.getByText("Prune Block A shade trees"),
    ).toBeInTheDocument();

    // The null-plot blocked task still renders its title.
    expect(screen.getByText("Scout for broca beetle")).toBeInTheDocument();
  });

  // REGRESSION (review HIGH idx 166): the S8 migration extends the DB
  // `task_category` enum with 'Harvest' and schedule_pasada fires a real
  // category:'Harvest' task onto the phase-1 board. Before the TaskCategory
  // contract was extended, CATEGORY_ICON['Harvest'] was undefined and rendering
  // <Icon/> threw "Element type is invalid", 500-ing the whole /tasks route.
  it("renders a fired 'Harvest' task without throwing (DB enum / TS contract parity)", async () => {
    const { getTasks } = await import("@/lib/db/tasks");
    vi.mocked(getTasks).mockResolvedValueOnce([
      {
        id: "h1",
        title: "Pasada 2 — pick Geisha Alto",
        category: "Harvest",
        plotId: "p1",
        plotName: "Geisha Alto",
        assignee: "Ana Pérez",
        workerId: "w9",
        due: "2026-04-01",
        status: "todo",
        priority: "high",
      },
    ]);

    const ui = await TaskBoard();
    expect(() => render(ui)).not.toThrow();
    expect(screen.getByText("Pasada 2 — pick Geisha Alto")).toBeInTheDocument();
    // the category pill renders its label (the icon + tone resolved, no crash).
    expect(screen.getByText("Harvest")).toBeInTheDocument();
  });

  it("plotName links to /plots/[id] when plotId is non-null", async () => {
    const ui = await TaskBoard();
    render(ui);

    // t1 has plotId="p1" — EntityLink emits aria-label="Abrir parcela p1" on the <a>
    const plotLinks = screen.getAllByRole("link", { name: /Abrir parcela p1/i });
    expect(plotLinks.length).toBeGreaterThan(0);
    expect(plotLinks[0]).toHaveAttribute("href", "/plots/p1");
    // the link wraps the plot name text
    expect(plotLinks[0]).toHaveTextContent("Tizingal Alto");
  });

  it("plotName is plain text (no link) when plotId is null", async () => {
    const { getTasks } = await import("@/lib/db/tasks");
    vi.mocked(getTasks).mockResolvedValueOnce([
      {
        id: "t3b",
        title: "Scout for broca beetle",
        category: "Pest Control",
        plotId: null,
        plotName: null,
        assignee: "Ana Beltrán",
        workerId: null,
        due: "2026-06-25",
        status: "blocked",
        priority: "high",
      },
    ]);

    const ui = await TaskBoard();
    render(ui);

    // No plot link should appear for this tile (plotId is null, plotName is null)
    const links = screen.queryAllByRole("link");
    const plotLink = links.find((l) => l.getAttribute("href")?.startsWith("/plots/"));
    expect(plotLink).toBeUndefined();
  });

  it("assignee name links to /workers/[workerId] when workerId is non-null", async () => {
    const ui = await TaskBoard();
    render(ui);

    // t1 has workerId="w1" — EntityLink emits aria-label="Abrir trabajador w1" on the <a>
    const workerLinks = screen.getAllByRole("link", { name: /Abrir trabajador w1/i });
    expect(workerLinks.length).toBeGreaterThan(0);
    expect(workerLinks[0]).toHaveAttribute("href", "/workers/w1");
    // the link wraps the assignee name text
    expect(workerLinks[0]).toHaveTextContent("Marisol Quintero");
  });

  it("assignee is plain text (no worker link) when workerId is null", async () => {
    const { getTasks } = await import("@/lib/db/tasks");
    vi.mocked(getTasks).mockResolvedValueOnce([
      {
        id: "t3c",
        title: "Scout null worker",
        category: "Pest Control",
        plotId: null,
        plotName: null,
        assignee: "Ana Beltrán",
        workerId: null,
        due: "2026-06-25",
        status: "blocked",
        priority: "high",
      },
    ]);

    const ui = await TaskBoard();
    render(ui);

    // No worker link should appear for this tile (workerId is null)
    const links = screen.queryAllByRole("link");
    const workerLink = links.find((l) => l.getAttribute("href")?.startsWith("/workers/"));
    expect(workerLink).toBeUndefined();
  });
});
