import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InvoiceDetail } from "@/app/(app)/finance/data";

// The detail page is a Server Component. Stub the port + the interactive money-shaped
// island (record-payment / void) + next/navigation. Pins the server page's job: the
// instrument header, the lot-provenance lines, the realized-margin strip, and the
// payment timeline — and, per the rail, NEVER a "C"-index anchor on a reserve lot.
const { getInvoiceMock } = vi.hoisted(() => ({ getInvoiceMock: vi.fn() }));
vi.mock("@/app/(app)/finance/data", () => ({ getInvoice: getInvoiceMock }));
vi.mock("@/app/(app)/finance/invoices/[number]/payment-actions.client", () => ({
  PaymentActions: () => <div data-testid="payment-actions-stub" />,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import InvoiceDetailPage from "@/app/(app)/finance/invoices/[number]/page";

const DETAIL: InvoiceDetail = {
  doc: {
    id: 1,
    kind: "commercial_invoice",
    docNumber: "JC-CI-0001",
    status: "issued",
    incoterm: "FOB",
    buyerRef: "Tokyo Roasters",
    contractRef: "CT-1",
    totalDoc: 14400,
    currency: "USD",
    totalUsd: 14400,
    fxRateAtIssue: 1,
    issuedAt: "2026-06-01T00:00:00Z",
  },
  lines: [
    {
      id: 10,
      greenLotCode: "JC-901",
      description: "Geisha washed, Presidential",
      kg: 30,
      unitPriceDoc: 480,
      amountDoc: 14400,
    },
  ],
  payments: [
    {
      id: 100,
      method: "wire",
      amountDoc: 4400,
      currency: "USD",
      amountUsdAtReceipt: 4400,
      fxRateAtReceipt: 1,
      receivedAt: "2026-06-05T00:00:00Z",
    },
  ],
  margins: [
    {
      greenLotCode: "JC-901",
      revenueUsd: 14400,
      greenKg: 30,
      costPerKgGreen: 140,
      revenuePerKgGreen: 480,
      marginPerKgGreen: 340,
      marginUsd: 10200,
    },
  ],
  paidUsd: 4400,
  balanceUsd: 10000,
};

function params(number: string) {
  return { params: Promise.resolve({ number }) };
}

beforeEach(() => getInvoiceMock.mockResolvedValue(DETAIL));
afterEach(cleanup);

describe("/finance/invoices/[number] detail (smoke)", () => {
  it("renders the doc number as the page heading", async () => {
    render(await InvoiceDetailPage(params("JC-CI-0001")));
    expect(
      screen.getByRole("heading", { level: 1, name: "JC-CI-0001" }),
    ).toBeInTheDocument();
  });

  it("renders each line with a link to its green-lot provenance", async () => {
    render(await InvoiceDetailPage(params("JC-CI-0001")));
    const link = screen.getByRole("link", { name: /JC-901/ });
    expect(link).toHaveAttribute("href", "/lots/JC-901");
  });

  it("renders the realized-margin strip for the lot", async () => {
    render(await InvoiceDetailPage(params("JC-CI-0001")));
    const strip = screen.getByTestId("margin-strip");
    expect(within(strip).getByText("Margin / kg")).toBeInTheDocument();
    expect(within(strip).getByText(/JC-901/)).toBeInTheDocument();
  });

  it("renders the payment timeline", async () => {
    render(await InvoiceDetailPage(params("JC-CI-0001")));
    const timeline = screen.getByTestId("payment-timeline");
    expect(within(timeline).getByText("Wire")).toBeInTheDocument();
  });

  it("NEVER shows a C-index anchor on a reserve Geisha invoice (the keystone)", async () => {
    render(await InvoiceDetailPage(params("JC-CI-0001")));
    expect(screen.queryByText(/Commodity/)).not.toBeInTheDocument();
    expect(screen.queryByText(/C \+ diff/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Contract month/i)).not.toBeInTheDocument();
  });

  it("404s on an unknown doc number (never a fabricated invoice)", async () => {
    getInvoiceMock.mockResolvedValue(null);
    await expect(InvoiceDetailPage(params("JC-NOPE"))).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });
});
