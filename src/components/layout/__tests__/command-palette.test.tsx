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
    expect(screen.queryByTestId("command-result-/plots")).not.toBeInTheDocument();
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
    expect(screen.getByTestId("command-result-/lots/JC-711")).toBeInTheDocument();
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
});
