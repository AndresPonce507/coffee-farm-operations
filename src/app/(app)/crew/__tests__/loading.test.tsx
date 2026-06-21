import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import CrewLoading from "@/app/(app)/crew/loading";

afterEach(cleanup);

describe("/crew loading skeleton (smoke)", () => {
  it("renders an aria-busy placeholder without throwing", () => {
    render(<CrewLoading />);
    expect(screen.getByLabelText("Loading crew")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});
