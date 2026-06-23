import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PayPeriodMakeWholeSection } from "@/components/sections/pay-period/pay-period-make-whole-section";
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
    pieceRateUsd: 90,
    hourlyUsd: 0,
    minWageFloorUsd: 130,
    makeWholeUsd: 40,
    grossUsd: 130,
    cssUsd: 12,
    seguroEducativoUsd: 2,
    decimoAccrualUsd: 11,
    netUsd: 105,
    status: "calculated",
    reversesId: null,
    madeWhole: true,
    ...over,
  };
}

describe("PayPeriodMakeWholeSection", () => {
  it("lists ONLY the workers the legal-minimum floor lifted, linking each to their dossier", () => {
    render(
      <PayPeriodMakeWholeSection
        lines={[
          line({ workerId: "w-06", workerName: "Lucía Morales", madeWhole: true, makeWholeUsd: 40 }),
          line({ workerId: "w-03", workerName: "Eduardo Pérez", madeWhole: false, makeWholeUsd: 0 }),
        ]}
      />,
    );
    const section = screen.getByTestId("section-make-whole");
    // EntityLink carries the es-PA aria-label (the contract); the worker NAME is
    // the visible link text.
    const link = within(section).getByRole("link", { name: /trabajador lucía morales/i });
    expect(link).toHaveAttribute("href", "/workers/w-06");
    expect(link).toHaveTextContent("Lucía Morales");
    // the non-made-whole worker is NOT in the floor section.
    expect(within(section).queryByText("Eduardo Pérez")).not.toBeInTheDocument();
    // the top-up amount is surfaced.
    expect(within(section).getByText("+$40.00")).toBeInTheDocument();
  });

  it("renders the calm 'all above the floor' empty state when nobody was made whole", () => {
    render(<PayPeriodMakeWholeSection lines={[line({ madeWhole: false, makeWholeUsd: 0 })]} />);
    const section = screen.getByTestId("section-make-whole");
    // the empty-state copy reassures the floor never had to activate.
    expect(
      within(section).getByText(/the floor never had to kick in/i),
    ).toBeInTheDocument();
  });
});
