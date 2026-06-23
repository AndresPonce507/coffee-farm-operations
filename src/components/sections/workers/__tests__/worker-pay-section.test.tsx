import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WorkerPaySection } from "@/components/sections/workers/worker-pay-section";
import type { WorkerPay } from "@/lib/db/payroll";

afterEach(cleanup);

function payLine(over: Partial<WorkerPay>): WorkerPay {
  return {
    id: 1,
    payPeriodId: "pp-2026-06",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-15",
    workerId: "w-001",
    workerName: "Lupita González",
    crewName: "Cuadrilla Norte",
    hoursWorked: 80,
    pieceRateUsd: 240,
    hourlyUsd: 0,
    minWageFloorUsd: 220,
    makeWholeUsd: 0,
    grossUsd: 240,
    cssUsd: 24,
    seguroEducativoUsd: 3,
    decimoAccrualUsd: 20,
    netUsd: 213,
    status: "approved",
    reversesId: null,
    madeWhole: false,
    ...over,
  };
}

describe("WorkerPaySection", () => {
  it("links each pay line to its /pay-period/[id]", () => {
    render(<WorkerPaySection pay={[payLine({})]} />);
    const lines = screen.getByTestId("worker-pay-lines");
    expect(
      within(lines).getByRole("link", { name: /periodo de pago pp-2026-06/i }),
    ).toHaveAttribute("href", "/pay-period/pp-2026-06");
  });

  it("renders the gross and net figures", () => {
    render(<WorkerPaySection pay={[payLine({})]} />);
    expect(screen.getByText("Bruto $240.00")).toBeInTheDocument();
    expect(screen.getByText("$213.00")).toBeInTheDocument();
  });

  it("highlights a make-whole (minimum-wage lift) line", () => {
    render(
      <WorkerPaySection
        pay={[payLine({ id: 9, madeWhole: true, makeWholeUsd: 15 })]}
      />,
    );
    expect(screen.getByTestId("made-whole-9")).toHaveTextContent(
      "Ajuste a salario mínimo",
    );
  });

  it("renders the empty state with no pay history", () => {
    render(<WorkerPaySection pay={[]} />);
    expect(
      screen.getByText("Sin pagos calculados todavía"),
    ).toBeInTheDocument();
  });
});
