import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ContractsLoading from "@/app/(app)/sales/contracts/loading";

afterEach(cleanup);

describe("/sales/contracts loading skeleton (smoke)", () => {
  it("renders an aria-busy placeholder without throwing", () => {
    render(<ContractsLoading />);
    expect(screen.getByLabelText("Loading contracts")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});
