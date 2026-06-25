import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SamplePipelineRow } from "@/app/(app)/sales/samples/data";

// The board is a Server Component that reads the co-located sample-pipeline port.
// Stub the two getters so the async page resolves without a Supabase client, and
// stub the interactive client island so this test pins the page's ONE job: render
// every OPEN sample as a card and surface the keystone story (an approved
// pre-shipment sample of a reserve-band lot is what unlocks the contract sign).
const { getSamplePipelineMock, getSampleFormOptionsMock } = vi.hoisted(() => ({
  getSamplePipelineMock: vi.fn(),
  getSampleFormOptionsMock: vi.fn(),
}));
vi.mock("@/app/(app)/sales/samples/data", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getSamplePipeline: getSamplePipelineMock,
    getSampleFormOptions: getSampleFormOptionsMock,
  };
});
vi.mock("@/app/(app)/sales/samples/sample-actions.client", () => ({
  LogSampleButton: () => <div data-testid="log-sample-stub" />,
  RecordVerdictButton: ({ sampleId }: { sampleId: number }) => (
    <div data-testid={`verdict-stub-${sampleId}`} />
  ),
}));

import SamplesPage from "@/app/(app)/sales/samples/page";

const PRE_SHIPMENT: SamplePipelineRow = {
  sampleId: 1,
  greenLotCode: "JC-204",
  buyerId: 7,
  buyerName: "Tokyo Roasters",
  sampleKind: "pre_shipment",
  grams: 200,
  courier: "DHL",
  trackingNo: "JD0001",
  dispatchedAt: "2026-06-20T12:00:00Z",
  scaGrade: "Presidential",
  cuppingScore: 91,
};

const OFFER: SamplePipelineRow = {
  sampleId: 2,
  greenLotCode: "JC-310",
  buyerId: null,
  buyerName: null,
  sampleKind: "offer",
  grams: 100,
  courier: null,
  trackingNo: null,
  dispatchedAt: "2026-06-19T12:00:00Z",
  scaGrade: "Premium",
  cuppingScore: 83,
};

beforeEach(() => {
  getSamplePipelineMock.mockResolvedValue([PRE_SHIPMENT, OFFER]);
  getSampleFormOptionsMock.mockResolvedValue({ lots: [], buyers: [] });
});
afterEach(cleanup);

describe("/sales/samples pipeline board (smoke)", () => {
  it("renders the page heading", async () => {
    render(await SamplesPage());
    expect(
      screen.getByRole("heading", { level: 1, name: "Samples" }),
    ).toBeInTheDocument();
  });

  it("renders a card per open sample with its buyer and grams", async () => {
    render(await SamplesPage());
    const card = screen.getByTestId("sample-card-1");
    expect(within(card).getByText(/Tokyo Roasters/)).toBeInTheDocument();
    expect(within(card).getByText(/200 g/)).toBeInTheDocument();
  });

  it("flags a pre-shipment reserve-band sample with the contract-unlock note (the keystone)", async () => {
    render(await SamplesPage());
    const card = screen.getByTestId("sample-card-1");
    expect(within(card).getByText(/Reserve band/)).toBeInTheDocument();
    expect(
      within(card).getByText(/unlocks the contract sign/i),
    ).toBeInTheDocument();
  });

  it("shows a spec/type sample with no buyer and NO unlock note (commodity-grade, offer kind)", async () => {
    render(await SamplesPage());
    const card = screen.getByTestId("sample-card-2");
    expect(within(card).getByText(/Spec \/ type sample/)).toBeInTheDocument();
    expect(
      within(card).queryByText(/unlocks the contract sign/i),
    ).not.toBeInTheDocument();
  });

  it("renders a deep-linked courier tracker on a sample that has a tracking number", async () => {
    render(await SamplesPage());
    const card = screen.getByTestId("sample-card-1");
    const link = within(card).getByRole("link", { name: /track shipment/i });
    expect(link).toHaveAttribute("href", expect.stringContaining("JD0001"));
  });

  it("mounts a verdict control on every open card", async () => {
    render(await SamplesPage());
    expect(screen.getByTestId("verdict-stub-1")).toBeInTheDocument();
    expect(screen.getByTestId("verdict-stub-2")).toBeInTheDocument();
  });

  it("shows an empty state when there are no open samples", async () => {
    getSamplePipelineMock.mockResolvedValue([]);
    render(await SamplesPage());
    expect(screen.getByText("No open samples")).toBeInTheDocument();
  });
});
