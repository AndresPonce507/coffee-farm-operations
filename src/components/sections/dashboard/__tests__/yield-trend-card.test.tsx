import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrendPoint } from "@/lib/types";

// YieldTrendCard is an async Server Component that awaits getDailyCherries.
// Mock the trends module so the smoke test renders against a known series.
vi.mock("@/lib/db/trends", () => ({
  getDailyCherries: vi.fn(
    async (): Promise<TrendPoint[]> => [
      { label: "Mon", value: 1000 },
      { label: "Tue", value: 1200 },
      { label: "Wed", value: 800 },
    ],
  ),
}));

import { YieldTrendCard } from "@/components/sections/dashboard/yield-trend-card";

// vitest config has no globals, so RTL's auto afterEach(cleanup) isn't registered;
// register it explicitly so each test renders into a fresh document body.
afterEach(cleanup);

describe("YieldTrendCard (smoke)", () => {
  it("renders the card heading and caption without throwing", async () => {
    const ui = await YieldTrendCard();
    render(ui);

    expect(screen.getByText("Daily cherry intake")).toBeInTheDocument();
    expect(screen.getByText("Last 14 days, kilograms")).toBeInTheDocument();
  });

  it("derives the period total and average from the data layer", async () => {
    const ui = await YieldTrendCard();
    render(ui);

    // total = 1000 + 1200 + 800 = 3000 → "3,000".
    expect(screen.getByText("3,000")).toBeInTheDocument();
    // avg/day = round(3000 / 3) = 1000 → "1,000 kg avg / day".
    expect(screen.getByText("1,000 kg avg / day")).toBeInTheDocument();
  });
});
