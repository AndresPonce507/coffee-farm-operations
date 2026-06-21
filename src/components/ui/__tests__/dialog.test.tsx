import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dialog } from "@/components/ui/dialog";

// vitest config has no globals; register RTL cleanup explicitly so each test
// renders into a fresh document body.
afterEach(cleanup);

/** Render a closed-then-openable dialog with a couple of focusable children. */
function DialogWithBody({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Reserve lot">
      <input data-testid="field-name" aria-label="Name" />
      <button data-testid="submit" type="button">
        Save
      </button>
    </Dialog>
  );
}

describe("Dialog", () => {
  it("renders nothing when closed and the dialog when open (visual API unchanged)", () => {
    const { rerender } = render(<DialogWithBody open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(<DialogWithBody open onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "Reserve lot");
    // Title + children still render exactly as before (additive behavior only).
    expect(screen.getByRole("heading", { name: "Reserve lot" })).toBeInTheDocument();
    expect(screen.getByTestId("field-name")).toBeInTheDocument();
  });

  // FINDING #30 — on open, focus must move INTO the dialog (was: no initial
  // focus, keyboard users left stranded on the trigger behind the modal).
  it("moves focus into the dialog on open", () => {
    render(<DialogWithBody open onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  // FINDING #30 — Tab from the last focusable wraps to the first (forward trap).
  it("traps Tab at the end back to the first focusable element", () => {
    render(<DialogWithBody open onClose={() => {}} />);

    // Tab order excludes the tabindex="-1" backdrop button — match real
    // keyboard reachability, not every <button> in the subtree.
    const focusables = Array.from(
      screen.getByRole("dialog").querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    // Land on the last element, then Tab forward — focus must wrap to the first.
    last.focus();
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  // FINDING #30 — Shift+Tab from the first focusable wraps to the last (back trap).
  it("traps Shift+Tab at the start back to the last focusable element", () => {
    render(<DialogWithBody open onClose={() => {}} />);

    // Tab order excludes the tabindex="-1" backdrop button — match real
    // keyboard reachability, not every <button> in the subtree.
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

  // FINDING #30 — closing restores focus to whatever was focused before open,
  // so keyboard focus returns to the trigger instead of resetting to <body>.
  it("restores focus to the previously focused element on close", () => {
    // A real trigger that holds focus before the dialog opens.
    document.body.innerHTML = '<button id="trigger">Open</button>';
    const trigger = document.getElementById("trigger") as HTMLButtonElement;
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(<DialogWithBody open onClose={() => {}} />);
    // Focus moved into the dialog.
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);

    // Close → focus returns to the trigger.
    rerender(<DialogWithBody open={false} onClose={() => {}} />);
    expect(document.activeElement).toBe(trigger);

    document.body.innerHTML = "";
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<DialogWithBody open onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the backdrop is clicked", () => {
    const onClose = vi.fn();
    render(<DialogWithBody open onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("falls back to focusing the dialog container when it has no focusable children", () => {
    render(
      <Dialog open onClose={() => {}} title="Empty">
        <p>Nothing focusable here besides the close buttons.</p>
      </Dialog>,
    );
    // Even with only the built-in close affordances, focus is inside the dialog.
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
