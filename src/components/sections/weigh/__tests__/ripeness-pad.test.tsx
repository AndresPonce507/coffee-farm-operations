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
});
