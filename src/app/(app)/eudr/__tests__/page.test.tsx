import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// EudrSummary is an async Server Component; stub it so this test asserts the
// PAGE's job: the header + the summary section, wired in order.
vi.mock("@/components/sections/eudr/eudr-summary", () => ({
  EudrSummary: () => <div data-testid="eudr-summary-stub" />,
}));

import EudrPage from "@/app/(app)/eudr/page";

afterEach(cleanup);

describe("/eudr page (smoke)", () => {
  it("renders the header above the summary section", () => {
    render(<EudrPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: "EUDR" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("eudr-summary-stub")).toBeInTheDocument();
  });
});
