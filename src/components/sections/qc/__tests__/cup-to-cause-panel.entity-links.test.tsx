import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { LotGenealogy, QcStatus } from "@/lib/types";
import { CupToCausePanel } from "@/components/sections/qc/cup-to-cause-panel";

/**
 * Phase-5 L3 wire-up (audit row #12 — QC): the cup-to-cause panel NAMES a Plot (the
 * originating masl plot) and a chain of Lot lineage codes, but pre-wire neither
 * clicked anywhere. Under the no-dead-UI mandate the plot becomes a `/plots/[id]` link
 * and each lineage stage code becomes a `/lots/[code]` link. These tests assert the
 * formerly-COSMETIC plot + lot references now render real `<a href>` to their dossiers.
 */

const GENEALOGY: LotGenealogy = {
  nodes: [
    {
      code: "JC-101",
      stage: "green",
      variety: "Geisha",
      originKg: 100,
      currentKg: 18,
      isSingleOrigin: true,
      mintedAt: "2026-06-01",
    },
    {
      code: "JC-050",
      stage: "cherry",
      variety: "Geisha",
      originKg: 100,
      currentKg: 100,
      isSingleOrigin: true,
      mintedAt: "2026-05-01",
    },
  ],
  edges: [],
};

const STATUS = {
  greenLotCode: "JC-101",
  held: false,
  holdReason: null,
  latestCupScore: 88,
  primaryDefects: 0,
  secondaryDefects: 0,
} as unknown as QcStatus;

describe("CupToCausePanel — plot + lineage codes are dossier links (L3 wire-up)", () => {
  it("links the originating plot to its plot dossier", () => {
    render(
      <CupToCausePanel
        lotCode="JC-101"
        genealogy={GENEALOGY}
        status={STATUS}
        plot={{ id: "p-tizingal", name: "Tizingal-Alto", altitudeMasl: 1650 }}
      />,
    );
    const link = screen.getByRole("link", { name: /Tizingal-Alto|plot p-tizingal/i });
    expect(link).toHaveAttribute("href", "/plots/p-tizingal");
    expect(link).toHaveTextContent("Tizingal-Alto");
  });

  it("links each lineage stage code to its lot dossier", () => {
    render(
      <CupToCausePanel lotCode="JC-101" genealogy={GENEALOGY} status={STATUS} />,
    );
    const cherry = screen.getByRole("link", { name: /JC-050/i });
    expect(cherry).toHaveAttribute("href", "/lots/JC-050");
    const green = screen.getByRole("link", { name: /lot JC-101/i });
    expect(green).toHaveAttribute("href", "/lots/JC-101");
  });

  it("renders plain text (no plot link) when the originating plot is absent", () => {
    render(
      <CupToCausePanel
        lotCode="JC-101"
        genealogy={GENEALOGY}
        status={STATUS}
        plot={null}
      />,
    );
    // The honest-degradation contract: no fabricated plot → no plot link.
    expect(
      screen.queryByRole("link", { name: /plot p-/i }),
    ).not.toBeInTheDocument();
  });
});
