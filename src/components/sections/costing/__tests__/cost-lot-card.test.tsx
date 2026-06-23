import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LotRuleCost } from "@/lib/types";

import { CostLotCard } from "@/components/sections/costing/cost-lot-card";

// vitest config has no globals, so RTL's auto afterEach(cleanup) isn't
// registered; register it so each test renders into a fresh document body.
afterEach(cleanup);

/**
 * The FULLY-ALLOCATED per-rule breakdown the card now reads (cogs_breakdown_per_lot)
 * — the SAME allocation the headline divides, so Σ(usd)/greenKg === headline. Over
 * 60 kg green: labor 120 ($2/kg) + processing 50 ($0.83/kg) + agronomy 30 ($0.50/kg)
 * + overhead 40 ($0.67/kg) = $240 → $4.00/kg. (Reversals are netted in-DB, so the
 * processing $50 already reflects an $80 charge less a $30 correction.)
 */
const breakdown: LotRuleCost[] = [
  { rule: "direct-labor", allocatedUsd: 120 },
  { rule: "processing", allocatedUsd: 50 },
  { rule: "agronomy", allocatedUsd: 30 },
  { rule: "overhead", allocatedUsd: 40 },
];

describe("CostLotCard (smoke + provenance)", () => {
  it("renders the lot code headline and the true cost-per-kg-green figure", () => {
    render(
      <CostLotCard
        code="JC-101"
        costPerKgGreen={4.0}
        greenKg={60}
        breakdown={breakdown}
      />,
    );

    expect(screen.getByText("JC-101")).toBeInTheDocument();
    // Headline figure carries the RPC verdict, formatted to 2dp $/kg.
    const headline = screen.getByTestId("cost-headline-JC-101");
    expect(headline).toHaveTextContent("$4.00");
  });

  it("shows an em-dash (never a fabricated 0) when cost-per-kg-green is null", () => {
    render(
      <CostLotCard
        code="JC-404"
        costPerKgGreen={null}
        greenKg={0}
        breakdown={[]}
      />,
    );
    const headline = screen.getByTestId("cost-headline-JC-404");
    expect(headline).toHaveTextContent("—");
    expect(headline).not.toHaveTextContent("$0");
  });

  it("renders a per-lot waterfall and decomposition bar from the allocated breakdown", () => {
    render(
      <CostLotCard
        code="JC-101"
        costPerKgGreen={4.0}
        greenKg={60}
        breakdown={breakdown}
      />,
    );
    // Both charts render (their <defs>-bearing material is in the DOM as <svg>).
    expect(screen.getByTestId("cost-waterfall-JC-101")).toBeInTheDocument();
    expect(screen.getByTestId("cost-decomposition-JC-101")).toBeInTheDocument();
  });

  it("lot code headline is an EntityLink navigating to the lot dossier", () => {
    render(
      <CostLotCard
        code="JC-101"
        costPerKgGreen={4.0}
        greenKg={60}
        breakdown={breakdown}
      />,
    );
    // The lot code must be wrapped in an <a> pointing at /lots/JC-101 (no hash).
    // Only the headline carries aria-label="Abrir lote JC-101" — the provenance
    // link intentionally has NO `name` so its visible text is its accessible name.
    const headlineLink = screen.getByRole("link", { name: "Abrir lote JC-101" });
    expect(headlineLink).toHaveAttribute("href", "/lots/JC-101");
    expect(headlineLink).toHaveTextContent("JC-101");
  });

  it("provenance link uses EntityLink (kind=lot, anchor=cost-entries)", () => {
    render(
      <CostLotCard
        code="JC-101"
        costPerKgGreen={4.0}
        greenKg={60}
        breakdown={breakdown}
      />,
    );
    // EntityLink renders an <a> with aria-label="Abrir lote JC-101".
    // With anchor="cost-entries" it resolves to /lots/JC-101#cost-entries.
    const prov = screen.getByTestId("cost-provenance-JC-101");
    // The testid is on a span inside the <a>; climb to the parent link.
    const link = prov.closest("a");
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute("href", "/lots/JC-101#cost-entries");
  });

  it("WCAG 2.5.3 Label-in-Name: provenance link's accessible name IS its visible text (no name={code} aria-label)", () => {
    render(
      <CostLotCard
        code="JC-101"
        costPerKgGreen={4.0}
        greenKg={60}
        breakdown={breakdown}
      />,
    );
    const prov = screen.getByTestId("cost-provenance-JC-101");
    const link = prov.closest("a")!;
    // The provenance link must NOT carry an "Abrir lote JC-101" aria-label — that
    // text isn't visible on this affordance, so it would violate Label-in-Name.
    expect(link).not.toHaveAttribute("aria-label");
    // Its accessible name comes from the visible text instead.
    expect(link).toHaveAccessibleName(/cost drivers? · provenance/);
  });

  it("links to provenance with the count of contributing cost drivers (not a misleading ledger-row count)", () => {
    render(
      <CostLotCard
        code="JC-101"
        costPerKgGreen={4.0}
        greenKg={60}
        breakdown={breakdown}
      />,
    );
    const prov = screen.getByTestId("cost-provenance-JC-101");
    // Climb from the span to the parent EntityLink <a>.
    const link = prov.closest("a")!;
    // The provenance affordance points at the lot's ledger (the audit trail).
    expect(link).toHaveAttribute("href", expect.stringContaining("JC-101"));
    // All four rules are non-zero here, so "4 cost drivers".
    expect(prov).toHaveTextContent("4");
    expect(prov).toHaveTextContent(/driver/);
  });

  it("D-COST CRIT: the per-category readouts reconcile to the headline — overhead + agronomy are NOT $0", () => {
    render(
      <CostLotCard
        code="JC-101"
        costPerKgGreen={4.0}
        greenKg={60}
        breakdown={breakdown}
      />,
    );
    // overhead 40/60 = $0.67/kg, agronomy 30/60 = $0.50/kg — present, not $0.00.
    const overhead = screen.getByTestId("cost-category-perkg-overhead");
    expect(within(overhead).getByText(/\$0\.67/)).toBeInTheDocument();
    const agronomy = screen.getByTestId("cost-category-perkg-agronomy");
    expect(within(agronomy).getByText(/\$0\.50/)).toBeInTheDocument();
    // labor 120/60 = $2.00, processing (already netted in-DB) 50/60 = $0.83.
    const labor = screen.getByTestId("cost-category-perkg-direct-labor");
    expect(within(labor).getByText(/\$2\.00/)).toBeInTheDocument();
    const proc = screen.getByTestId("cost-category-perkg-processing");
    expect(within(proc).getByText(/\$0\.83/)).toBeInTheDocument();
    // The four per-kg figures sum to the $4.00/kg headline (2.00+0.83+0.50+0.67).
  });
});
