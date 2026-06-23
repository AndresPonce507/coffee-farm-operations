import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Harvest } from "@/lib/types";

// Async Server Component that reads the DB layer; mock the getter so the smoke
// test renders against a known shape with no network.
vi.mock("@/lib/db/harvests", () => ({
  getHarvests: vi.fn(
    async (): Promise<Harvest[]> => [
      {
        id: "h1", date: "2026-06-20", plotId: "p1", plotName: "Tizingal Alto",
        picker: "Marisol Quintero", workerId: "w1", cherriesKg: 120, ripenessPct: 96,
        brixAvg: 21.4, lotCode: "JC-564",
      },
      {
        id: "h2", date: "2026-06-19", plotId: "p2", plotName: "Paso Ancho",
        picker: "Diego Santamaría", workerId: "w2", cherriesKg: 80, ripenessPct: 90,
        brixAvg: 20.0, lotCode: "JC-565",
      },
    ],
  ),
}));

// HarvestRowActions imports the Server Actions; stub them so the table renders
// without pulling in next/cache or the Supabase client.
vi.mock("@/lib/actions/harvests", () => ({
  createHarvest: vi.fn(),
  updateHarvest: vi.fn(),
  deleteHarvest: vi.fn(),
  IDLE: { status: "idle" },
}));

import { HarvestLogTable } from "@/components/sections/harvests/harvest-log-table";

describe("HarvestLogTable (smoke)", () => {
  it("renders the traceability ledger from the data layer without throwing", async () => {
    const ui = await HarvestLogTable({ plots: [], pickers: [], lots: [] });
    render(ui);

    expect(screen.getByText("Harvest log")).toBeInTheDocument();
    // Lot codes and plot names from the two rows surface in the table body.
    expect(screen.getByText("JC-564")).toBeInTheDocument();
    expect(screen.getByText("Tizingal Alto")).toBeInTheDocument();
    expect(screen.getByText("Paso Ancho")).toBeInTheDocument();
  });

  it("lot codes link to /lots/[code]", async () => {
    const ui = await HarvestLogTable({ plots: [], pickers: [], lots: [] });
    const { container } = render(ui);

    // EntityLink carries aria-label="Abrir lot <code>"; match on the text content.
    const lotLinks = container.querySelectorAll<HTMLAnchorElement>('a[href="/lots/JC-564"]');
    expect(lotLinks.length).toBeGreaterThan(0);
    expect(lotLinks[0]).toHaveTextContent("JC-564");

    const lotLinks2 = container.querySelectorAll<HTMLAnchorElement>('a[href="/lots/JC-565"]');
    expect(lotLinks2.length).toBeGreaterThan(0);
    expect(lotLinks2[0]).toHaveTextContent("JC-565");
  });

  it("plot names link to /plots/[id]", async () => {
    const ui = await HarvestLogTable({ plots: [], pickers: [], lots: [] });
    const { container } = render(ui);

    const plotLink = container.querySelector<HTMLAnchorElement>('a[href="/plots/p1"]');
    expect(plotLink).not.toBeNull();
    expect(plotLink).toHaveTextContent("Tizingal Alto");

    const plotLink2 = container.querySelector<HTMLAnchorElement>('a[href="/plots/p2"]');
    expect(plotLink2).not.toBeNull();
    expect(plotLink2).toHaveTextContent("Paso Ancho");
  });

  it("picker names link to /workers/[id]", async () => {
    const ui = await HarvestLogTable({ plots: [], pickers: [], lots: [] });
    const { container } = render(ui);

    const pickerLink = container.querySelector<HTMLAnchorElement>('a[href="/workers/w1"]');
    expect(pickerLink).not.toBeNull();
    expect(pickerLink).toHaveTextContent("Marisol Quintero");

    const pickerLink2 = container.querySelector<HTMLAnchorElement>('a[href="/workers/w2"]');
    expect(pickerLink2).not.toBeNull();
    expect(pickerLink2).toHaveTextContent("Diego Santamaría");
  });
});
