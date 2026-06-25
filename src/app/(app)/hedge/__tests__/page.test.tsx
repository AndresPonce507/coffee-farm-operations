import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FixationCockpit } from "@/app/(app)/hedge/fixation-cockpit";
import type {
  FixationExposureRow,
  IceCMark,
} from "@/app/(app)/hedge/types";

// The cockpit IS the /hedge page's content (page.tsx is a thin async wrapper that
// resolves the pricing read ports and forwards them here). We render the cockpit
// directly with fixtures so the smoke test does NOT pull the parallel-built
// `@/lib/db/pricing` / `@/lib/db/commands/lockFixation` ports into its import
// graph (they don't exist on disk yet in this fan-out, and vi.mock can't mock a
// module Vite can't resolve). The lock action is a Server Action passed down as a
// prop — a vi.fn() stands in for it here.
afterEach(cleanup);

const noopAction = vi.fn(async () => ({ ok: true as const }));

const COMMODITY_A: FixationExposureRow = {
  priceQuoteId: 101,
  greenLotCode: "JC-COMM-1",
  reservationId: 5001,
  kg: 2000,
  iceCContractMonth: "2026-12",
  currentCPrice: 1.85,
  exposureUsd: 1000,
};
const COMMODITY_B: FixationExposureRow = {
  priceQuoteId: 102,
  greenLotCode: "JC-COMM-2",
  reservationId: 5002,
  kg: 1000,
  iceCContractMonth: "2026-12",
  currentCPrice: 1.85,
  exposureUsd: 500,
};
// A reserve lot must NEVER appear in the cockpit — it has no "C" leg to hedge.
const RESERVE: FixationExposureRow = {
  priceQuoteId: 999,
  greenLotCode: "JC-GEISHA-9",
  reservationId: 5999,
  kg: 30,
  iceCContractMonth: "2026-12",
  currentCPrice: 1.85,
  exposureUsd: 99999,
  regime: "reserve",
};
const MARK: IceCMark = {
  contractMonth: "2026-12",
  price: 1.85,
  asOf: "2026-06-25T12:00:00Z",
  source: "manual",
};

describe("/hedge fixation cockpit (smoke)", () => {
  it("renders the unfixed-price-risk headline and sums the open commodity exposure", () => {
    render(
      <FixationCockpit
        exposure={[COMMODITY_A, COMMODITY_B]}
        iceC={[MARK]}
        action={noopAction}
      />,
    );
    expect(screen.getByText("Unfixed price risk")).toBeInTheDocument();
    // 1000 + 500 = 1500 USD exposed across the two open commodity reservations.
    expect(screen.getByText(/\$1,500/)).toBeInTheDocument();
  });

  it("EXCLUDES reserve lots — the cockpit is commodity-only (the keystone)", () => {
    render(
      <FixationCockpit
        exposure={[COMMODITY_A, RESERVE]}
        iceC={[MARK]}
        action={noopAction}
      />,
    );
    expect(screen.getByText("JC-COMM-1")).toBeInTheDocument();
    // The reserve Geisha is visibly excluded.
    expect(screen.queryByText("JC-GEISHA-9")).not.toBeInTheDocument();
    // And the cockpit states the exclusion rule on the surface.
    expect(
      screen.getByText(/Only the commodity C leg can be hedged/i),
    ).toBeInTheDocument();
  });

  it("renders one lock affordance per open un-fixed reservation", () => {
    render(
      <FixationCockpit
        exposure={[COMMODITY_A, COMMODITY_B]}
        iceC={[MARK]}
        action={noopAction}
      />,
    );
    expect(
      screen.getAllByRole("button", { name: /Lock fixation/i }),
    ).toHaveLength(2);
  });

  it("shows an empty state when there is no open commodity exposure", () => {
    render(<FixationCockpit exposure={[]} iceC={[]} action={noopAction} />);
    expect(screen.getByText("Nothing to hedge")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Lock fixation/i }),
    ).not.toBeInTheDocument();
  });

  it("flags a reservation whose month has no live C mark as exposure-unknown (never a fabricated number)", () => {
    const noMark: FixationExposureRow = {
      ...COMMODITY_A,
      greenLotCode: "JC-NOMARK-1",
      currentCPrice: null,
      exposureUsd: null,
    };
    render(
      <FixationCockpit exposure={[noMark]} iceC={[]} action={noopAction} />,
    );
    expect(screen.getByText("JC-NOMARK-1")).toBeInTheDocument();
    expect(screen.getByText(/Exposure is unknown until one is entered/i)).toBeInTheDocument();
  });
});
