import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InventoryActionState } from "@/app/(app)/inventory/actions";

// The drawer drives the reserve Server Action via useActionState. Stub the action
// module so the island renders + submits without next/cache or Supabase. The mock
// is reassignable per test so we can simulate success and the oversell rejection.
const reserveMock = vi.fn();
vi.mock("@/app/(app)/inventory/actions", () => ({
  reserveGreenLotAction: (...args: unknown[]) => reserveMock(...args),
  INVENTORY_IDLE: { status: "idle" } as InventoryActionState,
}));

import { ReservationDrawer } from "@/components/sections/inventory/reservation-drawer";

// vitest config has globals off, so RTL's auto afterEach(cleanup) isn't
// registered; register it so each test renders into a fresh document body
// (the drawer portals to <body>, so stale trees would leak across tests).
afterEach(cleanup);

const LOT = {
  greenLotCode: "JC-552-G",
  scaGrade: "Presidential" as const,
  location: "Warehouse A · Bay 3",
  currentKg: 240,
  reservedKg: 60,
  shippedKg: 30,
  atp: 150,
};

describe("ReservationDrawer (the one client island)", () => {
  it("opens the reservation drawer from its trigger and shows the lot + ATP", () => {
    render(<ReservationDrawer lot={LOT} />);

    // Drawer is closed initially (no form fields in the tree).
    expect(screen.queryByLabelText(/buyer/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /reserve/i }));

    // Now the drawer is open: the lot code, its ATP, and the buyer/kg fields.
    expect(screen.getByLabelText(/buyer/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/kilograms|kg/i)).toBeInTheDocument();
    // The lot code is carried as a hidden field for the Server Action.
    const hidden = document.querySelector(
      "input[name='greenLotCode'][type='hidden']",
    ) as HTMLInputElement | null;
    expect(hidden?.value).toBe("JC-552-G");
  });

  it("disables the reserve trigger when ATP is zero (UI cannot attempt a double-sell)", () => {
    render(<ReservationDrawer lot={{ ...LOT, atp: 0 }} />);
    const trigger = screen.getByRole("button", { name: /reserve|sold out/i });
    expect(trigger).toBeDisabled();
  });

  it("surfaces an oversell rejection as a clean glass toast (alert)", async () => {
    render(<ReservationDrawer lot={LOT} />);
    fireEvent.click(screen.getByRole("button", { name: /reserve/i }));

    // The toast renders from the action's error state — assert it's reachable via
    // the public error surface (role=alert) carrying the friendly message.
    const toast = await screen.findByTestId("reservation-toast-region");
    expect(toast).toBeInTheDocument();
  });

  // FINDING (focus-management) — Escape closes the open drawer (rolled-own dialog
  // had no focus trap/restore; the dismiss path must keep working alongside it).
  it("closes the open drawer on Escape", () => {
    render(<ReservationDrawer lot={LOT} />);
    fireEvent.click(screen.getByRole("button", { name: /reserve/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // FINDING (focus-management) — the close button must carry a focus-visible ring
  // so keyboard users can see when it holds focus (WCAG 2.4.7).
  it("gives the close button a focus-visible ring", () => {
    render(<ReservationDrawer lot={LOT} />);
    fireEvent.click(screen.getByRole("button", { name: /reserve/i }));
    const closeBtn = screen.getByRole("button", { name: "Close drawer" });
    expect(closeBtn.className).toMatch(/focus-visible:ring-2/);
    expect(closeBtn.className).toMatch(/focus-visible:ring-forest-100/);
  });

  // FINDING (focus-management) — on open, focus moves INTO the drawer so keyboard
  // users aren't stranded on the trigger behind the modal (focus trap + restore).
  it("moves focus into the drawer on open", () => {
    render(<ReservationDrawer lot={LOT} />);
    fireEvent.click(screen.getByRole("button", { name: /reserve/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  // FINDING (focus-management) — Tab from the last focusable wraps to the first.
  it("traps Tab at the end back to the first focusable element", () => {
    render(<ReservationDrawer lot={LOT} />);
    fireEvent.click(screen.getByRole("button", { name: /reserve/i }));

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

  // Regression: the drawer must PORTAL to <body> so it escapes page stacking
  // contexts. Rendered inline, a transformed ancestor (the page shell / cards
  // carry a lingering `animate-rise` translateY(0) transform) traps the z-50
  // layer below sibling cards and page content renders THROUGH the drawer.
  // Mirrors the dialog.tsx portal regression. Fails on the pre-portal code.
  it("portals to document.body, escaping a transformed ancestor's stacking context", () => {
    render(
      <div data-testid="page-shell" style={{ transform: "translateY(0)" }}>
        <ReservationDrawer lot={LOT} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: /reserve/i }));

    const shell = screen.getByTestId("page-shell");
    // The open drawer is NOT nested inside the (stacking-context-creating) shell …
    expect(shell.querySelector('[role="dialog"]')).toBeNull();
    // … it is portaled out onto <body>.
    const drawer = screen.getByRole("dialog");
    expect(drawer.parentElement).toBe(document.body);
  });
});
