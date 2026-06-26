import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { YieldCalculator } from "@/app/(app)/yields/yield-calculator.client";

afterEach(cleanup);

// The calculator is a NO-WRITE display island: it projects a parchment lot through
// the dry mill (× outturn) and the roaster (× shrinkage) using the house factors,
// pure ratio math in kg only (NEVER a hardcoded lb↔kg constant — there is no unit
// conversion here, so the rail is honoured trivially). Nothing it does touches the
// database.
describe("YieldCalculator (no-write outturn projection)", () => {
  it("projects the default 1,000 kg parchment lot to green then roasted", () => {
    render(<YieldCalculator millOutturn={0.8} roastShrinkage={0.84} />);
    const root = screen.getByTestId("yield-calculator");
    // 1000 × 0.80 = 800 green; 800 × 0.84 = 672 roasted.
    expect(within(root).getByTestId("calc-green").textContent).toContain("800");
    expect(within(root).getByTestId("calc-roasted").textContent).toContain("672");
  });

  it("recomputes the projection when the parchment input changes", () => {
    render(<YieldCalculator millOutturn={0.8} roastShrinkage={0.84} />);
    const root = screen.getByTestId("yield-calculator");
    const input = within(root).getByRole("spinbutton");

    fireEvent.change(input, { target: { value: "500" } });
    // 500 × 0.80 = 400 green; 400 × 0.84 = 336 roasted.
    expect(within(root).getByTestId("calc-green").textContent).toContain("400");
    expect(within(root).getByTestId("calc-roasted").textContent).toContain("336");
  });

  it("treats a blank / non-positive input as zero, never NaN", () => {
    render(<YieldCalculator millOutturn={0.8} roastShrinkage={0.84} />);
    const root = screen.getByTestId("yield-calculator");
    const input = within(root).getByRole("spinbutton");

    fireEvent.change(input, { target: { value: "" } });
    expect(within(root).getByTestId("calc-green").textContent).not.toContain("NaN");
    expect(within(root).getByTestId("calc-green").textContent).toContain("0");
  });
});
