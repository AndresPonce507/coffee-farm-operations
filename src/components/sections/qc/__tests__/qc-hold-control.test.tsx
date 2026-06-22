import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { QcStatus } from "@/lib/types";
import type { QcActionState } from "@/app/(app)/qc/actions";

// useActionState calls the action with (prevState, formData); each mock returns
// whatever its `next*State` is set to, so a test can script the action's outcome
// and then assert on the re-rendered island (success/error surfaces, etc.).
let nextPlaceState: QcActionState = { status: "idle" };
let nextReleaseState: QcActionState = { status: "idle" };
const placeSpy = vi.fn(
  async (_prev: QcActionState, _fd: FormData): Promise<QcActionState> =>
    nextPlaceState,
);
const releaseSpy = vi.fn(
  async (_prev: QcActionState, _fd: FormData): Promise<QcActionState> =>
    nextReleaseState,
);

vi.mock("@/app/(app)/qc/actions", () => ({
  placeQcHoldAction: (prev: QcActionState, fd: FormData): Promise<QcActionState> =>
    placeSpy(prev, fd),
  releaseQcHoldAction: (prev: QcActionState, fd: FormData): Promise<QcActionState> =>
    releaseSpy(prev, fd),
  recordCuppingSessionAction: vi.fn(),
  recordCupScoreAction: vi.fn(),
  QC_IDLE: { status: "idle" },
}));

import { QcHoldControl } from "@/components/sections/qc/qc-hold-control";

const CLEAR_LOT: QcStatus = {
  greenLotCode: "JC-9002",
  held: false,
  holdReason: null,
  latestCupScore: 91,
  primaryDefects: 0,
  secondaryDefects: 0,
};

const HELD_LOT: QcStatus = {
  greenLotCode: "JC-9001",
  held: true,
  holdReason: "off-flavor — re-cup",
  latestCupScore: 88.5,
  primaryDefects: 2,
  secondaryDefects: 5,
};

/** Open the hold drawer from a clear lot and return its dialog element. */
function openDrawer() {
  render(<QcHoldControl lot={CLEAR_LOT} />);
  fireEvent.click(screen.getByRole("button", { name: /place qc-hold/i }));
  return screen.getByRole("dialog");
}

describe("QcHoldControl — hold drawer (smoke)", () => {
  it("renders a Hold trigger for a clear lot and opens the reason drawer", () => {
    render(<QcHoldControl lot={CLEAR_LOT} />);
    const trigger = screen.getByRole("button", { name: /place qc-hold/i });
    expect(trigger).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByLabelText(/reason/i)).toBeInTheDocument();
  });
});

// FINDING #86 — the drawer declares aria-modal="true" but had no focus
// management. With aria-modal the background is promised inert; without a focus
// trap Tab walks out of the drawer, and on close focus is dropped. These tests
// fail on the pre-fix code (no initial focus, no trap, no restore).
describe("QcHoldControl — drawer focus management (#86)", () => {
  it("moves focus into the drawer on open", () => {
    const dialog = openDrawer();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("traps Tab at the last control back to the first focusable", () => {
    const dialog = openDrawer();
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    last.focus();
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("traps Shift+Tab at the first control back to the last focusable", () => {
    const dialog = openDrawer();
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    first.focus();
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("restores focus to the Hold trigger after the drawer closes", () => {
    render(<QcHoldControl lot={CLEAR_LOT} />);
    const trigger = screen.getByRole("button", { name: /place qc-hold/i });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);

    // Escape closes the drawer → focus returns to the trigger.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
  });
});

// FINDING #123 — raw Postgres exceptions must never reach the family. When the
// place RPC errors, the action surfaces `place_qc_hold: <raw>`; the drawer must
// render friendly copy, not the constraint name. Fails on the pre-fix code,
// which renders state.message verbatim.
describe("QcHoldControl — friendly error copy in the drawer (#123)", () => {
  it("maps a duplicate-key RPC error to friendly copy, hiding the raw constraint", async () => {
    nextPlaceState = {
      status: "error",
      message:
        'place_qc_hold: duplicate key value violates unique constraint "qc_holds_device_id_device_seq_key"',
    };
    const dialog = openDrawer();
    fireEvent.submit(dialog.querySelector("form") as HTMLFormElement);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/already recorded/i);
    expect(alert.textContent ?? "").not.toMatch(/qc_holds_device_id_device_seq_key/);
    expect(alert.textContent ?? "").not.toMatch(/place_qc_hold:/);
    expect(alert.textContent ?? "").not.toMatch(/duplicate key value/);
  });

  it("maps a foreign-key violation to a 'lot doesn't exist' message", async () => {
    nextPlaceState = {
      status: "error",
      message:
        'place_qc_hold: insert or update violates foreign key constraint "qc_holds_green_lot_code_fkey"',
    };
    const dialog = openDrawer();
    fireEvent.submit(dialog.querySelector("form") as HTMLFormElement);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/doesn't exist|does not exist/i);
    expect(alert.textContent ?? "").not.toMatch(/foreign key constraint/);
    expect(alert.textContent ?? "").not.toMatch(/place_qc_hold:/);
  });

  it("falls back to generic friendly copy for an unrecognized error", async () => {
    nextPlaceState = {
      status: "error",
      message: "place_qc_hold: some_internal_pg_failure 0x1234",
    };
    const dialog = openDrawer();
    fireEvent.submit(dialog.querySelector("form") as HTMLFormElement);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").not.toMatch(/place_qc_hold:/);
    expect(alert.textContent ?? "").not.toMatch(/some_internal_pg_failure/);
    expect(alert.textContent ?? "").toMatch(/try again|couldn't/i);
  });
});

// FINDING #85 — the Release button had no error surface: a failed release flipped
// silently back to "Release" with no feedback. It must render an inline alert when
// the release action resolves to an error. Fails on the pre-fix code.
describe("QcHoldControl — release error surface (#85)", () => {
  it("surfaces an inline alert when a release fails, and keeps the button clickable", async () => {
    nextReleaseState = {
      status: "error",
      message: "release_qc_hold: connection reset",
    };
    render(<QcHoldControl lot={HELD_LOT} />);
    const releaseBtn = screen.getByRole("button", { name: /release qc-hold/i });
    expect(releaseBtn).not.toBeDisabled();

    fireEvent.submit(releaseBtn.closest("form") as HTMLFormElement);

    const alert = await screen.findByRole("alert");
    expect(alert).toBeInTheDocument();
    // The friendly message renders (not a raw labelled string) …
    expect(alert.textContent ?? "").not.toMatch(/release_qc_hold:/);
    // … and the button stays usable for a retry (only pending/success disable it).
    expect(
      screen.getByRole("button", { name: /release qc-hold/i }),
    ).not.toBeDisabled();
  });
});
