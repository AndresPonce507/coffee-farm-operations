import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { QrPayslip } from "@/components/sections/payroll/qr-payslip";
import { PAYSLIP_TERMS } from "@/components/sections/payroll/labels";
import type { Payslip } from "@/lib/db/payroll";

afterEach(cleanup);

/** A baseline payslip — es-only, no make-whole top-up. */
function basePayslip(overrides: Partial<Payslip> = {}): Payslip {
  return {
    payLineId: 101,
    payPeriodId: "pp-2026-06-a",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-15",
    season: "2026 main harvest",
    workerId: "w-7",
    workerName: "Eduardo Bejarano",
    preferredName: null,
    languages: ["spanish"],
    hoursWorked: 88,
    pieceRateUsd: 240.5,
    hourlyUsd: 60,
    makeWholeUsd: 0,
    grossUsd: 300.5,
    cssUsd: 28.55,
    seguroEducativoUsd: 3.76,
    decimoAccrualUsd: 25.04,
    netUsd: 243.15,
    status: "approved",
    ...overrides,
  };
}

describe("QrPayslip", () => {
  it("renders a payslip without throwing", () => {
    render(<QrPayslip payslip={basePayslip()} />);
    expect(screen.getByTestId("qr-payslip")).toBeInTheDocument();
  });

  it("renders the worker name and period header", () => {
    render(<QrPayslip payslip={basePayslip()} />);
    const card = screen.getByTestId("qr-payslip");
    expect(within(card).getByText("Eduardo Bejarano")).toBeInTheDocument();
  });

  it("renders the prominent net take-home figure", () => {
    render(<QrPayslip payslip={basePayslip()} />);
    const net = screen.getByTestId("payslip-net");
    expect(net).toBeInTheDocument();
    expect(within(net).getByText("$243.15")).toBeInTheDocument();
  });

  it("renders the gross and statutory deduction lines", () => {
    render(<QrPayslip payslip={basePayslip()} />);
    const card = screen.getByTestId("qr-payslip");
    // gross
    expect(within(card).getByText("$300.50")).toBeInTheDocument();
    // CSS / Seguro Educativo / décimo deductions (shown as negatives)
    expect(within(card).getByText("-$28.55")).toBeInTheDocument();
    expect(within(card).getByText("-$3.76")).toBeInTheDocument();
    expect(within(card).getByText("-$25.04")).toBeInTheDocument();
  });

  it("RENDERS and highlights the make-whole line when make_whole_usd > 0", () => {
    render(
      <QrPayslip payslip={basePayslip({ makeWholeUsd: 14.2, netUsd: 257.35 })} />,
    );
    const makeWhole = screen.getByTestId("payslip-make-whole");
    expect(makeWhole).toBeInTheDocument();
    expect(within(makeWhole).getByText("$14.20")).toBeInTheDocument();
    // highlighted (honey/forest accent) — data flag the component sets.
    expect(makeWhole).toHaveAttribute("data-highlight", "true");
  });

  it("OMITS the make-whole line when make_whole_usd is 0", () => {
    render(<QrPayslip payslip={basePayslip({ makeWholeUsd: 0 })} />);
    expect(screen.queryByTestId("payslip-make-whole")).not.toBeInTheDocument();
  });

  it("shows the ngäbere term when languages includes ngäbere", () => {
    render(
      <QrPayslip
        payslip={basePayslip({ languages: ["spanish", "ngäbere"] })}
      />,
    );
    const card = screen.getByTestId("qr-payslip");
    // the bilingual net label carries the ngäbere placeholder.
    expect(
      within(card).getByText(new RegExp(PAYSLIP_TERMS.takeHome.ng)),
    ).toBeInTheDocument();
  });

  it("omits the ngäbere term for an es-only worker", () => {
    render(<QrPayslip payslip={basePayslip({ languages: ["spanish"] })} />);
    const card = screen.getByTestId("qr-payslip");
    expect(
      within(card).queryByText(new RegExp(PAYSLIP_TERMS.takeHome.ng)),
    ).not.toBeInTheDocument();
  });

  it("renders the QR block", () => {
    render(<QrPayslip payslip={basePayslip()} />);
    expect(screen.getByTestId("payslip-qr")).toBeInTheDocument();
  });

  it("renders the preferred name as the headline when present", () => {
    render(
      <QrPayslip
        payslip={basePayslip({ preferredName: "Lalo" })}
      />,
    );
    const card = screen.getByTestId("qr-payslip");
    expect(within(card).getByText("Lalo")).toBeInTheDocument();
    expect(within(card).getByText("Eduardo Bejarano")).toBeInTheDocument();
  });
});
