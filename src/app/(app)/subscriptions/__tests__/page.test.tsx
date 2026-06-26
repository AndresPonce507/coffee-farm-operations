import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AllocatableLot, SubscriptionRow } from "@/app/(app)/subscriptions/data";

// The board is a Server Component reading the co-located port (binds to
// v_subscription_board + green_lots_atp). Stub the port so the async page resolves
// without Supabase, and stub the client island to a synchronous marker so this test
// pins the page's job: render every subscription with its allocation + dunning state,
// and surface a dunning queue for the boxes whose payment failed.
const { getSubscriptionBoardMock, getAllocatableLotsMock } = vi.hoisted(() => ({
  getSubscriptionBoardMock: vi.fn(),
  getAllocatableLotsMock: vi.fn(),
}));
vi.mock("@/app/(app)/subscriptions/data", () => ({
  getSubscriptionBoard: getSubscriptionBoardMock,
  getAllocatableLots: getAllocatableLotsMock,
}));
vi.mock("@/app/(app)/subscriptions/subscription-controls.client", () => ({
  SubscriptionControls: ({ subscriptionId }: { subscriptionId: number }) => (
    <div data-testid={`controls-${subscriptionId}`} />
  ),
}));

import SubscriptionsPage from "@/app/(app)/subscriptions/page";

const ACTIVE: SubscriptionRow = {
  id: 10,
  cadence: "monthly",
  status: "active",
  customerEmail: "ana@example.com",
  customerName: "Ana Pérez",
  allocatedKg: 12,
  dunningCount: 0,
  startedAt: "2026-01-15T12:00:00Z",
};

const PAST_DUE: SubscriptionRow = {
  id: 11,
  cadence: "quarterly",
  status: "past_due",
  customerEmail: "leo@example.com",
  customerName: "Leo Díaz",
  allocatedKg: 3,
  dunningCount: 2,
  startedAt: "2026-02-01T12:00:00Z",
};

const LOTS: AllocatableLot[] = [
  { greenLotCode: "JC-901", scaGrade: "Presidential", atpKg: 50 },
];

beforeEach(() => {
  getSubscriptionBoardMock.mockResolvedValue([ACTIVE, PAST_DUE]);
  getAllocatableLotsMock.mockResolvedValue(LOTS);
});
afterEach(cleanup);

describe("/subscriptions Reserve Club board (smoke)", () => {
  it("renders the page heading", async () => {
    render(await SubscriptionsPage());
    expect(
      screen.getByRole("heading", { level: 1, name: "Reserve Club" }),
    ).toBeInTheDocument();
  });

  it("renders a subscription card with customer, cadence and allocated kg", async () => {
    render(await SubscriptionsPage());
    const card = screen.getByTestId("sub-card-10");
    expect(within(card).getByText("Ana Pérez")).toBeInTheDocument();
    expect(within(card).getByText("Monthly")).toBeInTheDocument();
    expect(within(card).getByText(/12 kg/)).toBeInTheDocument();
    expect(within(card).getByTestId("controls-10")).toBeInTheDocument();
  });

  it("surfaces a dunning queue listing the past-due box that needs a follow-up", async () => {
    render(await SubscriptionsPage());
    const queue = screen.getByTestId("dunning-queue");
    expect(within(queue).getByText("Leo Díaz")).toBeInTheDocument();
  });

  it("shows an empty state when there are no subscriptions", async () => {
    getSubscriptionBoardMock.mockResolvedValue([]);
    render(await SubscriptionsPage());
    expect(screen.getByText("No subscriptions yet")).toBeInTheDocument();
  });
});
