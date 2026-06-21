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

  it("surfaces the P2-S4 Drying route in the nav (the reposo-gate surface)", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /Drying/ })).toHaveAttribute(
      "href",
      "/drying",
    );
  });

  it("surfaces the S5/S7/S8 routes in the nav (Inventory, Costing, EUDR)", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /Inventory/ })).toHaveAttribute(
      "href",
      "/inventory",
    );
    expect(screen.getByRole("link", { name: /Costing/ })).toHaveAttribute(
      "href",
      "/costing",
    );
    expect(screen.getByRole("link", { name: /EUDR/ })).toHaveAttribute(
      "href",
      "/eudr",
    );
  });

  it("surfaces the P2-S1 people route in the nav (Crew → /crew)", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /Crew/ })).toHaveAttribute(
      "href",
      "/crew",
    );
  });

  it("surfaces the P2-S3 Ferment route in the nav", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /Ferment/ })).toHaveAttribute(
      "href",
      "/ferment",
    );
  });

  it("surfaces the P2-S6 QC route in the nav", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /QC/ })).toHaveAttribute(
      "href",
      "/qc",
    );
  });

  it("surfaces the P2-S8 harvest planner route in the nav (Plan → /plan)", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /Plan/ })).toHaveAttribute(
      "href",
      "/plan",
    );
  });

  it("surfaces the P2-S2 weigh-capture route in the nav (Weigh → /weigh)", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /Weigh/ })).toHaveAttribute(
      "href",
      "/weigh",
    );
  });
});
