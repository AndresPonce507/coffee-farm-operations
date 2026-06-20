import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "@/components/ui/badge";

describe("Badge", () => {
  it("renders its children", () => {
    render(<Badge>Harvesting</Badge>);
    expect(screen.getByText("Harvesting")).toBeInTheDocument();
  });

  it("renders the leading status dot only when dot is set", () => {
    const { container, rerender } = render(<Badge>Idle</Badge>);
    // No dot by default: the only child is the text node.
    expect(container.querySelector("span > span")).toBeNull();

    rerender(
      <Badge dot tone="forest">
        Active
      </Badge>
    );
    expect(container.querySelector("span > span")).not.toBeNull();
  });
});
