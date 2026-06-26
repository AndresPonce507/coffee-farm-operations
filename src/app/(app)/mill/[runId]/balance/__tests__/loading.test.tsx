import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import MillBalanceLoading from "@/app/(app)/mill/[runId]/balance/loading";

/**
 * The route-loading skeleton is pure chrome — its job is a no-layout-shift,
 * reduced-motion-safe placeholder while the workspace resolves. Smoke test: it
 * mounts and exposes an aria-busy live region (so assistive tech announces the load).
 */
afterEach(cleanup);

describe("/mill/[runId]/balance loading skeleton (smoke)", () => {
  it("renders an aria-busy placeholder", () => {
    const { container } = render(<MillBalanceLoading />);
    const region = container.querySelector('[aria-busy="true"]');
    expect(region).not.toBeNull();
    expect(screen.getByLabelText("Loading mill balance")).toBeInTheDocument();
  });
});
