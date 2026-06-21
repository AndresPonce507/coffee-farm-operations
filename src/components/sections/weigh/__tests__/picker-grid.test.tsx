import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PickerGrid } from "@/components/sections/weigh/picker-grid";

afterEach(cleanup);

const PICKERS = [
  { workerId: "w-06", name: "Lucía Morales", crewName: "Crew Tizingal", kgToday: 37.4 },
  { workerId: "w-09", name: "Pedro Caballero", crewName: "Crew Norte", kgToday: 0 },
];

describe("PickerGrid", () => {
  it("renders a radio per picker with name, crew, and today's kg", () => {
    render(<PickerGrid pickers={PICKERS} selectedId={null} onSelect={() => {}} />);
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByText("Lucía Morales")).toBeInTheDocument();
    expect(screen.getByText("Crew Tizingal")).toBeInTheDocument();
    expect(screen.getByText("37.4 kg")).toBeInTheDocument();
  });

  it("marks the badged picker as checked", () => {
    render(<PickerGrid pickers={PICKERS} selectedId="w-06" onSelect={() => {}} />);
    const checked = screen
      .getAllByRole("radio")
      .filter((r) => r.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveTextContent("Lucía Morales");
  });

  it("emits the tapped worker id", () => {
    const onSelect = vi.fn();
    render(<PickerGrid pickers={PICKERS} selectedId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Pedro Caballero"));
    expect(onSelect).toHaveBeenCalledWith("w-09");
  });

  it("shows a graceful empty state when there are no pickers", () => {
    render(<PickerGrid pickers={[]} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText(/No active pickers/i)).toBeInTheDocument();
  });
});
