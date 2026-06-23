import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CupperDrift } from "@/lib/types";
import { CupperDriftCard } from "@/components/sections/qc/cupper-drift-card";

/**
 * Phase-5 L3 wire-up (audit row #12 — QC): each cupper-drift row NAMES a Worker
 * (cupperId → workers.id) but, pre-wire, clicked nowhere. Under the no-dead-UI mandate
 * the cupper identity becomes a dossier link to `/workers/[id]`. These tests assert the
 * formerly-COSMETIC worker reference now renders a real `<a href>` to the worker
 * dossier — both when a human name resolves and when only the raw id is available.
 *
 * next/link is mocked to a plain <a> that FORWARDS all props (including aria-label)
 * so we can assert WCAG 2.5.3 Label-in-Name correctness: EntityLink's aria-label must
 * announce the human name, not the opaque slug.
 */

// Mock next/link to render a plain <a> forwarding all props so aria-label is preserved.
// Using createElement to avoid needing JSX in the factory (vitest hoists vi.mock calls
// before imports, so JSX transform from the React plugin may not be active yet).
vi.mock("next/link", () => {
  const React = require("react");
  return {
    default: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
      React.createElement("a", { href, ...rest }, children),
  };
});

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

  /**
   * WCAG 2.5.3 Label in Name — the aria-label MUST announce the human name, not
   * the raw slug, when a name is available. Without `name={name}` on EntityLink,
   * aria-label is "Abrir trabajador w-cup-2" even when the screen shows "Eduardo Pérez",
   * violating Label-in-Name for the ~90% Ngäbe-Buglé crew who rely on screen readers.
   */
  it("aria-label announces the human name (WCAG 2.5.3) when name is resolved", () => {
    const nameById = new Map([["w-cup-2", "Eduardo Pérez"]]);
    render(<CupperDriftCard drift={DRIFT} nameById={nameById} />);
    // With next/link forwarding aria-label, the attribute must contain the human name.
    const link = screen.getByRole("link", { name: /Eduardo Pérez/i });
    expect(link).toHaveAttribute("aria-label", "Abrir trabajador Eduardo Pérez");
    expect(link).not.toHaveAttribute("aria-label", "Abrir trabajador w-cup-2");
  });

  it("aria-label is absent when no name is mapped (text content is the accessible name)", () => {
    render(<CupperDriftCard drift={DRIFT} />);
    const link = screen.getByRole("link", { name: /w-cup-2/i });
    // No name → EntityLink does not set aria-label; the raw id text content IS the name.
    expect(link).not.toHaveAttribute("aria-label");
  });
});
