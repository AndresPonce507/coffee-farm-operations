import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WeatherDay } from "@/lib/types";

// WeatherStripCard is an async Server Component that awaits getWeather.
// Mock the weather module so the smoke test renders against a known forecast.
vi.mock("@/lib/db/weather", () => ({
  getWeather: vi.fn(
    async (): Promise<WeatherDay[]> => [
      { day: "Today", hi: 24, lo: 14, rainPct: 20, icon: "sun" },
      { day: "Fri", hi: 23, lo: 13, rainPct: 60, icon: "rain" },
      { day: "Sat", hi: 22, lo: 13, rainPct: 40, icon: "cloud" },
      { day: "Sun", hi: 21, lo: 12, rainPct: 70, icon: "fog" },
      { day: "Mon", hi: 25, lo: 15, rainPct: 10, icon: "sun" },
    ],
  ),
}));

import { WeatherStripCard } from "@/components/sections/dashboard/weather-strip-card";

// vitest config has no globals, so RTL's auto afterEach(cleanup) isn't registered;
// register it explicitly so each test renders into a fresh document body.
afterEach(cleanup);

describe("WeatherStripCard (smoke)", () => {
  it("renders the forecast heading and caption without throwing", async () => {
    const ui = await WeatherStripCard();
    render(ui);

    expect(screen.getByText("Volcán forecast")).toBeInTheDocument();
    expect(screen.getByText("Chiriquí highlands · 5-day")).toBeInTheDocument();
  });

  it("renders a tile per forecast day from the data layer", async () => {
    const ui = await WeatherStripCard();
    render(ui);

    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Fri")).toBeInTheDocument();
    expect(screen.getByText("Sat")).toBeInTheDocument();
    // rainPct renders as a "20%" style text node.
    expect(screen.getByText("20%")).toBeInTheDocument();
    // Accessible condition label is exposed via the icon's aria-label.
    expect(screen.getAllByLabelText("Sunny").length).toBe(2);
  });
});
