import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import WorkspaceLoading from "@/app/(app)/sales/contracts/[no]/loading";

afterEach(cleanup);

describe("/sales/contracts/[no] loading skeleton (smoke)", () => {
  it("renders an aria-busy placeholder without throwing", () => {
    render(<WorkspaceLoading />);
    expect(screen.getByLabelText("Loading the contract")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});
