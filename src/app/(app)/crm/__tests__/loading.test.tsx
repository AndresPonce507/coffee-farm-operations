import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import CrmLoading from "@/app/(app)/crm/loading";
import SheetLoading from "@/app/(app)/crm/[id]/loading";

afterEach(cleanup);

describe("/crm loading skeletons (smoke)", () => {
  it("board: renders an aria-busy placeholder without throwing", () => {
    render(<CrmLoading />);
    expect(screen.getByLabelText("Loading contacts")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("sheet: renders an aria-busy placeholder without throwing", () => {
    render(<SheetLoading />);
    expect(screen.getByLabelText("Loading contact")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});
