import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LotGenealogy } from "@/lib/types";

// The page is an async Server Component that awaits getLotGenealogy(code).
// Mock the read port so the page composes against a seeded lineage with no Supabase.
const genealogy: LotGenealogy = {
  nodes: [
    {
      code: "JC-100",
      stage: "cherry",
      variety: "Geisha",
      originKg: 1000,
      currentKg: 1000,
      isSingleOrigin: true,
      mintedAt: "2026-05-01",
    },
    {
      code: "JC-200",
      stage: "green",
      variety: "Geisha",
      originKg: 200,
      currentKg: 200,
      isSingleOrigin: false,
      mintedAt: "2026-05-20",
    },
  ],
  edges: [
    { parentCode: "JC-100", childCode: "JC-200", kind: "process", kg: 200 },
  ],
};

vi.mock("@/lib/db/lots", () => ({
  getLotGenealogy: vi.fn(async (): Promise<LotGenealogy> => genealogy),
}));

import LotGenealogyPage from "@/app/(app)/lots/[code]/page";
import { getLotGenealogy } from "@/lib/db/lots";

describe("/lots/[code] page (smoke)", () => {
  it("awaits the seeded lot code and renders the farm-to-bag lineage graph", async () => {
    const ui = await LotGenealogyPage({
      params: Promise.resolve({ code: "JC-200" }),
    });
    render(ui);

    // The read port was called with the route's lot code.
    expect(getLotGenealogy).toHaveBeenCalledWith("JC-200");

    // The header names the lot, and the genealogy figure renders.
    expect(
      screen.getByRole("heading", { level: 1, name: /JC-200/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /genealogy/i })).toBeInTheDocument();
    // The lineage's root intake is visible in the rendered graph.
    expect(screen.getAllByText("JC-100").length).toBeGreaterThan(0);
  });
});
