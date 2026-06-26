import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ProvenanceLoading from "@/app/p/[slug]/loading";

afterEach(cleanup);

describe("/p/[slug] loading skeleton (smoke)", () => {
  it("renders an aria-busy glass placeholder without throwing", () => {
    render(<ProvenanceLoading />);
    expect(screen.getByLabelText("From our farm to your cup")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});
