import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WeighTally } from "@/components/sections/weigh/weigh-tally";

afterEach(cleanup);

describe("WeighTally", () => {
  it("shows the picker's running kg + lata count and the farm total", () => {
    render(
      <WeighTally
        pickerName="Lucía Morales"
        pickerKgToday={37.4}
        pickerLatas={3}
        farmKgToday={210.5}
      />,
    );
    expect(screen.getByText(/Lucía Morales · today/)).toBeInTheDocument();
    expect(screen.getByText("37.4")).toBeInTheDocument();
    expect(screen.getByText("3 latas")).toBeInTheDocument();
    expect(screen.getByText("210.5")).toBeInTheDocument();
  });

  it("uses the singular 'lata' for one and a fallback name", () => {
    render(
      <WeighTally
        pickerName={null}
        pickerKgToday={9}
        pickerLatas={1}
        farmKgToday={9}
      />,
    );
    expect(screen.getByText("1 lata")).toBeInTheDocument();
    expect(screen.getByText(/This picker · today/)).toBeInTheDocument();
  });
});
