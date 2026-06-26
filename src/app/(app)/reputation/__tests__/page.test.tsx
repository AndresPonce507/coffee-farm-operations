import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReputationSummary } from "@/app/(app)/reputation/data";

// The wall is a Server Component reading the co-located reputation port (it binds to
// the authoritative v_lot_reputation surface the P3-S19 migration shipped). Stub the
// port so the async page resolves without a Supabase client, and so this test pins the
// page's ONE job: rank every decorated lot as a glass card — and NEVER fabricate a
// score (a lot with no cup on file shows the not-cupped copy, not a 0).
const { getReputationWallMock } = vi.hoisted(() => ({
  getReputationWallMock: vi.fn(),
}));
vi.mock("@/app/(app)/reputation/data", () => ({
  getReputationWall: getReputationWallMock,
}));

import ReputationPage from "@/app/(app)/reputation/page";

const GEISHA: ReputationSummary = {
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
  lastAccoladeAt: "2026-06-01T00:00:00Z",
};

const CATURRA: ReputationSummary = {
  lotCode: "JC-310",
  variety: "Caturra",
  qcCuppingScore: 84,
  scaGrade: "Specialty",
  bestCupScore: 85,
  accoladeCount: 1,
  awardCount: 0,
  awards: [],
  certCount: 0,
  certs: [],
  pressCount: 0,
  lastAccoladeAt: "2026-05-01T00:00:00Z",
};

beforeEach(() => getReputationWallMock.mockResolvedValue([GEISHA, CATURRA]));
afterEach(cleanup);

describe("/reputation wall of fame (smoke)", () => {
  it("renders the page heading", async () => {
    render(await ReputationPage());
    expect(
      screen.getByRole("heading", { level: 1, name: "Wall of fame" }),
    ).toBeInTheDocument();
  });

  it("renders a decorated lot as a card with its cup score and grade", async () => {
    render(await ReputationPage());
    const card = screen.getByTestId("reputation-card-JC-901");
    expect(within(card).getByText("JC-901")).toBeInTheDocument();
    expect(within(card).getByText(/92/)).toBeInTheDocument();
    expect(within(card).getByText(/Presidential/)).toBeInTheDocument();
  });

  it("never fabricates a score: a lot with no cup on file shows the not-cupped copy", async () => {
    getReputationWallMock.mockResolvedValue([{ ...CATURRA, bestCupScore: null }]);
    render(await ReputationPage());
    const card = screen.getByTestId("reputation-card-JC-310");
    expect(within(card).getByText("No cup score yet")).toBeInTheDocument();
  });

  it("shows an empty state when no lot has an accolade yet", async () => {
    getReputationWallMock.mockResolvedValue([]);
    render(await ReputationPage());
    expect(
      screen.getByText("No accolades on the books yet"),
    ).toBeInTheDocument();
  });
});
