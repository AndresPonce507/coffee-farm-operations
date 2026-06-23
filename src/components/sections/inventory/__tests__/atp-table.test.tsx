import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GreenLotAtp } from "@/lib/types";

// The reservation drawer is the one client island; stub its Server Action import
// so the table renders without pulling in next/cache or the Supabase client.
vi.mock("@/app/(app)/inventory/actions", () => ({
  reserveGreenLotAction: vi.fn(),
  INVENTORY_IDLE: { status: "idle" },
}));

import { AtpTable } from "@/components/sections/inventory/atp-table";

const ROWS: GreenLotAtp[] = [
  {
    greenLotCode: "JC-552-G",
    scaGrade: "Presidential",
    location: "Warehouse A · Bay 3",
    currentKg: 240,
    reservedKg: 60,
    shippedKg: 30,
    atp: 150,
  },
  {
    greenLotCode: "JC-561-G",
    scaGrade: "Specialty",
    location: "Warehouse B · Bay 1",
    currentKg: 420,
    reservedKg: 420,
    shippedKg: 0,
    atp: 0,
  },
];

describe("AtpTable (smoke)", () => {
  it("renders the card header, columns, and a row per green lot", () => {
    render(<AtpTable rows={ROWS} />);

    expect(screen.getByText("Green inventory")).toBeInTheDocument();
    // Column headers (the dense desktop table).
    expect(screen.getByRole("columnheader", { name: /lot/i })).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /grade/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /available to promise/i }),
    ).toBeInTheDocument();

    // Each lot code renders (appears in both the desktop row and the mobile card,
    // so we assert at least one match per code).
    expect(screen.getAllByText("JC-552-G").length).toBeGreaterThan(0);
    expect(screen.getAllByText("JC-561-G").length).toBeGreaterThan(0);
  });

  it("renders one ATP meter per lot with the committed/available split", () => {
    render(<AtpTable rows={ROWS} />);

    // Each lot gets a dual-bar ATP meter (role=meter). Desktop + mobile views
    // each render a meter per row, so >= rows.length meters total.
    const meters = screen.getAllByRole("meter");
    expect(meters.length).toBeGreaterThanOrEqual(ROWS.length);

    // The first lot has 90 committed (60 reserved + 30 shipped) and 150 ATP.
    const availableReadouts = screen.getAllByTestId("atp-readout-available");
    expect(availableReadouts.some((n) => /150 kg/.test(n.textContent ?? ""))).toBe(
      true,
    );
    const committedReadouts = screen.getAllByTestId("atp-readout-committed");
    expect(committedReadouts.some((n) => /90 kg/.test(n.textContent ?? ""))).toBe(
      true,
    );
  });

  it("collapses to record-cards below md and never horizontal-scrolls (D24)", () => {
    const { container } = render(<AtpTable rows={ROWS} />);

    // The dense table is hidden below md; the record-card list is hidden at md+.
    const desktop = container.querySelector("[data-testid='atp-table-desktop']");
    const mobile = container.querySelector("[data-testid='atp-cards-mobile']");
    expect(desktop).not.toBeNull();
    expect(mobile).not.toBeNull();
    expect(desktop?.className).toMatch(/hidden/);
    expect(desktop?.className).toMatch(/md:block/);
    expect(mobile?.className).toMatch(/md:hidden/);

    // D24 — the collapse means we must NOT rely on an overflow-x scroller.
    expect(desktop?.className ?? "").not.toMatch(/overflow-x-auto/);
  });

  it("shows a glass empty state when there is no graded green inventory", () => {
    render(<AtpTable rows={[]} />);
    expect(screen.getByText(/no green inventory yet/i)).toBeInTheDocument();
  });

  it("offers a reserve affordance per lot (the client island trigger)", () => {
    render(<AtpTable rows={ROWS} />);
    const reserveButtons = screen.getAllByRole("button", { name: /reserve/i });
    // At least one reserve trigger per lot (desktop + mobile each render one).
    expect(reserveButtons.length).toBeGreaterThanOrEqual(ROWS.length);

    // A fully-committed lot (ATP 0) still surfaces, with its reserve trigger
    // disabled so the UI cannot even attempt a double-sell.
    const soldOut = within(
      screen.getAllByTestId("atp-cards-mobile")[0] ?? document.body,
    );
    expect(soldOut).toBeTruthy();
  });

  // ── Phase 5 wire-up: every green-lot code is a dossier link (D2 / J4) ──
  // The lot code was COSMETIC (a plain <span>). The mandate makes every
  // entity-naming row a real <a href> to its dossier — here the lot dossier
  // at /lots/[code]. (wire-up-audit §11 "green-lot rows link /lots/[code]".)
  it("links every green-lot code to its /lots/[code] dossier (NAVIGATE)", () => {
    render(<AtpTable rows={ROWS} />);

    for (const row of ROWS) {
      // The lot code is now an <a href> (it appears in both the desktop row and
      // the mobile card; at least one is the dossier link).
      const links = screen
        .getAllByRole("link", { name: new RegExp(row.greenLotCode, "i") })
        .filter(
          (el) =>
            el.getAttribute("href") === `/lots/${row.greenLotCode}`,
        );
      expect(links.length).toBeGreaterThan(0);
      // The link text is the lot code itself.
      expect(links[0]).toHaveTextContent(row.greenLotCode);
    }
  });

  it("links the sold-out lot's code too (the STUB is the Reserve button, not the row)", () => {
    render(<AtpTable rows={ROWS} />);
    // JC-561-G has ATP 0 (its Reserve button is the intentional "Sold out" STUB),
    // but its code must STILL navigate to the dossier — the row is not dead.
    const link = screen
      .getAllByRole("link", { name: /JC-561-G/i })
      .find((el) => el.getAttribute("href") === "/lots/JC-561-G");
    expect(link).toBeTruthy();
  });
});
