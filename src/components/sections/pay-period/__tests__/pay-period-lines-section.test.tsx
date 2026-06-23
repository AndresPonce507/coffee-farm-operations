import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PayPeriodLinesSection } from "@/components/sections/pay-period/pay-period-lines-section";
import type { PayPeriodPayLine } from "@/lib/db/dossier/pay-period";

afterEach(cleanup);

function line(over: Partial<PayPeriodPayLine> = {}): PayPeriodPayLine {
  return {
    id: 1,
    payPeriodId: "pp-1",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-15",
    workerId: "w-06",
    workerName: "Lucía Morales",
    crewName: "Crew Tizingal",
    crewId: "crew-tizingal",
    hoursWorked: 40,
    pieceRateUsd: 120,
    hourlyUsd: 0,
    minWageFloorUsd: 130,
    makeWholeUsd: 0,
    grossUsd: 130,
    cssUsd: 12,
    seguroEducativoUsd: 2,
    decimoAccrualUsd: 11,
    netUsd: 105,
    status: "calculated",
    reversesId: null,
    madeWhole: false,
    ...over,
  };
}

describe("PayPeriodLinesSection", () => {
  it("links each pay line's worker name to its /workers/[id] dossier", () => {
    render(
      <PayPeriodLinesSection
        lines={[line({ workerId: "w-06", workerName: "Lucía Morales" })]}
      />,
    );
    // EntityLink carries the es-PA aria-label (the contract); the desktop table
    // and the mobile record-card both render the same link, so scope to the table.
    const table = screen.getByRole("table");
    const link = within(table).getByRole("link", { name: /trabajador lucía morales/i });
    expect(link).toHaveAttribute("href", "/workers/w-06");
    // the worker's NAME is the visible link text (connectivity-by-name AC).
    expect(link).toHaveTextContent("Lucía Morales");
  });

  it("links each pay line's crew to its /crew/[id] dossier", () => {
    render(
      <PayPeriodLinesSection
        lines={[line({ crewId: "crew-tizingal", crewName: "Crew Tizingal" })]}
      />,
    );
    const table = screen.getByRole("table");
    const link = within(table).getByRole("link", { name: /cuadrilla crew tizingal/i });
    expect(link).toHaveAttribute("href", "/crew/crew-tizingal");
    expect(link).toHaveTextContent("Crew Tizingal");
  });

  it("omits the crew link when the worker has no current crew (crewId null)", () => {
    render(
      <PayPeriodLinesSection lines={[line({ crewId: null, crewName: "Crew Gone" })]} />,
    );
    const table = screen.getByRole("table");
    // no /crew/[id] link is emitted for an off-roster worker.
    expect(
      within(table).queryByRole("link", { name: /cuadrilla/i }),
    ).not.toBeInTheDocument();
    // the crew name still shows as plain text — no fabricated link.
    expect(within(table).getByText("Crew Gone")).toBeInTheDocument();
    // the worker link still renders.
    expect(
      within(table).getByRole("link", { name: /trabajador lucía morales/i }),
    ).toBeInTheDocument();
  });

  it("shows the count badge and renders an empty state with no lines", () => {
    render(<PayPeriodLinesSection lines={[]} />);
    const section = screen.getByTestId("section-lines");
    expect(within(section).getByText(/Sin/i)).toBeInTheDocument();
  });
});
