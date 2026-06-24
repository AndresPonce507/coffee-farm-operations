import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import CrewDossierLoading from "@/app/(app)/crew/[id]/loading";

afterEach(cleanup);

describe("/crew/[id] dossier loading skeleton (smoke)", () => {
  it("renders an aria-busy placeholder without throwing", () => {
    render(<CrewDossierLoading />);
    expect(screen.getByLabelText("Loading crew member")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});
