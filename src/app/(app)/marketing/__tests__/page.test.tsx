import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MarketingConsole } from "@/app/(app)/marketing/data";

// The console is a Server Component reading the co-located marketing port (it binds to
// the authoritative v_campaign_board / v_marketing_audience / v_delivery_log surface
// the P3-S20 migration shipped). Stub the port so the async page resolves without a
// Supabase client, and stub the client console island (its composer + send flow aren't
// this test's job) so the page test pins its ONE job: render the campaign board, the
// trigger board, and the delivery log — and surface the consent-gated audience the
// owner can lawfully reach.
const { getMarketingConsoleMock } = vi.hoisted(() => ({
  getMarketingConsoleMock: vi.fn(),
}));
vi.mock("@/app/(app)/marketing/data", () => ({
  getMarketingConsole: getMarketingConsoleMock,
}));
vi.mock("@/app/(app)/marketing/marketing-console.client", () => ({
  MarketingConsole: () => <div data-testid="marketing-console-stub" />,
}));

import MarketingPage from "@/app/(app)/marketing/page";

const LAUNCH = {
  campaignId: 1,
  name: "Lot launch — JC-901",
  triggerKind: "lot-launch" as const,
  greenLotCode: "JC-901",
  status: "draft" as const,
  createdAt: "2026-06-20T00:00:00Z",
  updatedAt: "2026-06-20T00:00:00Z",
  queuedTotal: 0,
  sentTotal: 0,
};

const MANUAL = {
  campaignId: 2,
  name: "Spring roaster note",
  triggerKind: "manual" as const,
  greenLotCode: null,
  status: "sent" as const,
  createdAt: "2026-05-01T00:00:00Z",
  updatedAt: "2026-05-02T00:00:00Z",
  queuedTotal: 14,
  sentTotal: 14,
};

const consoleData = (over: Partial<MarketingConsole> = {}): MarketingConsole => ({
  campaigns: [LAUNCH, MANUAL],
  audience: [
    {
      contactId: 10,
      name: "Onyx Coffee Lab",
      kind: "roaster",
      countryCode: "US",
      preferredChannel: "email",
      consentSource: "trade-show",
      consentAt: "2026-04-01T00:00:00Z",
    },
    {
      contactId: 11,
      name: "Tim Wendelboe",
      kind: "roaster",
      countryCode: "NO",
      preferredChannel: "email",
      consentSource: "website",
      consentAt: "2026-04-02T00:00:00Z",
    },
  ],
  deliveryLog: [
    {
      outboundId: 100,
      campaignId: 2,
      campaignName: "Spring roaster note",
      contactId: 10,
      contactName: "Onyx Coffee Lab",
      channel: "email",
      status: "sent",
      sentAt: "2026-05-02T00:00:00Z",
      createdAt: "2026-05-02T00:00:00Z",
    },
  ],
  lots: [{ lotCode: "JC-901", cupScore: 89.5, scaGrade: "Specialty" }],
  ...over,
});

beforeEach(() => getMarketingConsoleMock.mockResolvedValue(consoleData()));
afterEach(cleanup);

describe("/marketing lifecycle console (smoke)", () => {
  it("renders the page heading", async () => {
    render(await MarketingPage());
    expect(
      screen.getByRole("heading", { level: 1, name: "Marketing" }),
    ).toBeInTheDocument();
  });

  it("renders a campaign card with its status and lot", async () => {
    render(await MarketingPage());
    const card = screen.getByTestId("campaign-card-1");
    expect(within(card).getByText("Lot launch — JC-901")).toBeInTheDocument();
    expect(within(card).getByText("Draft")).toBeInTheDocument();
  });

  it("renders the three lifecycle trigger explainers", async () => {
    render(await MarketingPage());
    const board = screen.getByTestId("trigger-board");
    expect(within(board).getByText("Lot launch")).toBeInTheDocument();
    expect(within(board).getByText("Replenishment")).toBeInTheDocument();
    expect(within(board).getByText("Sample follow-up")).toBeInTheDocument();
  });

  it("lists a delivered message in the delivery log", async () => {
    render(await MarketingPage());
    expect(screen.getByTestId("delivery-row-100")).toBeInTheDocument();
  });

  it("always renders the console island (the composer + human-confirmed send)", async () => {
    render(await MarketingPage());
    expect(screen.getByTestId("marketing-console-stub")).toBeInTheDocument();
  });

  it("shows an empty state when there are no campaigns", async () => {
    getMarketingConsoleMock.mockResolvedValue(consoleData({ campaigns: [] }));
    render(await MarketingPage());
    expect(screen.getByText("No campaigns yet")).toBeInTheDocument();
  });
});
