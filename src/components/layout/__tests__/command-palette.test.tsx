import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { CommandPalette } from "@/components/layout/command-palette";

afterEach(() => {
  cleanup();
  push.mockReset();
});

function open() {
  render(<CommandPalette />);
  fireEvent.click(screen.getByTestId("command-palette-trigger"));
  return screen.getByTestId("command-palette");
}

describe("CommandPalette (S9)", () => {
  it("opens from the trigger and lists the nav routes (incl. the S5/S7/S8 routes)", () => {
    open();
    expect(screen.getByTestId("command-result-/inventory")).toBeInTheDocument();
    expect(screen.getByTestId("command-result-/costing")).toBeInTheDocument();
    expect(screen.getByTestId("command-result-/eudr")).toBeInTheDocument();
  });

  it("opens with the ⌘K shortcut", () => {
    render(<CommandPalette />);
    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
  });

  it("filters the routes by the typed query", () => {
    open();
    fireEvent.change(screen.getByLabelText("Search routes and lots"), {
      target: { value: "cost" },
    });
    expect(screen.getByTestId("command-result-/costing")).toBeInTheDocument();
    expect(
      screen.queryByTestId("command-result-/plots"),
    ).not.toBeInTheDocument();
  });

  it("offers a jump-to-lot action for a typed lot number and navigates to /lots/JC-NNN", () => {
    open();
    fireEvent.change(screen.getByLabelText("Search routes and lots"), {
      target: { value: "701" },
    });
    const lot = screen.getByTestId("command-result-/lots/JC-701");
    expect(lot).toHaveTextContent("Go to lot JC-701");
    fireEvent.click(lot);
    expect(push).toHaveBeenCalledWith("/lots/JC-701");
  });

  it("normalizes 'jc-711' style input to the JC-NNN lot route", () => {
    open();
    fireEvent.change(screen.getByLabelText("Search routes and lots"), {
      target: { value: "jc-711" },
    });
    expect(
      screen.getByTestId("command-result-/lots/JC-711"),
    ).toBeInTheDocument();
  });

  it("navigates with the keyboard (ArrowDown + Enter) and closes after", () => {
    const dialog = open();
    // First result is highlighted; Enter activates it.
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(push).toHaveBeenCalledTimes(1);
    // closing on navigate: the dialog unmounts.
    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
  });

  it("closes on Escape without navigating", () => {
    const dialog = open();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  // Regression: the palette overlay must PORTAL to <body> so it escapes page
  // stacking contexts. Rendered inline, a transformed ancestor (the app shell /
  // cards carry a lingering `animate-rise` translateY(0) transform) traps the
  // z-50 layer below sibling cards and page content renders THROUGH the palette.
  // Mirrors the dialog.tsx portal regression. Fails on the pre-portal code.
  it("portals to document.body, escaping a transformed ancestor's stacking context", () => {
    render(
      <div data-testid="page-shell" style={{ transform: "translateY(0)" }}>
        <CommandPalette />
      </div>,
    );
    fireEvent.click(screen.getByTestId("command-palette-trigger"));

    const shell = screen.getByTestId("page-shell");
    // The open palette is NOT nested inside the (stacking-context-creating) shell …
    expect(shell.querySelector('[role="dialog"]')).toBeNull();
    // … it is portaled out onto <body> (the scrim wrapper sits on body).
    const palette = screen.getByTestId("command-palette");
    const scrim = screen.getByTestId("command-palette-scrim");
    expect(scrim.parentElement).toBe(document.body);
    expect(scrim.contains(palette)).toBe(true);
  });

  // FINDING #31 — ARIA combobox pattern. The input must be wired to its
  // listbox so a screen reader announces the result list, its expanded state,
  // and which option is currently active as the user arrows through.
  describe("ARIA combobox wiring (FINDING #31)", () => {
    it("marks the input as a combobox controlling the listbox", () => {
      open();
      const input = screen.getByLabelText("Search routes and lots");
      expect(input).toHaveAttribute("role", "combobox");

      const listbox = screen.getByRole("listbox");
      expect(listbox).toHaveAttribute("id");
      // aria-controls points at the listbox by id.
      expect(input).toHaveAttribute(
        "aria-controls",
        listbox.getAttribute("id")!,
      );
    });

    it("reports the expanded state (open with results) via aria-expanded", () => {
      open();
      const input = screen.getByLabelText("Search routes and lots");
      expect(input).toHaveAttribute("aria-expanded", "true");
    });

    it("gives every option a stable id and points aria-activedescendant at the active one", () => {
      open();
      const input = screen.getByLabelText("Search routes and lots");

      const options = screen.getAllByRole("option");
      // Each option carries a non-empty id.
      for (const opt of options) {
        expect(opt.getAttribute("id")).toBeTruthy();
      }

      // The first row is active on open; aria-activedescendant references its id.
      const activeId = input.getAttribute("aria-activedescendant");
      expect(activeId).toBeTruthy();
      const activeOption = options.find(
        (o) => o.getAttribute("aria-selected") === "true",
      );
      expect(activeOption).toBeDefined();
      expect(activeId).toBe(activeOption!.getAttribute("id"));
    });

    it("moves aria-activedescendant to the next option on ArrowDown", () => {
      const dialog = open();
      const input = screen.getByLabelText("Search routes and lots");
      const firstActive = input.getAttribute("aria-activedescendant");

      fireEvent.keyDown(dialog, { key: "ArrowDown" });

      const nextActive = input.getAttribute("aria-activedescendant");
      expect(nextActive).toBeTruthy();
      expect(nextActive).not.toBe(firstActive);
      // The referenced option is the one now marked selected.
      const selected = screen
        .getAllByRole("option")
        .find((o) => o.getAttribute("aria-selected") === "true");
      expect(selected!.getAttribute("id")).toBe(nextActive);
    });

    it("drops aria-activedescendant when there are no matching options", () => {
      open();
      const input = screen.getByLabelText("Search routes and lots");
      // A query that matches no nav route and yields no lot code (no 3+ digits).
      fireEvent.change(input, { target: { value: "zzqqxx" } });

      expect(screen.getByTestId("command-palette-empty")).toBeInTheDocument();
      // Nothing is active, so the input must not dangle a stale reference.
      expect(input.getAttribute("aria-activedescendant")).toBeFalsy();
    });
  });
});
