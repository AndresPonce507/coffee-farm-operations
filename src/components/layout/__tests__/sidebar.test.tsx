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
    expect(screen.getByRole("link", { name: /Crews/ })).toHaveAttribute(
      "href",
      "/crew",
    );
  });

  it("surfaces the P2-S3 Ferment route in the nav", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /Fermentation/ })).toHaveAttribute(
      "href",
      "/ferment",
    );
  });

  it("surfaces the P2-S6 QC route in the nav", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /Quality/ })).toHaveAttribute(
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

  it("surfaces the P2-S7 payroll route in the nav (Payroll → /payroll)", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /Payroll/ })).toHaveAttribute(
      "href",
      "/payroll",
    );
  });

  it("surfaces the P2-S2 weigh-capture route in the nav (Weigh → /weigh)", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /Weigh/ })).toHaveAttribute(
      "href",
      "/weigh",
    );
  });

  it("surfaces the P2-S5 morning dispatch route in the nav (Dispatch → /dispatch)", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /Dispatch/ })).toHaveAttribute(
      "href",
      "/dispatch",
    );
  });

  it("surfaces the P3-S0 pricing route in the nav (Pricing → /pricing)", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /Pricing/ })).toHaveAttribute(
      "href",
      "/pricing",
    );
  });

  it("surfaces the P3-S0 hedge route in the nav (Hedge → /hedge)", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /Hedge/ })).toHaveAttribute(
      "href",
      "/hedge",
    );
  });

  it("surfaces the P3 Wave 1 commerce cluster in the nav (offers, contracts, fixation, samples, auctions, shipments)", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /Offers/ })).toHaveAttribute(
      "href",
      "/sales/offers",
    );
    expect(screen.getByRole("link", { name: /Contracts/ })).toHaveAttribute(
      "href",
      "/sales/contracts",
    );
    expect(screen.getByRole("link", { name: /Fixation/ })).toHaveAttribute(
      "href",
      "/sales/fixation",
    );
    expect(screen.getByRole("link", { name: /Samples/ })).toHaveAttribute(
      "href",
      "/sales/samples",
    );
    expect(screen.getByRole("link", { name: /Auctions/ })).toHaveAttribute(
      "href",
      "/sales/auctions",
    );
    expect(screen.getByRole("link", { name: /Shipments/ })).toHaveAttribute(
      "href",
      "/sales/shipments",
    );
  });

  it("surfaces the P3 Wave 2 milling, roasting, and yield routes in the nav", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /Milling/ })).toHaveAttribute(
      "href",
      "/mill",
    );
    expect(screen.getByRole("link", { name: /Roasting/ })).toHaveAttribute(
      "href",
      "/roast",
    );
    expect(screen.getByRole("link", { name: /Yields/ })).toHaveAttribute(
      "href",
      "/yields",
    );
  });

  it("surfaces the P3 Wave 3 DTC commerce cluster in the nav (shop, orders, subscriptions, provenance, pos)", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /Storefront/ })).toHaveAttribute(
      "href",
      "/shop",
    );
    expect(screen.getByRole("link", { name: /Orders/ })).toHaveAttribute(
      "href",
      "/orders",
    );
    expect(screen.getByRole("link", { name: /Reserve Club/ })).toHaveAttribute(
      "href",
      "/subscriptions",
    );
    expect(screen.getByRole("link", { name: /Provenance/ })).toHaveAttribute(
      "href",
      "/provenance",
    );
    expect(screen.getByRole("link", { name: /Point of sale/ })).toHaveAttribute(
      "href",
      "/pos",
    );
  });

  it("surfaces the P3 Wave 4 accounting cluster in the nav (finance, margins)", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /Finance/ })).toHaveAttribute(
      "href",
      "/finance",
    );
    expect(screen.getByRole("link", { name: /Margin & FX/ })).toHaveAttribute(
      "href",
      "/margins",
    );
  });

  it("surfaces the P3 Wave 5 reputation route in the nav (Reputation → /reputation)", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /Reputation/ })).toHaveAttribute(
      "href",
      "/reputation",
    );
  });

  it("surfaces the P3 Wave 5 S18/S20 routes in the nav (Contacts, Storage, Marketing)", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /Contacts/ })).toHaveAttribute(
      "href",
      "/crm",
    );
    expect(screen.getByRole("link", { name: /Storage/ })).toHaveAttribute(
      "href",
      "/storage",
    );
    expect(screen.getByRole("link", { name: /Marketing/ })).toHaveAttribute(
      "href",
      "/marketing",
    );
  });
});
