import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProcessingBatch, TrendPoint, Worker } from "@/lib/types";

// KpiRow is an async Server Component that awaits FOUR getters across three db
// modules. Mock every module it imports so the smoke test renders against a
// known shape with no network. vi.mock is hoisted; factories use TYPES only.
vi.mock("@/lib/db/workers", () => ({
  getWorkers: vi.fn(
    async (): Promise<Worker[]> => [
      {
        id: "w1", name: "Ana Pérez", role: "Picker", dailyRateUsd: 18,
        attendance: "present", startedYear: 2019, phone: "+507 6000-0001",
        todayKg: 92, crew: "Crew Norte",
      },
      {
        id: "w2", name: "Beto Díaz", role: "Picker", dailyRateUsd: 18,
        attendance: "absent", startedYear: 2021, phone: "+507 6000-0002",
        todayKg: 0, crew: "Crew Norte",
      },
      {
        id: "w3", name: "Cira Mora", role: "Supervisor", dailyRateUsd: 35,
        attendance: "present", startedYear: 2015, phone: "+507 6000-0003",
        todayKg: 0, crew: "Crew Sur",
      },
    ],
  ),
}));

vi.mock("@/lib/db/processing", () => ({
  getBatches: vi.fn(
    async (): Promise<ProcessingBatch[]> => [
      {
        id: "b1", lotCode: "JC-101", variety: "Geisha", method: "Washed",
        stage: "drying", startedDate: "2026-06-14", cherriesKg: 1200,
        currentKg: 240, moisturePct: 18, patio: "Bed 7", progressPct: 60,
      },
      {
        id: "b2", lotCode: "JC-102", variety: "Caturra", method: "Natural",
        stage: "fermentation", startedDate: "2026-06-18", cherriesKg: 900,
        currentKg: 900, moisturePct: 0, patio: "Tank 2", progressPct: 25,
      },
    ],
  ),
}));

vi.mock("@/lib/db/trends", () => ({
  getDailyCherries: vi.fn(
    async (): Promise<TrendPoint[]> => [
      { label: "Mon", value: 800 },
      { label: "Tue", value: 900 },
      { label: "Wed", value: 1000 },
    ],
  ),
  getSeason: vi.fn(async () => ({
    targetKg: 120000,
    harvestedKg: 60000,
    todayKg: 1240,
    ytdRevenueUsd: 185000,
  })),
}));

import { KpiRow } from "@/components/sections/dashboard/kpi-row";
import { getDailyCherries } from "@/lib/db/trends";

// vitest config has no globals, so RTL's auto afterEach(cleanup) isn't registered;
// register it explicitly so each test renders into a fresh document body.
afterEach(cleanup);

describe("KpiRow (smoke)", () => {
  it("renders the four headline metric labels without throwing", async () => {
    const ui = await KpiRow();
    render(ui);

    expect(screen.getByText("Today's cherries")).toBeInTheDocument();
    expect(screen.getByText("Pickers present")).toBeInTheDocument();
    expect(screen.getByText("Drying batches")).toBeInTheDocument();
    expect(screen.getByText("Season to date")).toBeInTheDocument();
  });

  it("derives values from the data layer", async () => {
    const ui = await KpiRow();
    render(ui);

    // Today's cherries = SEASON.todayKg = 1,240 kg.
    expect(screen.getByText("1,240 kg")).toBeInTheDocument();
    // Pickers present: 1 of 2 pickers (Ana present, Beto absent) → hint "of 2 pickers".
    expect(screen.getByText("of 2 pickers")).toBeInTheDocument();
    // Season to date = harvestedKg = 60,000 kg.
    expect(screen.getByText("60,000 kg")).toBeInTheDocument();
  });

  it("shows a DOWN delta when the 7-day cherry trend is falling", async () => {
    // Falling series: first (1000) > latest (700) → changePct = -30% (NEGATIVE).
    // mockResolvedValueOnce is consumed by this render only; the default
    // factory implementation stands for every other test.
    vi.mocked(getDailyCherries).mockResolvedValueOnce([
      { label: "Mon", value: 1000 },
      { label: "Tue", value: 850 },
      { label: "Wed", value: 700 },
    ] satisfies TrendPoint[]);

    const ui = await KpiRow();
    const { container } = render(ui);

    // Sanity: the delta chip shows the negative percentage it computed.
    expect(screen.getByText("-30% vs 7d ago")).toBeInTheDocument();

    // Direction is derived, not hardcoded: StatCard renders dir="down" as a
    // lucide ArrowDownRight icon (class "lucide-arrow-down-right"), NOT the
    // ArrowUpRight ("lucide-arrow-up-right") it would render for dir="up".
    expect(container.querySelector(".lucide-arrow-down-right")).not.toBeNull();
    expect(container.querySelector(".lucide-arrow-up-right")).toBeNull();
  });
});
