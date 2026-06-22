import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CupperDrift } from "@/lib/types";
import { CupperDriftCard } from "@/components/sections/qc/cupper-drift-card";

/**
 * Phase-5 L3 wire-up (audit row #12 — QC): each cupper-drift row NAMES a Worker
 * (cupperId → workers.id) but, pre-wire, clicked nowhere. Under the no-dead-UI mandate
 * the cupper identity becomes a dossier link to `/workers/[id]`. These tests assert the
 * formerly-COSMETIC worker reference now renders a real `<a href>` to the worker
 * dossier — both when a human name resolves and when only the raw id is available.
 */

const DRIFT: CupperDrift[] = [
  { cupperId: "w-cup-2", attribute: "acidity", cupperMean: 10, panelMean: 8, drift: 2, sampleN: 1 },
];

describe("CupperDriftCard — cupper is a dossier link (L3 wire-up)", () => {
  it("links the cupper name to its worker dossier", () => {
    const nameById = new Map([["w-cup-2", "Eduardo Pérez"]]);
    render(<CupperDriftCard drift={DRIFT} nameById={nameById} />);
    const link = screen.getByRole("link", { name: /Eduardo Pérez|w-cup-2/i });
    expect(link).toHaveAttribute("href", "/workers/w-cup-2");
    expect(link).toHaveTextContent("Eduardo Pérez");
  });

  it("links the raw cupper id to its worker dossier when no name is mapped", () => {
    render(<CupperDriftCard drift={DRIFT} />);
    const link = screen.getByRole("link", { name: /w-cup-2/i });
    expect(link).toHaveAttribute("href", "/workers/w-cup-2");
  });
});
