import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import StorageLoading from "@/app/(app)/storage/loading";

afterEach(cleanup);

describe("/storage loading skeleton (smoke)", () => {
  it("renders an aria-busy placeholder without throwing", () => {
    render(<StorageLoading />);
    expect(screen.getByLabelText("Loading storage")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});
