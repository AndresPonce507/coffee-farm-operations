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
    expect(screen.getByText("Est. revenue")).toBeInTheDocument();
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
});
