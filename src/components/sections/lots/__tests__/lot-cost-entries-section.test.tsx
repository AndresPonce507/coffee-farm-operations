import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { CostEntry } from "@/lib/types";
import { LotCostEntriesSection } from "@/components/sections/lots/lot-cost-entries-section";

afterEach(cleanup);

const entries: CostEntry[] = [
  {
    id: 1,
    driver: "worker-day",
    allocationRule: "direct-labor",
    targetKind: "lot",
    targetCode: "JC-101",
    amountUsd: 120,
    reversesId: null,
    memo: "Week 1 harvest labor",
    occurredAt: "2026-05-01T00:00:00Z",
    createdAt: "2026-05-01T08:00:00Z",
  },
  {
    id: 2,
    driver: "processing-batch",
    allocationRule: "processing",
    targetKind: "lot",
    targetCode: "JC-101",
    amountUsd: 80,
    reversesId: null,
    memo: null,
    occurredAt: "2026-05-03T00:00:00Z",
    createdAt: "2026-05-03T10:00:00Z",
  },
  {
    id: 3,
    driver: "processing-batch",
    allocationRule: "processing",
    targetKind: "lot",
    targetCode: "JC-101",
    amountUsd: -30,
    reversesId: 2,
    memo: "Correction",
    occurredAt: "2026-05-04T00:00:00Z",
    createdAt: "2026-05-04T09:00:00Z",
  },
];

describe("LotCostEntriesSection", () => {
  /**
   * ANCHOR GUARD: The #cost-entries anchor on the lot dossier must resolve to a
   * real DOM node — this test proves the section renders with id="cost-entries"
   * (via DossierSection data-testid="section-cost-entries"). Without this the
   * provenance drill in CostLotCard lands on a dead fragment.
   */
  it("renders with section id='cost-entries' so the provenance anchor resolves", () => {
    render(<LotCostEntriesSection entries={entries} />);
    // DossierSection stamps data-testid="section-{id}" on the <section> element.
    expect(screen.getByTestId("section-cost-entries")).toBeInTheDocument();
  });

  it("lists all cost entries — originals and reversals both present (append-only ledger)", () => {
    render(<LotCostEntriesSection entries={entries} />);
    // All three rows render (reversals are kept, not hidden, per the append-only contract).
    expect(screen.getByTestId("cost-entry-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("cost-entry-row-2")).toBeInTheDocument();
    expect(screen.getByTestId("cost-entry-row-3")).toBeInTheDocument();
  });

  it("shows the signed amount for each entry (reversals show a negative figure)", () => {
    render(<LotCostEntriesSection entries={entries} />);
    // Original rows: positive amounts present (locale may render as "$120.00" or
    // "USD 120.00" depending on the Node.js ICU build — match on the numeric part).
    expect(screen.getByTestId("cost-entry-row-1")).toHaveTextContent("120.00");
    expect(screen.getByTestId("cost-entry-row-2")).toHaveTextContent("80.00");
    // Reversal row: negative amount — the row carries the minus sign.
    const reversalRow = screen.getByTestId("cost-entry-row-3");
    expect(reversalRow).toHaveTextContent("30.00");
    // The negative class (text-cherry) is applied to the amount span.
    const amountEl = reversalRow.querySelector(".text-cherry");
    expect(amountEl).not.toBeNull();
  });

  it("displays a memo when present, and omits it gracefully when null", () => {
    render(<LotCostEntriesSection entries={entries} />);
    expect(screen.getByTestId("cost-entry-row-1")).toHaveTextContent(
      "Week 1 harvest labor",
    );
    // Entry #2 has no memo — should not crash or show "null".
    expect(screen.getByTestId("cost-entry-row-2")).not.toHaveTextContent(
      "null",
    );
  });

  it("renders an empty state (no crash) when the lot has no directly-tagged entries", () => {
    render(<LotCostEntriesSection entries={[]} />);
    // Section still renders (the anchor must exist regardless of content).
    expect(screen.getByTestId("section-cost-entries")).toBeInTheDocument();
    // Empty affordance is shown.
    expect(screen.getByText(/sin asientos/i)).toBeInTheDocument();
  });
});
