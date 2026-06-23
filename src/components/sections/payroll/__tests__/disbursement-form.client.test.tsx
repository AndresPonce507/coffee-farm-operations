import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApprovePayLineButton,
  ComputePeriodForm,
  DisbursementForm,
  DisbursementLedger,
} from "@/components/sections/payroll/disbursement-form.client";
import type { PayrollActionState } from "@/app/(app)/payroll/state";
import type { Disbursement, WorkerPay } from "@/lib/db/payroll";

afterEach(cleanup);

/** A no-op action stub satisfying the by-shape action prop. */
const noopAction = vi.fn(
  async (): Promise<PayrollActionState> => ({ status: "idle" }),
);

function workerRow(over: Partial<WorkerPay> = {}): WorkerPay {
  return {
    id: 1,
    payPeriodId: "pp-1",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-15",
    workerId: "w-1",
    workerName: "Ana Pérez",
    crewName: "Crew Río",
    hoursWorked: 88,
    pieceRateUsd: 180,
    hourlyUsd: 0,
    minWageFloorUsd: 240,
    makeWholeUsd: 60,
    grossUsd: 240,
    cssUsd: 22.8,
    seguroEducativoUsd: 3,
    decimoAccrualUsd: 20,
    netUsd: 198.4,
    status: "calculated",
    reversesId: null,
    madeWhole: true,
    ...over,
  };
}

function disbursement(over: Partial<Disbursement> = {}): Disbursement {
  return {
    id: 1,
    payPeriodId: "pp-1",
    workerId: "w-1",
    payLineId: 1,
    amountUsd: 198.4,
    method: "yappy",
    ref: "yappy-tx-9",
    signatureRef: null,
    disbursedAt: "2026-06-22T18:00:00Z",
    ...over,
  };
}

/* ── ComputePeriodForm ─────────────────────────────────────────────────── */

describe("ComputePeriodForm", () => {
  it("renders the period fields and a calculate button without throwing", () => {
    render(<ComputePeriodForm action={noopAction} />);
    expect(document.querySelector("input[name='periodId']")).not.toBeNull();
    expect(document.querySelector("input[name='periodStart']")).not.toBeNull();
    expect(document.querySelector("input[name='periodEnd']")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: /calculate/i }),
    ).toBeInTheDocument();
  });
});

/* ── ApprovePayLineButton ──────────────────────────────────────────────── */

describe("ApprovePayLineButton", () => {
  it("renders an approve control carrying the pay-line id when the line is calculated", () => {
    render(
      <ApprovePayLineButton payLineId={7} workerName="Ana Pérez" action={noopAction} />,
    );
    const btn = screen.getByRole("button", { name: /approve .*Ana Pérez/i });
    expect(btn).toBeInTheDocument();
    expect(document.querySelector("input[name='payLineId']")).toHaveValue("7");
  });
});

/* ── DisbursementForm — signature pad gating ───────────────────────────── */

describe("DisbursementForm", () => {
  it("renders a method selector over every recognised rail", () => {
    render(
      <DisbursementForm
        payPeriodId="pp-1"
        worker={workerRow()}
        action={noopAction}
      />,
    );
    const method = document.querySelector(
      "select[name='method']",
    ) as HTMLSelectElement | null;
    expect(method).not.toBeNull();
    const text = method?.textContent ?? "";
    expect(text).toMatch(/yappy/i);
    expect(text).toMatch(/nequi/i);
    expect(text).toMatch(/ach/i);
    expect(text).toMatch(/cash/i);
  });

  it("HIDES the signature pad for an electronic rail (yappy)", () => {
    render(
      <DisbursementForm
        payPeriodId="pp-1"
        worker={workerRow()}
        action={noopAction}
      />,
    );
    // default method is yappy → no signature capture.
    expect(screen.queryByTestId("signature-pad")).not.toBeInTheDocument();
  });

  it("REVEALS the signature pad only when 'cash-signed' is selected", () => {
    render(
      <DisbursementForm
        payPeriodId="pp-1"
        worker={workerRow()}
        action={noopAction}
      />,
    );
    const method = document.querySelector(
      "select[name='method']",
    ) as HTMLSelectElement;
    fireEvent.change(method, { target: { value: "cash-signed" } });
    expect(screen.getByTestId("signature-pad")).toBeInTheDocument();
    // a hidden signatureRef field carries the captured data-url.
    expect(document.querySelector("input[name='signatureRef']")).not.toBeNull();
  });

  it("blocks submit for cash-signed until a signature is captured", () => {
    render(
      <DisbursementForm
        payPeriodId="pp-1"
        worker={workerRow()}
        action={noopAction}
      />,
    );
    const method = document.querySelector(
      "select[name='method']",
    ) as HTMLSelectElement;
    fireEvent.change(method, { target: { value: "cash-signed" } });
    // no signature captured yet → the submit control is disabled.
    const submit = screen.getByRole("button", { name: /record/i });
    expect(submit).toBeDisabled();
  });

  it("carries the worker + period ids as hidden fields", () => {
    render(
      <DisbursementForm
        payPeriodId="pp-99"
        worker={workerRow({ workerId: "w-42" })}
        action={noopAction}
      />,
    );
    expect(document.querySelector("input[name='payPeriodId']")).toHaveValue(
      "pp-99",
    );
    expect(document.querySelector("input[name='workerId']")).toHaveValue("w-42");
  });
});

/* ── DisbursementLedger — read of recorded payments ────────────────────── */

describe("DisbursementLedger", () => {
  it("renders each recorded disbursement's method and amount", () => {
    render(
      <DisbursementLedger
        disbursements={[
          disbursement({ id: 1, method: "yappy", amountUsd: 198.4 }),
          disbursement({
            id: 2,
            workerId: "w-2",
            method: "cash-signed",
            amountUsd: 120,
            signatureRef: "data:image/png;base64,AAA",
          }),
        ]}
        workerNames={{ "w-1": "Ana Pérez", "w-2": "Miguel Santos" }}
      />,
    );
    const ledger = screen.getByTestId("disbursement-ledger");
    expect(within(ledger).getByText("$198.40")).toBeInTheDocument();
    expect(within(ledger).getByText("$120.00")).toBeInTheDocument();
    expect(within(ledger).getByText(/cash/i)).toBeInTheDocument();
    expect(within(ledger).getByText("Ana Pérez")).toBeInTheDocument();
  });

  it("renders nothing when there are no recorded disbursements", () => {
    const { container } = render(
      <DisbursementLedger disbursements={[]} workerNames={{}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("wraps the worker name in an EntityLink navigating to /workers/[id]", () => {
    render(
      <DisbursementLedger
        disbursements={[disbursement({ id: 1, workerId: "w-7" })]}
        workerNames={{ "w-7": "Rosa López" }}
      />,
    );
    // EntityLink renders an <a aria-label="Abrir worker w-7">; find it by that label.
    const link = screen.getByRole("link", { name: /Abrir worker w-7/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/workers/w-7");
    // The visible worker name text lives inside the link.
    expect(link).toHaveTextContent("Rosa López");
  });
});
