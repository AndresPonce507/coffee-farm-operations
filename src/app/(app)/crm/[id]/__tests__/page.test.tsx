import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContactSheet } from "@/app/(app)/crm/data";

// The contact sheet is a Server Component. Stub the per-contact port + the interactive
// client island so this test pins the server page's job: render the chain-verified
// header, the append-only timeline, and the sample pipeline.
const { getContactSheetMock } = vi.hoisted(() => ({ getContactSheetMock: vi.fn() }));
vi.mock("@/app/(app)/crm/data", () => ({ getContactSheet: getContactSheetMock }));
vi.mock("@/app/(app)/crm/[id]/contact-sheet.client", () => ({
  ContactActions: () => <div data-testid="contact-actions-stub" />,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import ContactSheetPage from "@/app/(app)/crm/[id]/page";

const SHEET: ContactSheet = {
  contact: {
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
    eventCount: 2,
    lifetimeValueUsd: 18400,
  },
  email: "buyers@onyx.test",
  phone: null,
  timeline: [
    {
      eventUid: "e1",
      contactId: 1,
      kind: "inquiry",
      payload: { note: "Asked about the Geisha" },
      occurredAt: "2026-05-01T00:00:00Z",
      recordedAt: "2026-05-01T00:00:00Z",
      deviceId: "server",
      deviceSeq: 1,
    },
    {
      eventUid: "e2",
      contactId: 1,
      kind: "sample_sent",
      payload: { green_lot_code: "JC-901", grams: 250 },
      occurredAt: "2026-05-10T00:00:00Z",
      recordedAt: "2026-05-10T00:00:00Z",
      deviceId: "server",
      deviceSeq: 2,
    },
  ],
  samples: [
    {
      sampleId: 55,
      greenLotCode: "JC-901",
      contactId: 1,
      contactName: "Onyx Coffee Lab",
      grams: 250,
      kg: 0.25,
      courier: "DHL",
      trackingNo: "1Z-XYZ",
      dispatchedAt: "2026-05-10T00:00:00Z",
      scaGrade: "Presidential",
      cuppingScore: 92,
      latestVerdict: null,
    },
  ],
  chainVerified: true,
  sampleableLots: [{ greenLotCode: "JC-902", scaGrade: "Specialty", atpKg: 40 }],
};

const renderSheet = (id: string) =>
  ContactSheetPage({ params: Promise.resolve({ id }) });

beforeEach(() => getContactSheetMock.mockReset());
afterEach(cleanup);

describe("/crm/[id] contact sheet (smoke)", () => {
  it("renders the contact name as the heading", async () => {
    getContactSheetMock.mockResolvedValue(SHEET);
    render(await renderSheet("1"));
    expect(
      screen.getByRole("heading", { level: 1, name: "Onyx Coffee Lab" }),
    ).toBeInTheDocument();
  });

  it("shows the chain-verified badge when the relationship ledger verifies", async () => {
    getContactSheetMock.mockResolvedValue(SHEET);
    render(await renderSheet("1"));
    const badge = screen.getByTestId("chain-badge");
    expect(within(badge).getByText("Chain verified")).toBeInTheDocument();
  });

  it("renders the append-only timeline events", async () => {
    getContactSheetMock.mockResolvedValue(SHEET);
    render(await renderSheet("1"));
    const timeline = screen.getByTestId("contact-timeline");
    expect(within(timeline).getByText("Inquiry")).toBeInTheDocument();
    expect(within(timeline).getByText("Sample sent")).toBeInTheDocument();
  });

  it("renders the sample pipeline with an awaiting-cup verdict", async () => {
    getContactSheetMock.mockResolvedValue(SHEET);
    render(await renderSheet("1"));
    const pipeline = screen.getByTestId("sample-pipeline");
    expect(within(pipeline).getByText(/JC-901/)).toBeInTheDocument();
    expect(within(pipeline).getByText("Awaiting cup")).toBeInTheDocument();
  });

  it("mounts the interactive contact-actions island", async () => {
    getContactSheetMock.mockResolvedValue(SHEET);
    render(await renderSheet("1"));
    expect(screen.getByTestId("contact-actions-stub")).toBeInTheDocument();
  });

  it("404s when the id resolves to no contact (never a fabricated sheet)", async () => {
    getContactSheetMock.mockResolvedValue(null);
    await expect(renderSheet("999")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
