import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ProvenanceAdminLoading from "@/app/(app)/provenance/loading";

afterEach(cleanup);

describe("/(app)/provenance loading skeleton (smoke)", () => {
  it("renders an aria-busy placeholder without throwing", () => {
    render(<ProvenanceAdminLoading />);
    expect(screen.getByLabelText("Provenance")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});
