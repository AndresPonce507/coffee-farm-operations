import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlotHarvestsSection } from "@/components/sections/plots/dossier/plot-harvests-section";
import type { Harvest } from "@/lib/types";

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
  {
    id: "h-2",
    date: "2026-06-11",
    plotId: "p-tizingal-alto",
    plotName: "Tizingal Alto",
    picker: "Desconocido",
    cherriesKg: 50,
    ripenessPct: 88,
    brixAvg: 20,
    lotCode: "JC-565",
  },
];

const pickerIds = { "Lupita González": "w-lupita" };

describe("PlotHarvestsSection", () => {
  it("links each harvest's picker → worker dossier and lot → lot dossier", () => {
    render(
      <PlotHarvestsSection harvests={harvests} pickerIds={pickerIds} />,
    );

    expect(screen.getByTestId("section-harvests")).toBeInTheDocument();

    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));

    // Picker with a resolved id → /workers/[id]
    expect(hrefs).toContain("/workers/w-lupita");
    // Lot code → /lots/[code]
    expect(hrefs).toContain("/lots/JC-564");
    // The picker's display name is the visible link text.
    expect(screen.getByText("Lupita González").closest("a")).toHaveAttribute(
      "href",
      "/workers/w-lupita",
    );
  });

  it("renders an unknown picker (no id) as plain text, not a broken link", () => {
    render(
      <PlotHarvestsSection harvests={harvests} pickerIds={pickerIds} />,
    );
    expect(screen.getByText("Desconocido")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Desconocido/ }),
    ).not.toBeInTheDocument();
  });

  it("renders the empty state when there are no harvests", () => {
    render(<PlotHarvestsSection harvests={[]} pickerIds={{}} />);
    expect(screen.getByTestId("section-harvests")).toBeInTheDocument();
    expect(screen.getByText(/Sin cosechas/i)).toBeInTheDocument();
  });
});
