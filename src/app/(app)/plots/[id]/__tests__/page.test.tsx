import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  Harvest,
  IpmThresholdStatus,
  LotCost,
  Plot,
  PlotOriginStatus,
  PlotPhiStatus,
  PlotVegetation,
  SprayLogEntry,
} from "@/lib/types";

const plot: Plot = {
  id: "p-tizingal-alto",
  name: "Tizingal Alto",
  block: "Bloque A",
  variety: "Geisha",
  areaHa: 2.4,
  altitudeMasl: 1650,
  trees: 4200,
  shadePct: 35,
  establishedYear: 2014,
  status: "watch",
  lastInspected: "2026-06-10",
  expectedYieldKg: 9000,
  harvestedKg: 5400,
};

const harvests: Harvest[] = [
  {
    id: "h-1",
    date: "2026-06-12",
    plotId: "p-tizingal-alto",
    plotName: "Tizingal Alto",
    picker: "Lupita González",
    cherriesKg: 64,
    ripenessPct: 92,
    brixAvg: 21,
    lotCode: "JC-564",
  },
];
const phi: PlotPhiStatus[] = [];
const sprays: SprayLogEntry[] = [
  {
    id: 11,
    plotId: "p-tizingal-alto",
    plotName: "Tizingal Alto",
    product: "Caldo bordelés",
    activeIngredient: "Cobre",
    phiDays: 14,
    reiHours: 24,
    appliedAt: "2026-06-08",
    workerId: "w-marco",
    workerName: "Marco Pérez",
  },
];
const scouting: IpmThresholdStatus[] = [];
const vegetation: PlotVegetation = {
  plotId: "p-tizingal-alto",
  plotName: "Tizingal Alto",
  variety: "Geisha",
  altitudeMasl: 1650,
  value: 0.74,
  indexKind: "ndvi",
  confidence: "high",
  basis: "optical",
  cloudPct: 8,
  observedAt: "2026-06-09",
};
const cost: LotCost = { code: "p-tizingal-alto", costPerKgGreen: 4.25 };
const origin: PlotOriginStatus = {
  plotId: "p-tizingal-alto",
  plotName: "Tizingal Alto",
  establishedYear: 2014,
  centroid: [-82.63, 8.77],
  geolocated: true,
  deforestationFree: true,
  declBasis: "established-pre-cutoff",
  feedsLots: ["JC-564", "JC-565"],
};

const getPlotById = vi.fn(async (id: string): Promise<Plot | undefined> =>
  id === plot.id ? plot : undefined,
);

vi.mock("@/lib/db/plots", () => ({ getPlotById: (id: string) => getPlotById(id) }));
vi.mock("@/lib/db/harvests", () => ({
  getHarvestsForPlot: vi.fn(async () => harvests),
}));
vi.mock("@/lib/db/cogs", () => ({ getPlotCost: vi.fn(async () => cost) }));
vi.mock("@/lib/db/eudr", () => ({
  getPlotOriginStatus: vi.fn(async () => origin),
}));
vi.mock("@/lib/db/remote-sensing", () => ({
  getPlotVegetation: vi.fn(async () => [vegetation]),
}));
vi.mock("@/lib/db/dossier/plot", () => ({
  getPlotPhiWindows: vi.fn(async () => phi),
  getPlotSprayHistory: vi.fn(async () => sprays),
  getPlotScouting: vi.fn(async () => scouting),
  getPickerIdByName: vi.fn(async () => ({ "Lupita González": "w-lupita" })),
  getPlotYield: vi.fn(() => ({
    plotId: plot.id,
    expectedYieldKg: 9000,
    harvestedKg: 5400,
    pct: 60,
  })),
}));

const NOT_FOUND = new Error("NEXT_NOT_FOUND");
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
}));

import PlotDossierPage from "@/app/(app)/plots/[id]/page";
import { notFound } from "next/navigation";

describe("/plots/[id] dossier page", () => {
  it("renders the plot dossier for a known id with ≥4 cross-entity links", async () => {
    const ui = await PlotDossierPage({
      params: Promise.resolve({ id: "p-tizingal-alto" }),
    });
    const { container } = render(ui);

    expect(getPlotById).toHaveBeenCalledWith("p-tizingal-alto");
    expect(
      screen.getByRole("heading", { level: 1, name: /Tizingal Alto/ }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("dossier-plot")).toBeInTheDocument();

    // Connectivity AC: ≥4 cross-entity links resolved through entityHref.
    const links = Array.from(
      container.querySelectorAll<HTMLAnchorElement>("a[href]"),
    ).map((a) => a.getAttribute("href") ?? "");
    const crossLinks = links.filter(
      (h) =>
        h.startsWith("/workers/") ||
        h.startsWith("/lots/") ||
        (h.startsWith("/plots/") && h.includes("#")),
    );
    expect(crossLinks.length).toBeGreaterThanOrEqual(4);
    // Concrete targets exist.
    expect(links).toContain("/workers/w-lupita");
    expect(links).toContain("/workers/w-marco");
    expect(links.some((h) => h.startsWith("/lots/JC-564"))).toBe(true);
  });

  it("calls notFound() for an unknown plot id instead of fabricating a dossier", async () => {
    vi.mocked(notFound).mockClear();
    await expect(
      PlotDossierPage({ params: Promise.resolve({ id: "p-ghost" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledTimes(1);
  });
});
