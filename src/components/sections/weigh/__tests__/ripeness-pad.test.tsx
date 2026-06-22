import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RipenessPad } from "@/components/sections/weigh/ripeness-pad";

afterEach(cleanup);

describe("RipenessPad", () => {
  it("renders three big bilingual ripeness radios", () => {
    render(<RipenessPad value={null} onChange={() => {}} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(screen.getByText("maduro")).toBeInTheDocument(); // ripe (es)
    expect(screen.getByText("nüre")).toBeInTheDocument(); // ripe (ngäbere)
  });

  it("marks the selected value as checked", () => {
    render(<RipenessPad value="overripe" onChange={() => {}} />);
    const checked = screen.getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveTextContent(/sobremaduro/i);
  });

  it("emits the tapped ripeness", () => {
    const onChange = vi.fn();
    render(<RipenessPad value={null} onChange={onChange} />);
    fireEvent.click(screen.getByText("verde")); // underripe
    expect(onChange).toHaveBeenCalledWith("underripe");
  });

  it("uses a WCAG-AA cherry-700 text on the selected overripe button (not the failing text-cherry)", () => {
    // text-cherry (#b5482e) on bg-cherry-100 = 4.12:1 → fails AA 4.5:1.
    // The darker cherry-700 (#8a2f1c) on cherry-100 = 6.47:1 → passes.
    render(<RipenessPad value="overripe" onChange={() => {}} />);
    const selected = screen
      .getAllByRole("radio")
      .find((r) => r.getAttribute("aria-checked") === "true")!;
    expect(selected.className).toContain("text-[#8a2f1c]");
    expect(selected.className).not.toMatch(/\btext-cherry\b/);
  });

  it("does not dim the bilingual sublabel with opacity-70 (it would fail AA on the selected tints)", () => {
    // opacity-70 composites the accent text over the selected tint, dropping
    // overripe ng to 2.62:1 and underripe ng to 2.81:1. Full opacity keeps AA.
    render(<RipenessPad value="overripe" onChange={() => {}} />);
    const selected = screen
      .getAllByRole("radio")
      .find((r) => r.getAttribute("aria-checked") === "true")!;
    const sublabel = selected.querySelector("span:last-of-type")!;
    expect(sublabel.className).not.toContain("opacity-70");
    expect(sublabel.textContent).toBe("nüre krübäte"); // overripe (ngäbere)
  });
});
