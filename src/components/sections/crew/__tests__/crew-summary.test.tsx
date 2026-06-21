import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CrewSummary } from "@/components/sections/crew/crew-summary";

afterEach(cleanup);

describe("CrewSummary", () => {
  it("renders the three counts with their labels", () => {
    render(<CrewSummary crews={3} members={24} presentToday={19} />);
    const strip = screen.getByTestId("crew-summary");

    expect(within(strip).getByText("Crews")).toBeInTheDocument();
    expect(within(strip).getByText("3")).toBeInTheDocument();

    expect(within(strip).getByText("Members")).toBeInTheDocument();
    expect(within(strip).getByText("24")).toBeInTheDocument();

    expect(within(strip).getByText("Present today")).toBeInTheDocument();
    expect(within(strip).getByText("19")).toBeInTheDocument();
  });

  it("renders zeros without throwing", () => {
    render(<CrewSummary crews={0} members={0} presentToday={0} />);
    const strip = screen.getByTestId("crew-summary");
    expect(within(strip).getAllByText("0")).toHaveLength(3);
  });
});
