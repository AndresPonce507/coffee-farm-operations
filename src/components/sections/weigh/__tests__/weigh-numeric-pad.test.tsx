import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WeighNumericPad,
  applyKey,
} from "@/components/sections/weigh/weigh-numeric-pad";

afterEach(cleanup);

describe("applyKey (pure keypad logic)", () => {
  it("appends digits and shows 0 for empty", () => {
    expect(applyKey("", "1")).toBe("1");
    expect(applyKey("1", "2")).toBe("12");
  });
  it("replaces a lone leading zero", () => {
    expect(applyKey("0", "5")).toBe("5");
  });
  it("allows one decimal point only and caps one decimal place", () => {
    expect(applyKey("12", ".")).toBe("12.");
    expect(applyKey("12.4", ".")).toBe("12.4"); // second dot ignored
    expect(applyKey("12.4", "5")).toBe("12.4"); // >1 decimal place ignored
  });
  it("starts a decimal from nothing as 0.", () => {
    expect(applyKey("", ".")).toBe("0.");
  });
  it("backspaces", () => {
    expect(applyKey("12.4", "back")).toBe("12.");
    expect(applyKey("", "back")).toBe("");
  });
});

describe("WeighNumericPad", () => {
  it("shows the kg readout and 12 keys", () => {
    render(<WeighNumericPad value="12.4" onChange={() => {}} />);
    expect(screen.getByTestId("kg-readout")).toHaveTextContent("12.4");
    // 10 digits + decimal + backspace
    expect(screen.getByLabelText("Digit 7")).toBeInTheDocument();
    expect(screen.getByLabelText("Decimal point")).toBeInTheDocument();
    expect(screen.getByLabelText("Delete last digit")).toBeInTheDocument();
  });

  it("emits the next value on a keypress", () => {
    const onChange = vi.fn();
    render(<WeighNumericPad value="1" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Digit 2"));
    expect(onChange).toHaveBeenCalledWith("12");
  });

  it("renders the optional Try-scale affordance and fires it", () => {
    const onTryScale = vi.fn();
    render(<WeighNumericPad value="" onChange={() => {}} onTryScale={onTryScale} />);
    fireEvent.click(screen.getByText(/Bluetooth scale/i));
    expect(onTryScale).toHaveBeenCalledTimes(1);
  });

  it("omits the scale key when no handler is given (manual is the default path)", () => {
    render(<WeighNumericPad value="" onChange={() => {}} />);
    expect(screen.queryByText(/Bluetooth scale/i)).not.toBeInTheDocument();
  });
});
