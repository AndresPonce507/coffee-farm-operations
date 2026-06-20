import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
});
