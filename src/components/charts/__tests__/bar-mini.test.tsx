import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BarMini, type BarMiniDatum } from "@/components/charts/bar-mini";

// vitest config has no globals; register RTL cleanup explicitly so each test
// renders into a fresh document body.
afterEach(cleanup);

/**
 * The exact prod data shape behind the `/harvests` "Daily harvest (kg)" card:
 * eight trailing days, several sparse/zero, climbing to a 644 kg best day.
 * The card's KPIs ("Today 644 kg") and best-day label are computed from this
 * same series — so if the chart renders blank while the label is populated,
 * the bug is in the chart, not the data.
 */
const PROD_DAYS: BarMiniDatum[] = [
  { label: "Jun 13", value: 180 },
  { label: "Jun 14", value: 0 },
  { label: "Jun 15", value: 410 },
  { label: "Jun 16", value: 95 },
  { label: "Jun 17", value: 0 },
  { label: "Jun 18", value: 320 },
  { label: "Jun 19", value: 508 },
  { label: "Jun 20", value: 644 },
];

/**
 * Walk up from `el` collecting the parsed inline `height` of every ancestor
 * (and the element itself) until we leave the chart wrapper. A CSS percentage
 * height only paints if its containing block has a *definite* height. jsdom
 * does no layout, so we assert the contract structurally: a bar whose height is
 * a percentage MUST sit inside a chain that pins a definite (px / full) height —
 * otherwise the percentage resolves to `auto` (0) and the bar is invisible.
 */
function hasDefiniteHeightAncestor(el: HTMLElement): boolean {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const inline = node.style.height;
    // A pixel height on an ancestor is a definite containing block.
    if (/\d+px$/.test(inline)) return true;
    // `h-full` only helps if ITS parent is definite — keep walking; the px
    // ancestor above it is what we ultimately require.
    node = node.parentElement;
  }
  return false;
}

describe("BarMini", () => {
  it("REGRESSION (daily-harvest blank bars): each bar's percentage height resolves against a definite containing block", () => {
    // Reproduces the /harvests bug: bars carried `height: N%` but their flex-item
    // wrapper had no definite height (parent used align-items:flex-end, which does
    // NOT stretch the item), so every percentage resolved to auto → 0 → invisible.
    render(<BarMini data={PROD_DAYS} color="#45361F" height={156} />);

    const chart = screen.getByRole("img");
    expect(chart).toBeInTheDocument();

    // Every bar that carries a non-zero percentage height must have an unbroken
    // chain of definite heights up to the pinned plot area — i.e. each ancestor
    // between the bar and the px-height plot must itself stretch (`h-full`), so
    // the percentage is actually resolvable and the bar paints.
    const bars = chart.querySelectorAll<HTMLElement>("[data-bar]");
    expect(bars.length).toBe(PROD_DAYS.length);

    let sawNonZeroBar = false;
    for (const bar of bars) {
      const h = bar.style.height;
      if (h && h !== "0%") {
        sawNonZeroBar = true;
        // The bug: the wrapper between the bar and the px plot did not carry a
        // resolvable height. Require the whole chain to be definite.
        const chain = collectHeightChain(bar, chart);
        // Every link from the bar up to the plot must be definite (px or full),
        // never an implicit `auto`, or the percentage collapses to 0.
        for (const link of chain) {
          expect(link).toMatch(/(\d+px|100%|full)/);
        }
        expect(hasDefiniteHeightAncestor(bar)).toBe(true);
      }
    }
    // The prod series has several non-zero days — the tallest is the 644 kg best
    // day. If the chart drew no non-zero bar, the series simply isn't rendering.
    expect(sawNonZeroBar).toBe(true);
  });

  it("scales bar heights to the series max (tallest bar is 100%)", () => {
    render(<BarMini data={PROD_DAYS} color="#45361F" height={156} />);
    const bars = screen
      .getByRole("img")
      .querySelectorAll<HTMLElement>("[data-bar]");

    // Jun 20 (644) is the max → its bar is full height (100%).
    const tallest = bars[bars.length - 1];
    expect(tallest.style.height).toBe("100%");

    // A zero-value day collapses to a 0% bar (no fabricated height).
    const zeroDay = bars[1]; // Jun 14 = 0
    expect(zeroDay.style.height).toBe("0%");
  });

  it("renders an explicit empty state (not a silently-empty plot) for no data", () => {
    render(<BarMini data={[]} color="#45361F" height={156} />);
    // No phantom bars, and a human-readable empty state instead of a blank box.
    expect(screen.queryAllByTestId("bar-mini-bar").length).toBe(0);
    expect(screen.getByText(/no .*data|nothing to show|no harvest/i)).toBeInTheDocument();
  });

  it("renders an all-zero series without throwing or fabricating bars", () => {
    const allZero: BarMiniDatum[] = [
      { label: "Mon", value: 0 },
      { label: "Tue", value: 0 },
      { label: "Wed", value: 0 },
    ];
    render(<BarMini data={allZero} color="#45361F" height={156} />);
    const chart = screen.getByRole("img");
    const bars = chart.querySelectorAll<HTMLElement>("[data-bar]");
    expect(bars.length).toBe(3);
    // max is 0 → every bar is a clean 0% (no NaN / Infinity from divide-by-zero).
    for (const bar of bars) {
      expect(bar.style.height).toBe("0%");
      expect(bar.style.height).not.toContain("NaN");
    }
  });

  it("renders a single non-zero datum as a full-height bar", () => {
    render(<BarMini data={[{ label: "Jun 20", value: 644 }]} height={156} />);
    const bar = screen
      .getByRole("img")
      .querySelector<HTMLElement>("[data-bar]");
    expect(bar).not.toBeNull();
    expect(bar!.style.height).toBe("100%");
  });

  it("exposes an accessible label summarizing the series", () => {
    render(<BarMini data={PROD_DAYS} />);
    expect(screen.getByRole("img")).toHaveAccessibleName(/bar chart/i);
  });
});

/**
 * Collect the inline `height` of every element from `bar` up to (and including)
 * the `stop` boundary — the chain that must resolve for the percentage to paint.
 */
function collectHeightChain(bar: HTMLElement, stop: HTMLElement): string[] {
  const chain: string[] = [];
  let node: HTMLElement | null = bar.parentElement;
  while (node && node !== stop.parentElement) {
    // Only links that participate in the height cascade matter; record their
    // inline height (px / % ) or their tailwind h-* class if present.
    const inline = node.style.height;
    const hClass = Array.from(node.classList).find((c) => /^h-/.test(c));
    if (inline) chain.push(inline);
    else if (hClass) chain.push(hClass.replace(/^h-/, ""));
    else chain.push("auto");
    if (node === stop) break;
    node = node.parentElement;
  }
  return chain;
}
