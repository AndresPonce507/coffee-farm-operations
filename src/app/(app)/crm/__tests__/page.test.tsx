import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContactDirectoryRow } from "@/app/(app)/crm/data";

// The directory is a Server Component reading the co-located CRM port. Stub the port
// so the async page resolves without a Supabase client, and stub the interactive
// "new contact" island so this test pins the page's ONE job: render every contact as
// a glass roster card under the right segment.
const { getContactDirectoryMock } = vi.hoisted(() => ({
  getContactDirectoryMock: vi.fn(),
}));
vi.mock("@/app/(app)/crm/data", () => ({
  getContactDirectory: getContactDirectoryMock,
}));
vi.mock("@/app/(app)/crm/new-contact.client", () => ({
  NewContactButton: () => <div data-testid="new-contact-stub" />,
}));

import CrmPage from "@/app/(app)/crm/page";

const ROASTER: ContactDirectoryRow = {
  contactId: 1,
  name: "Onyx Coffee Lab",
  kind: "roaster",
  status: "active",
  countryCode: "US",
  preferredChannel: "email",
  buyerId: 7,
  buyerName: "Onyx Imports",
  consentMarketing: true,
  consentSource: "trade-show-2026",
  consentAt: "2026-03-01T00:00:00Z",
  unsubscribedAt: null,
  lastEventAt: "2026-06-20T00:00:00Z",
  eventCount: 4,
  lifetimeValueUsd: 18400,
};

const IMPORTER: ContactDirectoryRow = {
  contactId: 2,
  name: "Tokyo Beans Co",
  kind: "importer",
  status: "lead",
  countryCode: "JP",
  preferredChannel: "whatsapp",
  buyerId: null,
  buyerName: null,
  consentMarketing: false,
  consentSource: null,
  consentAt: null,
  unsubscribedAt: null,
  lastEventAt: null,
  eventCount: 0,
  lifetimeValueUsd: null,
};

const LOST: ContactDirectoryRow = {
  ...IMPORTER,
  contactId: 3,
  name: "Cold Trail Roasters",
  kind: "roaster",
  status: "lost",
};

const renderBoard = (segment?: string) =>
  CrmPage({ searchParams: Promise.resolve(segment ? { segment } : {}) });

beforeEach(() =>
  getContactDirectoryMock.mockResolvedValue([ROASTER, IMPORTER, LOST]),
);
afterEach(cleanup);

describe("/crm contact directory (smoke)", () => {
  it("renders the page heading", async () => {
    render(await renderBoard());
    expect(
      screen.getByRole("heading", { level: 1, name: "Contacts" }),
    ).toBeInTheDocument();
  });

  it("renders a roster card per contact, each linking to its sheet", async () => {
    render(await renderBoard());

    const card = screen.getByTestId("contact-card-1");
    expect(within(card).getByText("Onyx Coffee Lab")).toBeInTheDocument();
    expect(within(card).getByText("Roaster")).toBeInTheDocument();
    expect(card.closest("a")).toHaveAttribute("href", "/crm/1");
    expect(screen.getByTestId("contact-card-2")).toBeInTheDocument();
  });

  it("shows the marketing-consent state on each card (lawful-basis at a glance)", async () => {
    render(await renderBoard());

    const consenting = screen.getByTestId("contact-card-1");
    expect(within(consenting).getByText("Opted in")).toBeInTheDocument();

    const notConsenting = screen.getByTestId("contact-card-2");
    expect(within(notConsenting).getByText("No consent")).toBeInTheDocument();
  });

  it("filters the roster to the active segment (the segment rail)", async () => {
    render(await renderBoard("lost"));

    expect(screen.getByTestId("contact-card-3")).toBeInTheDocument();
    // The active + lead contacts are not in the "lost" segment.
    expect(screen.queryByTestId("contact-card-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("contact-card-2")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no contacts", async () => {
    getContactDirectoryMock.mockResolvedValue([]);
    render(await renderBoard());
    expect(screen.getByText("No contacts yet")).toBeInTheDocument();
  });
});
