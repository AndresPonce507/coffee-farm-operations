import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuditDrawer } from "@/components/sections/audit/audit-drawer";
import type { LotEvent } from "@/lib/types";

// vitest config has globals off, so RTL's auto afterEach(cleanup) isn't
// registered; register it so each test renders into a fresh document body.
afterEach(cleanup);

const FIXTURE: LotEvent[] = [
  {
    id: "evt-1",
    streamKey: "JC-564",
    kind: "cherry_intake",
    occurredAt: "2026-06-20T13:05:00Z",
    recordedAt: "2026-06-20T13:05:02Z",
    deviceId: "lata-scale-01",
    deviceSeq: 1,
    payload: { kg: 88, ripeness_pct: 96 },
  },
  {
    id: "evt-2",
    streamKey: "JC-564",
    kind: "stage_advance",
    occurredAt: "2026-06-21T09:30:00Z",
    recordedAt: "2026-06-21T09:30:01Z",
    deviceId: "mill-tablet-01",
    deviceSeq: 2,
    payload: { from: "cherry", to: "fermentation" },
  },
];

describe("AuditDrawer (smoke)", () => {
  it("returns null when closed (stays out of the tree)", () => {
    const { container } = render(
      <AuditDrawer
        open={false}
        onClose={vi.fn()}
        streamKey="JC-564"
        events={FIXTURE}
        chainVerified
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the stream key and a row per event without throwing", () => {
    render(
      <AuditDrawer
        open
        onClose={vi.fn()}
        streamKey="JC-564"
        events={FIXTURE}
        chainVerified
      />,
    );

    // The drawer is an accessible dialog labelled by its stream.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Stream key appears in the header.
    expect(screen.getAllByText(/JC-564/).length).toBeGreaterThan(0);
    // One readable label per event kind (humanised).
    expect(screen.getByText("Cherry intake")).toBeInTheDocument();
    expect(screen.getByText("Stage advance")).toBeInTheDocument();
  });

  it("shows a green 'Chain verified' badge when chainVerified is true", () => {
    render(
      <AuditDrawer
        open
        onClose={vi.fn()}
        streamKey="JC-564"
        events={FIXTURE}
        chainVerified
      />,
    );

    const badge = screen.getByTestId("chain-badge");
    expect(badge).toHaveTextContent(/Chain verified/i);
    // Green tone class from the badge vocabulary (on the inner pill).
    const pill = badge.querySelector("span");
    expect(pill?.className).toMatch(/forest/);
  });

  it("shows an amber 'Chain unverified' badge when chainVerified is false", () => {
    render(
      <AuditDrawer
        open
        onClose={vi.fn()}
        streamKey="JC-564"
        events={FIXTURE}
        chainVerified={false}
      />,
    );

    const badge = screen.getByTestId("chain-badge");
    expect(badge).toHaveTextContent(/unverified/i);
    // Amber/honey tone (the warn vocabulary) on the inner pill, never the green.
    const pill = badge.querySelector("span");
    expect(pill?.className).toMatch(/honey/);
    expect(pill?.className).not.toMatch(/forest/);
  });

  it("renders an empty-state when the stream has no events", () => {
    render(
      <AuditDrawer
        open
        onClose={vi.fn()}
        streamKey="JC-999"
        events={[]}
        chainVerified
      />,
    );

    expect(screen.getByText(/no events/i)).toBeInTheDocument();
  });
});
