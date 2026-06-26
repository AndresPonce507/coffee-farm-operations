import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it("renders the streamKey as an EntityLink to the lot dossier in the h2", () => {
    render(
      <AuditDrawer
        open
        onClose={vi.fn()}
        streamKey="JC-564"
        events={FIXTURE}
        chainVerified
      />,
    );

    // The h2 must contain an anchor pointing to the lot dossier.
    const h2 = screen.getByRole("heading", { level: 2 });
    const link = h2.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("/lots/JC-564");
    expect(link).toHaveTextContent("JC-564");
  });

  // FINDING (focus-management) — Escape closes the drawer (was already wired;
  // pinned so the trap work below doesn't regress the dismiss path).
  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <AuditDrawer
        open
        onClose={onClose}
        streamKey="JC-564"
        events={FIXTURE}
        chainVerified
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // FINDING (focus-management) — the close button must carry a focus-visible ring
  // so keyboard users can see when it holds focus (WCAG 2.4.7).
  it("gives the close button a focus-visible ring", () => {
    render(
      <AuditDrawer
        open
        onClose={vi.fn()}
        streamKey="JC-564"
        events={FIXTURE}
        chainVerified
      />,
    );
    const closeBtn = screen.getByRole("button", { name: "Close audit trail" });
    expect(closeBtn.className).toMatch(/focus-visible:ring-2/);
    expect(closeBtn.className).toMatch(/focus-visible:ring-forest-100/);
  });

  // FINDING (focus-management) — on open, focus must move INTO the drawer (was:
  // no focus trap, keyboard users left stranded on the trigger behind the modal).
  it("moves focus into the drawer on open", () => {
    render(
      <AuditDrawer
        open
        onClose={vi.fn()}
        streamKey="JC-564"
        events={FIXTURE}
        chainVerified
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  // FINDING (focus-management) — Tab from the last focusable wraps to the first.
  it("traps Tab at the end back to the first focusable element", () => {
    render(
      <AuditDrawer
        open
        onClose={vi.fn()}
        streamKey="JC-564"
        events={FIXTURE}
        chainVerified
      />,
    );

    const focusables = Array.from(
      screen.getByRole("dialog").querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    last.focus();
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  // FINDING (focus-management) — Shift+Tab from the first focusable wraps to last.
  it("traps Shift+Tab at the start back to the last focusable element", () => {
    render(
      <AuditDrawer
        open
        onClose={vi.fn()}
        streamKey="JC-564"
        events={FIXTURE}
        chainVerified
      />,
    );

    const focusables = Array.from(
      screen.getByRole("dialog").querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    first.focus();
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  // FINDING (focus-management) — closing restores focus to whatever was focused
  // before open, so keyboard focus returns to the trigger, not <body>.
  it("restores focus to the previously focused element on close", () => {
    document.body.innerHTML = '<button id="trigger">Open</button>';
    const trigger = document.getElementById("trigger") as HTMLButtonElement;
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(
      <AuditDrawer
        open
        onClose={vi.fn()}
        streamKey="JC-564"
        events={FIXTURE}
        chainVerified
      />,
    );
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);

    rerender(
      <AuditDrawer
        open={false}
        onClose={vi.fn()}
        streamKey="JC-564"
        events={FIXTURE}
        chainVerified
      />,
    );
    expect(document.activeElement).toBe(trigger);

    document.body.innerHTML = "";
  });

  // Regression: the slide-over must PORTAL to <body> so it escapes page stacking
  // contexts. Rendered inline, a transformed ancestor (the app shell / cards carry
  // a lingering `animate-rise` transform) traps the z-50 layer below sibling cards
  // and page content renders THROUGH the drawer. Fails on the pre-portal code.
  it("portals to document.body, escaping a transformed ancestor's stacking context", () => {
    render(
      <div data-testid="page-shell" style={{ transform: "translateY(0)" }}>
        <AuditDrawer
          open
          onClose={vi.fn()}
          streamKey="JC-564"
          events={FIXTURE}
          chainVerified
        />
      </div>,
    );
    const shell = screen.getByTestId("page-shell");
    // The drawer is NOT nested inside the (stacking-context-creating) shell …
    expect(shell.querySelector('[role="dialog"]')).toBeNull();
    // … it is portaled out onto <body>.
    const dialog = screen.getByRole("dialog");
    expect(dialog.parentElement).toBe(document.body);
  });
});
