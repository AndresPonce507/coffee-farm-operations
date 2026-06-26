import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LotReputationDetail } from "@/app/(app)/reputation/data";

// The detail page is a Server Component reading the co-located reputation port. Stub
// the port + the interactive client island so this test pins the server page's job:
// render the lot's append-only ledger + the chain-verified stamp, and 404 on an
// unknown lot_code (the ⌘K palette or a hand-typed URL must never fabricate a record).
const { getLotReputationMock } = vi.hoisted(() => ({
  getLotReputationMock: vi.fn(),
}));
vi.mock("@/app/(app)/reputation/data", () => ({
  getLotReputation: getLotReputationMock,
}));
vi.mock("@/app/(app)/reputation/[lot]/accolade-composer.client", () => ({
  AccoladeComposer: () => <div data-testid="accolade-composer-stub" />,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import LotReputationPage from "@/app/(app)/reputation/[lot]/page";

const DETAIL: LotReputationDetail = {
  lotCode: "JC-901",
  variety: "Geisha",
  qcCuppingScore: 89.5,
  scaGrade: "Presidential",
  bestCupScore: 92,
  accoladeCount: 3,
  awardCount: 1,
  awards: ["Best of Panama 2025"],
  certCount: 1,
  certs: ["Organic"],
  pressCount: 1,
  lastAccoladeAt: "2026-06-02T00:00:00Z",
  chainVerified: true,
  accolades: [
    {
      id: 1,
      kind: "cup-score",
      title: null,
      score: 92,
      awardedBy: "Estate cupping table",
      awardYear: null,
      evidenceUrl: null,
      reversesId: null,
      occurredAt: "2026-05-20T00:00:00Z",
      reversed: false,
    },
    {
      id: 2,
      kind: "award",
      title: "Best of Panama 2025",
      score: null,
      awardedBy: "SCAP",
      awardYear: 2025,
      evidenceUrl: "https://example.org/bop",
      reversesId: null,
      occurredAt: "2026-06-01T00:00:00Z",
      reversed: false,
    },
    {
      id: 3,
      kind: "certification",
      title: "Organic",
      score: null,
      awardedBy: "USDA",
      awardYear: null,
      evidenceUrl: null,
      reversesId: null,
      occurredAt: "2026-06-02T00:00:00Z",
      reversed: false,
    },
  ],
};

const renderLot = (lot: string) =>
  LotReputationPage({ params: Promise.resolve({ lot }) });

beforeEach(() => getLotReputationMock.mockReset());
afterEach(cleanup);

describe("/reputation/[lot] reputation ledger (smoke)", () => {
  it("renders the lot code heading", async () => {
    getLotReputationMock.mockResolvedValue(DETAIL);
    render(await renderLot("JC-901"));
    expect(
      screen.getByRole("heading", { level: 1, name: "JC-901" }),
    ).toBeInTheDocument();
  });

  it("shows the chain-verified stamp when the ledger verifies", async () => {
    getLotReputationMock.mockResolvedValue(DETAIL);
    render(await renderLot("JC-901"));
    expect(screen.getByText("Chain-verified")).toBeInTheDocument();
  });

  it("renders the append-only ledger with an award entry", async () => {
    getLotReputationMock.mockResolvedValue(DETAIL);
    render(await renderLot("JC-901"));
    const timeline = screen.getByTestId("accolade-timeline");
    expect(within(timeline).getByText("Best of Panama 2025")).toBeInTheDocument();
  });

  it("mounts the interactive accolade composer island", async () => {
    getLotReputationMock.mockResolvedValue(DETAIL);
    render(await renderLot("JC-901"));
    expect(screen.getByTestId("accolade-composer-stub")).toBeInTheDocument();
  });

  it("404s on an unknown lot (never a fabricated record)", async () => {
    getLotReputationMock.mockResolvedValue(null);
    await expect(renderLot("JC-999")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
