import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Topbar } from "@/components/layout/topbar";

describe("Topbar", () => {
  it("gives the search input an accessible name", () => {
    render(<Topbar />);

    // type="search" → searchbox role. It must be reachable by an accessible
    // name (aria-label), not just a placeholder.
    const search = screen.getByRole("searchbox", { name: /search/i });
    expect(search).toBeInTheDocument();
    expect(screen.getByLabelText(/search/i)).toBe(search);
  });
});
