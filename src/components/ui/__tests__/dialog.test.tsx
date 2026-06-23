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

  // FINDING (focus-management) — the header close button must carry a
  // focus-visible ring so keyboard users can see when it holds focus (WCAG 2.4.7).
  it("gives the header close button a focus-visible ring", () => {
    render(<DialogWithBody open onClose={() => {}} />);
    const closeBtn = screen.getByRole("button", { name: "Close dialog" });
    expect(closeBtn.className).toMatch(/focus-visible:ring-2/);
    expect(closeBtn.className).toMatch(/focus-visible:ring-forest-100/);
  });

  // Regression: the modal must PORTAL to <body> so it escapes page stacking
  // contexts. Rendered inline, a transformed ancestor (the app shell / cards carry
  // a lingering `animate-rise` transform) traps the z-50 layer below sibling cards
  // and page content renders THROUGH the modal. Fails on the pre-portal code.
  it("portals to document.body, escaping a transformed ancestor's stacking context", () => {
    render(
      <div data-testid="page-shell" style={{ transform: "translateY(0)" }}>
        <DialogWithBody open onClose={() => {}} />
      </div>,
    );
    const shell = screen.getByTestId("page-shell");
    // The dialog is NOT nested inside the (stacking-context-creating) shell …
    expect(shell.querySelector('[role="dialog"]')).toBeNull();
    // … it is portaled out onto <body>.
    const dialog = screen.getByRole("dialog");
    expect(dialog.parentElement).toBe(document.body);
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

  // FINDING #46 — the panel must CAP its height and SCROLL its body. The crew
  // rehire strip drops the worker-profile sheet (an unbounded, append-only
  // attendance ledger) into this primitive; with no max-h / overflow the panel
  // grows past the viewport and overflows symmetrically off both edges (the
  // overlay is `fixed inset-0 grid place-items-center` and body scroll is
  // locked), pushing the title + close buttons off-screen and stranding touch
  // users. The panel must be height-capped and its body scrollable so the
  // header (title + X) stays pinned while overflowing content scrolls.
  it("caps the panel height and scrolls a long body so the header never overflows off-screen", () => {
    // A body taller than any viewport — simulating a multi-season ledger.
    const rows = Array.from({ length: 60 }, (_, i) => (
      <p key={i} data-testid="ledger-row">
        Attendance event {i + 1}
      </p>
    ));
    render(
      <Dialog open onClose={() => {}} title="Worker profile">
        {rows}
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog");

    // The panel itself is height-capped (so it can never exceed the viewport).
    const panel = dialog.querySelector<HTMLElement>(".max-h-\\[85svh\\]");
    expect(panel).not.toBeNull();

    // The long children live inside a scroll container so they are reachable.
    const firstRow = screen.getAllByTestId("ledger-row")[0];
    const scrollContainer = firstRow.closest(".overflow-y-auto");
    expect(scrollContainer).not.toBeNull();
    // …and that scroll container is the height-capped panel's own descendant.
    expect(panel?.contains(scrollContainer)).toBe(true);
  });

  // FINDING #46 — the title + Close affordance must stay in the DOM (and outside
  // the scroll region) even when the body overflows, so touch users always have a
  // reachable dismiss control instead of being trapped with only Escape.
  it("keeps the title and Close control mounted and outside the scrollable body when content overflows", () => {
    const rows = Array.from({ length: 60 }, (_, i) => (
      <p key={i} data-testid="ledger-row">
        Attendance event {i + 1}
      </p>
    ));
    render(
      <Dialog open onClose={() => {}} title="Worker profile">
        {rows}
      </Dialog>,
    );

    // Title heading + the explicit close button both still render.
    expect(
      screen.getByRole("heading", { name: "Worker profile" }),
    ).toBeInTheDocument();
    const closeBtn = screen.getByRole("button", { name: "Close dialog" });
    expect(closeBtn).toBeInTheDocument();

    // The close button is NOT inside the scrollable body — it lives in the
    // pinned header, so it stays visible while the ledger scrolls beneath it.
    expect(closeBtn.closest(".overflow-y-auto")).toBeNull();
  });
});
