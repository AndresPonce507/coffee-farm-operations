import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SprayHistory } from "@/components/sections/ipm/spray-history";
import type { SprayLogEntry } from "@/lib/types";

afterEach(cleanup);

const entry: SprayLogEntry = {
  id: 1,
  plotId: "p-talamanca",
  plotName: "Talamanca",
  product: "Verdadero 600",
  activeIngredient: "imidacloprid",
  phiDays: 14,
  reiHours: 24,
  appliedAt: "2026-06-20T08:00:00Z",
  workerId: "w-agro",
  workerName: "Lucía Mendez",
};

describe("SprayHistory (render/smoke)", () => {
  it("renders a row per spray with the product, plot and certified applicator", () => {
    render(<SprayHistory rows={[entry]} />);
    expect(screen.getByText("Verdadero 600")).toBeInTheDocument();
    expect(screen.getByText("Talamanca")).toBeInTheDocument();
    expect(screen.getByText(/Lucía Mendez/)).toBeInTheDocument();
  });

  it("surfaces the PHI/REI windows on each entry", () => {
    render(<SprayHistory rows={[entry]} />);
    expect(screen.getByText(/14/)).toBeInTheDocument(); // PHI days
  });

  it("renders an empty state when nothing has been sprayed", () => {
    render(<SprayHistory rows={[]} />);
    expect(screen.getByTestId("spray-empty")).toBeInTheDocument();
  });

  it("wires the plot name to the plot dossier (was COSMETIC)", () => {
    render(<SprayHistory rows={[entry]} />);
    const link = screen.getByRole("link", { name: /Talamanca/i });
    expect(link).toHaveAttribute("href", "/plots/p-talamanca");
  });

  it("wires the applicator name to the worker dossier (was COSMETIC)", () => {
    render(<SprayHistory rows={[entry]} />);
    const link = screen.getByRole("link", { name: /Lucía Mendez/i });
    expect(link).toHaveAttribute("href", "/workers/w-agro");
  });
});
