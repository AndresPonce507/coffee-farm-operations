import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgingRow } from "@/app/(app)/finance/data";

// The board reads the co-located aging port. Stub it; stub the "New invoice"
// client island (interactive issue composer) so the server board's job is pinned:
// render every AR doc as a glass card with its status + balance.
const { getAgingMock } = vi.hoisted(() => ({ getAgingMock: vi.fn() }));
vi.mock("@/app/(app)/finance/data", () => ({ getAging: getAgingMock }));
vi.mock("@/app/(app)/finance/invoices/new-invoice.client", () => ({
  NewInvoice: () => <div data-testid="new-invoice-stub" />,
}));

import InvoicesPage from "@/app/(app)/finance/invoices/page";

const ISSUED: AgingRow = {
  arDocId: 1,
  kind: "commercial_invoice",
  docNumber: "JC-CI-0001",
  status: "issued",
  totalUsd: 14400,
  paidUsd: 0,
  balanceUsd: 14400,
  issuedAt: "2026-06-01T00:00:00Z",
  daysOutstanding: 20,
  agingBucket: "0-30",
};

const PAID: AgingRow = {
  arDocId: 2,
  kind: "proforma",
  docNumber: "JC-PF-0007",
  status: "paid",
  totalUsd: 5000,
  paidUsd: 5000,
  balanceUsd: 0,
  issuedAt: "2026-05-01T00:00:00Z",
  daysOutstanding: 50,
  agingBucket: "31-60",
};

beforeEach(() => getAgingMock.mockResolvedValue([ISSUED, PAID]));
afterEach(cleanup);

describe("/finance/invoices board (smoke)", () => {
  it("renders the page heading", async () => {
    render(await InvoicesPage());
    expect(
      screen.getByRole("heading", { level: 1, name: "Invoices" }),
    ).toBeInTheDocument();
  });

  it("renders each AR doc as a card with its status badge", async () => {
    render(await InvoicesPage());
    const card = screen.getByTestId("invoice-card-JC-CI-0001");
    expect(within(card).getByText("Issued")).toBeInTheDocument();
    const paid = screen.getByTestId("invoice-card-JC-PF-0007");
    expect(within(paid).getByText("Paid")).toBeInTheDocument();
  });

  it("links each card to its detail route", async () => {
    render(await InvoicesPage());
    const card = screen.getByTestId("invoice-card-JC-CI-0001");
    expect(card).toHaveAttribute("href", "/finance/invoices/JC-CI-0001");
  });

  it("shows the empty state when there are no invoices", async () => {
    getAgingMock.mockResolvedValue([]);
    render(await InvoicesPage());
    expect(screen.getByText("No invoices yet")).toBeInTheDocument();
  });
});
