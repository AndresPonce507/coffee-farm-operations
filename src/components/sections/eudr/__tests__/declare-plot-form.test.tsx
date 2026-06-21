import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Render + behaviour test for the per-plot EUDR declaration control (S8 — the
 * WRITE UI). The Server Action is mocked (the action's own behaviour is pinned by
 * its co-located test); this proves the client island's contract:
 *   - the basis <select> only offers 'established-pre-cutoff' for a pre-2020 plot,
 *     and hides it for a plot established after the 2020-12-31 cutoff (the DB CHECK
 *     would reject it — so the UI never even offers it),
 *   - submitting calls the action with the plot id, free=true, and the chosen basis,
 *   - a friendly error from the action renders inline (no raw SQL).
 */

const declareMock = vi.fn();
vi.mock("@/app/(app)/eudr/actions", () => ({
  declarePlotDeforestationFree: (...args: unknown[]) => declareMock(...args),
}));

import { DeclarePlotForm } from "@/components/sections/eudr/declare-plot-form";

beforeEach(() => declareMock.mockReset());
afterEach(cleanup);

describe("DeclarePlotForm", () => {
  it("offers 'established-pre-cutoff' for a pre-2020 plot", () => {
    render(
      <DeclarePlotForm plotId="p-baru-vista" establishedYear={2015} lotCode="JC-701" />,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain("established-pre-cutoff");
    expect(values).toContain("satellite-monitoring");
    expect(values).toContain("field-survey");
  });

  it("hides 'established-pre-cutoff' for a post-2020 plot (the DB CHECK would reject it)", () => {
    render(
      <DeclarePlotForm plotId="p-young" establishedYear={2022} lotCode="JC-701" />,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).not.toContain("established-pre-cutoff");
    expect(values).toContain("satellite-monitoring");
    expect(values).toContain("field-survey");
  });

  it("calls the action with the plot id, free=true, and the chosen basis on submit", async () => {
    declareMock.mockResolvedValue({ ok: true });
    render(
      <DeclarePlotForm plotId="p-baru-vista" establishedYear={2015} lotCode="JC-701" />,
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "satellite-monitoring" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /declare deforestation-free/i }),
    );

    // flush the microtask the click handler awaits
    await Promise.resolve();
    expect(declareMock).toHaveBeenCalledWith(
      "p-baru-vista",
      true,
      "satellite-monitoring",
      "JC-701",
    );
  });

  it("renders the action's friendly error inline (no raw SQL)", async () => {
    declareMock.mockResolvedValue({
      ok: false,
      error: "This plot was established after 2020 — pick satellite or field evidence.",
    });
    render(
      <DeclarePlotForm plotId="p-young" establishedYear={2022} lotCode="JC-701" />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /declare deforestation-free/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/established after 2020/i);
  });
});
