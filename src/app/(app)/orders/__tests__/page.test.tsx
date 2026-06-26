import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OrderCogsRow, OrderRow } from "@/app/(app)/orders/data";

// The order book is a Server Component that reads the co-located port (it binds to
// the authoritative v_order_book + v_order_cogs surface the S12 migration shipped).
// Stub the port so the async page resolves without a Supabase client, and so the
// test pins the page's job: render every order with its money breakdown, fiscal
// state, and the per-lot COGS floor (NULL ⇒ flagged, NEVER fabricated).
const { getOrderBookMock, getOrderCogsMock } = vi.hoisted(() => ({
  getOrderBookMock: vi.fn(),
  getOrderCogsMock: vi.fn(),
}));
vi.mock("@/app/(app)/orders/data", () => ({
  getOrderBook: getOrderBookMock,
  getOrderCogs: getOrderCogsMock,
}));

import OrdersPage from "@/app/(app)/orders/page";

const PAID: OrderRow = {
  id: 1,
  channel: "web",
  status: "paid",
  currency: "USD",
  subtotalCents: 4500,
  dgiTaxCents: 315,
  totalCents: 4815,
  dgiCufe: "FE-000123",
  stripePaymentIntent: "pi_1",
  customerEmail: "ana@example.com",
  customerName: "Ana Pérez",
  lineCount: 2,
  createdAt: "2026-06-20T12:00:00Z",
};

const PENDING: OrderRow = {
  id: 2,
  channel: "pos",
  status: "pending",
  currency: "USD",
  subtotalCents: 1800,
  dgiTaxCents: 126,
  totalCents: 1926,
  dgiCufe: null,
  stripePaymentIntent: null,
  customerEmail: "guest@example.com",
  customerName: null,
  lineCount: 1,
  createdAt: "2026-06-21T12:00:00Z",
};

const COGS: OrderCogsRow[] = [
  { orderId: 1, greenLotCode: "JC-901", qtyUnits: 1, lineTotalCents: 3000, costPerKgGreen: 140 },
  { orderId: 1, greenLotCode: "JC-777", qtyUnits: 1, lineTotalCents: 1500, costPerKgGreen: null },
  { orderId: 2, greenLotCode: "JC-902", qtyUnits: 1, lineTotalCents: 1800, costPerKgGreen: 3.2 },
];

beforeEach(() => {
  getOrderBookMock.mockResolvedValue([PAID, PENDING]);
  getOrderCogsMock.mockResolvedValue(COGS);
});
afterEach(cleanup);

describe("/orders order book (smoke)", () => {
  it("renders the page heading", async () => {
    render(await OrdersPage());
    expect(
      screen.getByRole("heading", { level: 1, name: "Orders" }),
    ).toBeInTheDocument();
  });

  it("renders an order card with its customer and server-computed total", async () => {
    render(await OrdersPage());
    const card = screen.getByTestId("order-card-1");
    expect(within(card).getByText("Ana Pérez")).toBeInTheDocument();
    expect(within(card).getByText(/\$48\.15/)).toBeInTheDocument();
  });

  it("surfaces the per-lot cost floor and flags a lot whose cost is not booked (never fabricated)", async () => {
    render(await OrdersPage());
    const card = screen.getByTestId("order-card-1");
    expect(within(card).getByText(/\$140\/kg green/)).toBeInTheDocument();
    expect(within(card).getByText("Cost not booked yet")).toBeInTheDocument();
  });

  it("shows the fiscal folio on a stamped order and 'pending fiscal stamp' on an unstamped one", async () => {
    render(await OrdersPage());
    expect(
      within(screen.getByTestId("order-card-1")).getByText(/FE-000123/),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("order-card-2")).getByText("Pending fiscal stamp"),
    ).toBeInTheDocument();
  });

  it("shows an empty state when there are no orders", async () => {
    getOrderBookMock.mockResolvedValue([]);
    getOrderCogsMock.mockResolvedValue([]);
    render(await OrdersPage());
    expect(screen.getByText("No orders yet")).toBeInTheDocument();
  });
});
