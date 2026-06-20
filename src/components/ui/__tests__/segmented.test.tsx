import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Segmented } from "@/components/ui/segmented";

const options = [
  { id: "grid", label: "Grid" },
  { id: "list", label: "List" },
];

describe("Segmented", () => {
  it("exposes toggle-group semantics (role=group, not the tab pattern)", () => {
    const { container } = render(
      <Segmented options={options} value="grid" onChange={() => {}} />,
    );

    // Container is a toggle group, not an ARIA tablist.
    expect(screen.getByRole("group")).toBeInTheDocument();
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector('[role="tab"]')).toBeNull();
  });

  it("marks the selected option with aria-pressed=true and the rest false", () => {
    render(<Segmented options={options} value="grid" onChange={() => {}} />);

    const grid = screen.getByRole("button", { name: "Grid" });
    const list = screen.getByRole("button", { name: "List" });

    expect(grid).toHaveAttribute("aria-pressed", "true");
    expect(list).toHaveAttribute("aria-pressed", "false");
    // The old tab pattern attribute is gone.
    expect(grid).not.toHaveAttribute("aria-selected");
  });

  it("fires onChange with the option id when an option is clicked", () => {
    const onChange = vi.fn();
    render(<Segmented options={options} value="grid" onChange={onChange} />);

    screen.getByRole("button", { name: "List" }).click();
    expect(onChange).toHaveBeenCalledWith("list");
  });
});
