import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Worker } from "@/lib/types";

// Async Server Component that reads the DB layer; mock the getter so the smoke
// test renders against a known shape with no network. One active picker, one idle.
vi.mock("@/lib/db/workers", () => ({
  getPickers: vi.fn(
    async (): Promise<Worker[]> => [
      {
        id: "w1", name: "Marisol Quintero", role: "Picker", dailyRateUsd: 22,
        attendance: "present", startedYear: 2019, phone: "+507 6000-0001",
        todayKg: 145, crew: "Crew Norte",
      },
      {
        id: "w2", name: "Diego Santamaría", role: "Picker", dailyRateUsd: 22,
        attendance: "present", startedYear: 2021, phone: "+507 6000-0002",
        todayKg: 98, crew: "Crew Sur",
      },
      {
        id: "w3", name: "Ana Beltrán", role: "Picker", dailyRateUsd: 22,
        attendance: "rest-day", startedYear: 2020, phone: "+507 6000-0003",
        todayKg: 0, crew: "Crew Norte",
      },
    ],
  ),
}));

import { TopPickersCard } from "@/components/sections/harvests/top-pickers-card";

describe("TopPickersCard (smoke)", () => {
  it("renders the picker leaderboard from the data layer without throwing", async () => {
    const ui = await TopPickersCard();
    render(ui);

    expect(screen.getByText("Top pickers today")).toBeInTheDocument();
    // Active picker name + their today total render in the leaderboard.
    expect(screen.getByText("Marisol Quintero")).toBeInTheDocument();
    expect(screen.getByText("145 kg")).toBeInTheDocument();
    // The rest-day picker shows under the "Off today" group.
    expect(screen.getByText("Off today")).toBeInTheDocument();
    expect(screen.getByText("Ana Beltrán")).toBeInTheDocument();
  });

  it("active picker rows link to the worker dossier", async () => {
    const ui = await TopPickersCard();
    render(ui);

    // WCAG 2.5.3: EntityLink aria-label must contain the visible name (not slug).
    // EntityLink renders aria-label="Abrir trabajador <name>" — name is picker.name.
    const marisolLink = screen.getByRole("link", { name: /trabajador Marisol Quintero/i });
    expect(marisolLink).toHaveAttribute("href", "/workers/w1");
    expect(marisolLink).toHaveTextContent("Marisol Quintero");

    const diegoLink = screen.getByRole("link", { name: /trabajador Diego Santamaría/i });
    expect(diegoLink).toHaveAttribute("href", "/workers/w2");
    expect(diegoLink).toHaveTextContent("Diego Santamaría");
  });

  it("idle/off-today picker rows link to the worker dossier", async () => {
    const ui = await TopPickersCard();
    render(ui);

    // The idle picker (todayKg === 0) also gets an EntityLink
    const anaLink = screen.getByRole("link", { name: /trabajador Ana Beltrán/i });
    expect(anaLink).toHaveAttribute("href", "/workers/w3");
    expect(anaLink).toHaveTextContent("Ana Beltrán");
  });

  it("active picker EntityLink wrapper has flex display classes to establish width context for truncation", async () => {
    const ui = await TopPickersCard();
    render(ui);

    // The active-row EntityLink must have `flex` + `flex-col` so the inner
    // truncate <p> and baseline-aligned flex children can clamp correctly.
    const marisolLink = screen.getByRole("link", { name: /trabajador Marisol Quintero/i });
    expect(marisolLink.className).toMatch(/\bflex\b/);
    expect(marisolLink.className).toMatch(/\bflex-col\b/);
    expect(marisolLink.className).toMatch(/\bmin-w-0\b/);
  });

  it("idle picker EntityLink wrapper has block display class to establish width context for truncation", async () => {
    const ui = await TopPickersCard();
    render(ui);

    // The idle-row EntityLink must have `block` so the inner truncate <p>
    // can clamp correctly within the flex row container.
    const anaLink = screen.getByRole("link", { name: /trabajador Ana Beltrán/i });
    expect(anaLink.className).toMatch(/\bblock\b/);
    expect(anaLink.className).toMatch(/\bmin-w-0\b/);
  });
});
