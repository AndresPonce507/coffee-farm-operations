import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { QcStatus } from "@/lib/types";
import { QcStatusTable } from "@/components/sections/qc/qc-status-table";

/**
 * Phase-5 L3 wire-up (audit row #12 — QC): the green-lot CODE in each QC row NAMES a
 * Lot entity but, pre-wire, clicked nowhere (plain text). Under the no-dead-UI mandate
 * the lot code must become a dossier link to `/lots/[code]`. These tests assert the
 * formerly-COSMETIC lot reference now renders a real `<a href>` to the lot dossier —
 * the regression guard against sliding back to dead UI.
 */

const ROWS: QcStatus[] = [
  {
    greenLotCode: "JC-101",
    held: false,
    holdReason: null,
    latestCupScore: 86.5,
    primaryDefects: 0,
    secondaryDefects: 2,
  } as unknown as QcStatus,
];

describe("QcStatusTable — lot code is a dossier link (L3 wire-up)", () => {
  it("links the green-lot code to its lot dossier in the desktop table", () => {
    render(<QcStatusTable rows={ROWS} />);
    const desktop = screen.getByTestId("qc-table-desktop");
    const link = within(desktop).getByRole("link", { name: /abrir lote JC-101/i });
    expect(link).toHaveAttribute("href", "/lots/JC-101");
  });

  it("links the green-lot code to its lot dossier in the mobile card list", () => {
    render(<QcStatusTable rows={ROWS} />);
    const mobile = screen.getByTestId("qc-cards-mobile");
    const link = within(mobile).getByRole("link", { name: /JC-101/i });
    expect(link).toHaveAttribute("href", "/lots/JC-101");
  });
});
