import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { EudrStatus } from "@/lib/types";

import { EudrStatusBadge } from "@/components/sections/eudr/eudr-status-badge";

afterEach(cleanup);

describe("EudrStatusBadge", () => {
  const cases: Array<[EudrStatus, string]> = [
    ["compliant", "EUDR compliant"],
    ["incomplete", "Incomplete"],
    ["no-origin", "Origin unverified"],
  ];

  it.each(cases)("renders the %s verdict with its own label + testid", (status, label) => {
    render(<EudrStatusBadge status={status} />);
    const badge = screen.getByTestId(`eudr-badge-${status}`);
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent(label);
  });

  it("distinguishes 'no-origin' from a soft warning (it is the hardest verdict)", () => {
    render(<EudrStatusBadge status="no-origin" />);
    // label is meaningful on its own — not color-only.
    expect(screen.getByText("Origin unverified")).toBeInTheDocument();
  });
});
