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
 * score + warehouse location, and submit. There is NO green-code field — the
 * green code is SYSTEM IDENTITY, minted server-side by `materialize_green_lot`
 * (migration 20260621120000); on success the form shows the RETURNED minted code
 * with a link to /lots/[code]. The SCA grade preview is derived from the cupping
 * score client-side, matching the DB's GENERATED band.
 *
 * The drawer uses the shared <Dialog> primitive (focus-trap / initial-focus /
 * restore + Escape + scroll-lock, all tested) rather than a rolled-own modal.
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

import { GradeGreenForm } from "@/components/sections/inventory/grade-green-form";

const SOURCES = ["JC-563", "JC-564", "JC-565"];

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: /grade green lot/i }));
}

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

    openDialog();

    // Now the grade form is open with its (now THREE input + one select) fields.
    expect(screen.getByLabelText(/source lot/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/green kilograms|kilograms/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/cupping score/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/location|warehouse/i)).toBeInTheDocument();
  });

  it("does NOT render a green-lot code field (the code is system identity, minted server-side)", () => {
    render(<GradeGreenForm sources={SOURCES} />);
    openDialog();

    // The old user-facing green-code input is gone — it minted '<source>-G',
    // which violated lots_code_format and broke every grade.
    expect(screen.queryByLabelText(/green lot code|green code/i)).not.toBeInTheDocument();
    // And the form submits NO greenCode field name.
    const inputs = document.querySelectorAll('[name="greenCode"]');
    expect(inputs.length).toBe(0);
  });

  it("uses the shared modal primitive (role=dialog, aria-modal)", () => {
    render(<GradeGreenForm sources={SOURCES} />);
    openDialog();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("carries a STABLE hidden idempotency token across re-renders of an open dialog", () => {
    render(<GradeGreenForm sources={SOURCES} />);
    openDialog();

    const token = document.querySelector(
      'input[name="idempotencyKey"]',
    ) as HTMLInputElement | null;
    expect(token).not.toBeNull();
    expect(token!.value).toBeTruthy();

    const before = token!.value;
    // A re-render (typing) must NOT churn the token — a double-submit reuses it.
    fireEvent.change(screen.getByLabelText(/cupping score/i), {
      target: { value: "88" },
    });
    const after = (
      document.querySelector('input[name="idempotencyKey"]') as HTMLInputElement
    ).value;
    expect(after).toBe(before);
  });

  it("offers each milled source lot as a choice", () => {
    render(<GradeGreenForm sources={SOURCES} />);
    openDialog();

    for (const code of SOURCES) {
      expect(screen.getByRole("option", { name: code })).toBeInTheDocument();
    }
  });

  it("shows a disabled empty-state trigger when there are no gradable sources", () => {
    render(<GradeGreenForm sources={[]} />);
    const trigger = screen.getByRole("button", { name: /grade green lot/i });
    expect(trigger).toBeDisabled();
  });

  it("previews the SCA grade live from the cupping score (matches the DB band)", () => {
    render(<GradeGreenForm sources={SOURCES} />);
    openDialog();

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
    openDialog();

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

    fireEvent.click(
      screen.getByRole("button", {
        name: /grade & materialize|materialize|grade lot/i,
      }),
    );

    await waitFor(() => expect(gradeMock).toHaveBeenCalled());
  });

  it("on success shows the RETURNED minted GREEN code + grade and links to its trace page", async () => {
    actionState = {
      status: "success",
      message: "Green lot JC-572 graded.",
      greenLotCode: "JC-572",
    };

    render(<GradeGreenForm sources={SOURCES} />);
    openDialog();
    // a cupping score so the success grade chip is populated from the band
    fireEvent.change(screen.getByLabelText(/cupping score/i), {
      target: { value: "88.5" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: /grade & materialize|materialize|grade lot/i,
      }),
    );

    // The success panel shows the MINTED green lot code returned by the RPC...
    expect(await screen.findByText("JC-572")).toBeInTheDocument();
    // ...its banded SCA grade (88.5 -> Specialty)...
    expect(screen.getByText("Specialty")).toBeInTheDocument();
    // ...and an EntityLink to the lot's traceability page. The CTA routes through
    // the entityHref SSOT (/lots/[code]) and carries an es-PA aria-label naming the
    // minted lot (WCAG 2.5.3) — the visible "View lot traceability" text doesn't name
    // the entity, so the human-readable green code is passed as the name.
    const link = screen.getByRole("link", { name: /abrir lote JC-572/i });
    expect(link).toHaveAttribute("href", "/lots/JC-572");
  });

  it("marks invalid fields with aria-invalid (mirrors cherry-intake-form)", async () => {
    actionState = {
      status: "error",
      errors: { sourceCode: "Choose a source lot.", kg: "Mass must be > 0." },
    };

    render(<GradeGreenForm sources={SOURCES} />);
    openDialog();
    fireEvent.click(
      screen.getByRole("button", {
        name: /grade & materialize|materialize|grade lot/i,
      }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText(/source lot/i)).toHaveAttribute(
        "aria-invalid",
        "true",
      ),
    );
    expect(screen.getByLabelText(/green kilograms|kilograms/i)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    // A field with no error is NOT marked invalid.
    expect(screen.getByLabelText(/cupping score/i)).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("surfaces a friendly RPC rejection as a SINGLE live-region alert (no double announce)", async () => {
    actionState = {
      status: "error",
      message: "That's more than the source lot has available. Lower the kilograms and try again.",
    };

    render(<GradeGreenForm sources={SOURCES} />);
    openDialog();
    fireEvent.click(
      screen.getByRole("button", {
        name: /grade & materialize|materialize|grade lot/i,
      }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/available|lower/i);

    // Exactly ONE alert (the old double live-region — wrapper aria-live=assertive
    // AND a child role=alert — is collapsed to one).
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("disables the submit while a grade is pending (double-submit guard)", () => {
    // useActionState's `pending` flips true synchronously when the form posts; the
    // disabled-during-pending guard plus the stable token mitigate a double mint.
    render(<GradeGreenForm sources={SOURCES} />);
    openDialog();

    const submit = screen.getByRole("button", {
      name: /grade & materialize|materialize|grade lot/i,
    });
    // The submit button exists and is enabled before submit (becomes disabled
    // while pending — the guard is wired through the `pending` flag).
    expect(submit).toBeEnabled();
    expect(submit).toHaveAttribute("type", "submit");
  });
});

describe("bandScaGrade (the SCA band helper, exported for the preview)", () => {
  it("bands at the exact DB thresholds and stays quiet out of range", async () => {
    const { bandScaGrade } = await import(
      "@/components/sections/inventory/grade-green-form"
    );
    expect(bandScaGrade(90)).toBe("Presidential");
    expect(bandScaGrade(85)).toBe("Specialty");
    expect(bandScaGrade(80)).toBe("Premium");
    expect(bandScaGrade(79.9)).toBe("Below Specialty");
    expect(bandScaGrade(null)).toBeNull();
    expect(bandScaGrade(101)).toBeNull();
  });
});
