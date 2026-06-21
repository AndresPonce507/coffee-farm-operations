import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InventoryActionState } from "@/app/(app)/inventory/actions";

/**
 * Smoke + behaviour coverage for <GradeGreenForm> — the GRADE / materialize-green
 * client island (review finding #16: the only writer with NO UI). It drives the
 * `gradeGreenLotAction` Server Action via useActionState, so we stub the action
 * module (no next/cache, no Supabase) and make the mock reassignable per test to
 * simulate idle, success, and a friendly RPC rejection.
 *
 * The form lets the family pick a MILLED source lot, enter green-kg + cupping
 * score + warehouse location, and submit → on success it shows the new GREEN lot
 * code + its SCA grade with a link to /lots/[code]. The SCA grade preview is
 * derived from the cupping score client-side, matching the DB's GENERATED band.
 *
 * Mirrors the action-module stub idiom in reservation-drawer.test.tsx.
 */

// The action's state is what useActionState seeds/returns; the mock controls it.
let actionState: InventoryActionState = { status: "idle" };
const gradeMock = vi.fn((_prev: InventoryActionState, _fd: FormData) =>
  Promise.resolve(actionState),
);

vi.mock("@/app/(app)/inventory/actions", () => ({
  gradeGreenLotAction: (...args: [InventoryActionState, FormData]) =>
    gradeMock(...args),
  INVENTORY_IDLE: { status: "idle" } as InventoryActionState,
}));

// useActionState seeds with INVENTORY_IDLE; to assert the success state we seed
// React's hook initial value via a small wrapper that lets us inject state.
import { GradeGreenForm } from "@/components/sections/inventory/grade-green-form";

const SOURCES = ["JC-563", "JC-564", "JC-565"];

beforeEach(() => {
  actionState = { status: "idle" };
  gradeMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GradeGreenForm (grade & materialize green lot)", () => {
  it("renders its primary trigger and opens the grade dialog with all fields", () => {
    render(<GradeGreenForm sources={SOURCES} />);

    // Dialog is closed initially.
    expect(screen.queryByLabelText(/cupping score/i)).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /grade green lot/i }),
    );

    // Now the grade form is open with its four inputs.
    expect(screen.getByLabelText(/source lot/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/green kilograms|kilograms/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/cupping score/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/location|warehouse/i)).toBeInTheDocument();
  });

  it("offers each milled source lot as a choice", () => {
    render(<GradeGreenForm sources={SOURCES} />);
    fireEvent.click(screen.getByRole("button", { name: /grade green lot/i }));

    for (const code of SOURCES) {
      expect(
        screen.getByRole("option", { name: code }),
      ).toBeInTheDocument();
    }
  });

  it("shows a disabled empty-state trigger when there are no gradable sources", () => {
    render(<GradeGreenForm sources={[]} />);
    const trigger = screen.getByRole("button", { name: /grade green lot/i });
    expect(trigger).toBeDisabled();
  });

  it("previews the SCA grade live from the cupping score (matches the DB band)", () => {
    render(<GradeGreenForm sources={SOURCES} />);
    fireEvent.click(screen.getByRole("button", { name: /grade green lot/i }));

    const score = screen.getByLabelText(/cupping score/i);

    fireEvent.change(score, { target: { value: "91" } });
    expect(screen.getByText("Presidential")).toBeInTheDocument();

    fireEvent.change(score, { target: { value: "86" } });
    expect(screen.getByText("Specialty")).toBeInTheDocument();

    fireEvent.change(score, { target: { value: "82" } });
    expect(screen.getByText("Premium")).toBeInTheDocument();

    fireEvent.change(score, { target: { value: "70" } });
    expect(screen.getByText("Below Specialty")).toBeInTheDocument();
  });

  it("submits to the grade Server Action (the wired-up materialize writer)", async () => {
    render(<GradeGreenForm sources={SOURCES} />);
    fireEvent.click(screen.getByRole("button", { name: /grade green lot/i }));

    fireEvent.change(screen.getByLabelText(/source lot/i), {
      target: { value: "JC-564" },
    });
    fireEvent.change(screen.getByLabelText(/green kilograms|kilograms/i), {
      target: { value: "240" },
    });
    fireEvent.change(screen.getByLabelText(/cupping score/i), {
      target: { value: "88.5" },
    });
    fireEvent.change(screen.getByLabelText(/location|warehouse/i), {
      target: { value: "Warehouse A · Bay 3" },
    });

    fireEvent.click(screen.getByRole("button", { name: /grade & materialize|materialize|grade lot/i }));

    await waitFor(() => expect(gradeMock).toHaveBeenCalled());
  });

  it("on success shows the new GREEN lot code + grade and links to its trace page", async () => {
    actionState = {
      status: "success",
      message: "Green lot JC-564-G graded.",
      greenLotCode: "JC-564-G",
    };

    render(<GradeGreenForm sources={SOURCES} />);
    fireEvent.click(screen.getByRole("button", { name: /grade green lot/i }));
    // a cupping score so the success grade chip is populated from the band
    fireEvent.change(screen.getByLabelText(/cupping score/i), {
      target: { value: "88.5" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: /grade & materialize|materialize|grade lot/i,
      }),
    );

    // The success panel shows the minted green lot code...
    expect(await screen.findByText("JC-564-G")).toBeInTheDocument();
    // ...its banded SCA grade (88.5 -> Specialty)...
    expect(screen.getByText("Specialty")).toBeInTheDocument();
    // ...and a link to the lot's traceability page.
    const link = screen.getByRole("link", { name: /view|trace|JC-564-G/i });
    expect(link).toHaveAttribute("href", "/lots/JC-564-G");
  });

  it("surfaces a friendly RPC rejection (e.g. over-routing) as an alert", async () => {
    actionState = {
      status: "error",
      message: "materialize_green_lot: mass conservation: exceeds available mass",
    };

    render(<GradeGreenForm sources={SOURCES} />);
    fireEvent.click(screen.getByRole("button", { name: /grade green lot/i }));
    fireEvent.click(
      screen.getByRole("button", {
        name: /grade & materialize|materialize|grade lot/i,
      }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/mass conservation|exceeds/i);
  });
});
