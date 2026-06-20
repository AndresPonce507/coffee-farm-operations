import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// SeasonHero is an async Server Component that awaits getSeason. Mock the trends
// module so the smoke test renders against a known season summary with no network.
vi.mock("@/lib/db/trends", () => ({
  getSeason: vi.fn(async () => ({
    targetKg: 120000,
    harvestedKg: 60000,
    todayKg: 1240,
    ytdRevenueUsd: 185000,
  })),
}));

import { SeasonHero } from "@/components/sections/dashboard/season-hero";

// vitest config has no globals, so RTL's auto afterEach(cleanup) isn't registered;
// register it explicitly so each test renders into a fresh document body.
afterEach(cleanup);

describe("SeasonHero (smoke)", () => {
  it("renders the season greeting and supporting stat labels without throwing", async () => {
    const ui = await SeasonHero();
    render(ui);

    // Greeting heading uses BRAND.shortName.
    expect(
      screen.getByRole("heading", { name: /Buenos días, Janson/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Harvested YTD")).toBeInTheDocument();
    // AD-4: the estimate signal lives in the READOUT (an "est." prefix + lighter
    // ink), not the label — so the label is plainly "Revenue".
    expect(screen.getByText("Revenue")).toBeInTheDocument();
    // "Season target" labels both the HeroStat tile and the progress ring.
    expect(screen.getAllByText("Season target").length).toBeGreaterThan(0);
  });

  it("derives figures from the data layer", async () => {
    const ui = await SeasonHero();
    render(ui);

    // Headline today's cherries = num(1240) = "1,240".
    expect(screen.getByText("1,240")).toBeInTheDocument();
    // Est. revenue = usd(185000) = "$185,000".
    expect(screen.getByText("$185,000")).toBeInTheDocument();
    // Harvested YTD = kg(60000) = "60,000 kg" (also appears in the ring sublabel).
    expect(screen.getAllByText("60,000 kg").length).toBeGreaterThan(0);
  });

  it("renders modeled revenue with the AD-4 estimate treatment in the readout itself", async () => {
    const ui = await SeasonHero();
    const { container } = render(ui);

    // AD-4: a modeled figure (revenue, not yet from real sales) must be visually
    // distinct IN THE READOUT — lighter ink + an explicit "est." prefix on the
    // VALUE — never relying on the label alone. Find the value node carrying the
    // estimate marker and assert it is muted, while the measured harvest figure
    // sits at full ink.
    const estPrefix = screen.getByText("est.");
    expect(estPrefix).toBeInTheDocument();

    // The revenue VALUE node is muted (lighter ink), distinct from measured tiles.
    const revenueValue = container.querySelector('[data-modeled="true"]');
    expect(revenueValue).not.toBeNull();
    expect(revenueValue?.className).toMatch(/text-paper\/60|text-muted-fg|opacity/);
    expect(revenueValue?.textContent).toContain("$185,000");

    // Measured harvest tile is NOT marked modeled (full visual weight).
    const measured = container.querySelectorAll('[data-modeled="true"]');
    expect(measured.length).toBe(1);
  });
});
