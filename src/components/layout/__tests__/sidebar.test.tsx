import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// usePathname drives which nav link is "active". Pin it to /plots so the Plots
// link is the active one and the others are not.
vi.mock("next/navigation", () => ({
  usePathname: () => "/plots",
}));

import { Sidebar } from "@/components/layout/sidebar";

describe("Sidebar", () => {
  it("marks the active nav link with aria-current=page", () => {
    render(<Sidebar />);

    const active = screen.getByRole("link", { name: /Plots/ });
    expect(active).toHaveAttribute("aria-current", "page");
  });

  it("does not set aria-current on inactive nav links", () => {
    render(<Sidebar />);

    const inactive = screen.getByRole("link", { name: /Harvests/ });
    expect(inactive).not.toHaveAttribute("aria-current");
  });

  it("includes a Map nav link pointing at /map", () => {
    render(<Sidebar />);

    const mapLink = screen.getByRole("link", { name: /Map/ });
    expect(mapLink).toHaveAttribute("href", "/map");
  });
});
