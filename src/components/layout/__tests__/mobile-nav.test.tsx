import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// MobileNav reads the active route via usePathname; stub it so the drawer mirrors
// the desktop sidebar without a real Next router.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

import { MobileNav } from "@/components/layout/mobile-nav";

afterEach(cleanup);

describe("MobileNav (the < md slide-in drawer)", () => {
  it("opens the drawer from the hamburger trigger", () => {
    render(<MobileNav />);
    const trigger = screen.getByRole("button", {
      name: /abrir menú de navegación/i,
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    // The drawer panel (role=dialog) is present once opened.
    expect(
      screen.getByRole("dialog", { name: /navegación principal/i }),
    ).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    render(<MobileNav />);
    fireEvent.click(
      screen.getByRole("button", { name: /abrir menú de navegación/i }),
    );
    expect(
      screen.getByRole("button", { name: /abrir menú de navegación/i }),
    ).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.getByRole("button", { name: /abrir menú de navegación/i }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  // Regression: the off-canvas drawer must PORTAL to <body> so it escapes page
  // stacking contexts. Rendered inline, a transformed ancestor (the app shell /
  // cards carry a lingering `animate-rise` translateY(0) transform) traps the
  // z-50 layer below sibling cards and page content renders THROUGH the drawer.
  // Mirrors the dialog.tsx portal regression. Fails on the pre-portal code.
  it("portals to document.body, escaping a transformed ancestor's stacking context", () => {
    render(
      <div data-testid="page-shell" style={{ transform: "translateY(0)" }}>
        <MobileNav />
      </div>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /abrir menú de navegación/i }),
    );

    const shell = screen.getByTestId("page-shell");
    // The overlay (role=dialog drawer) is NOT nested inside the shell …
    expect(shell.querySelector('[role="dialog"]')).toBeNull();
    // … it is portaled out onto <body>.
    const drawer = screen.getByRole("dialog", { name: /navegación principal/i });
    // Walk up to the fixed overlay wrapper that the portal mounts on body.
    let node: HTMLElement | null = drawer;
    while (node && node.parentElement !== document.body) {
      node = node.parentElement;
    }
    expect(node).not.toBeNull();
    expect(node!.parentElement).toBe(document.body);
  });
});
