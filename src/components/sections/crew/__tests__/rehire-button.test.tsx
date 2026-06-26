import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RehireButton } from "@/components/sections/crew/rehire-button";

afterEach(cleanup);

describe("RehireButton", () => {
  it("renders its Rehire label", () => {
    render(<RehireButton workerId="w-1" crewId="c-1" season="2026-2027" />);
    expect(
      screen.getByRole("button", { name: /Rehire for 2026-2027/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Rehire")).toBeInTheDocument();
  });

  it("is disabled when disabled=true", () => {
    render(
      <RehireButton workerId="w-1" crewId="c-1" season="2026-2027" disabled />,
    );
    expect(screen.getByRole("button", { name: /Rehire/i })).toBeDisabled();
  });

  it("fires the action with the worker/crew/season and settles into Welcome back", async () => {
    const action = vi
      .fn()
      .mockResolvedValue({ status: "success", message: "Worker rehired." });
    render(
      <RehireButton
        workerId="w-9"
        crewId="c-3"
        season="2026-2027"
        action={action}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Rehire/i }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const fd = action.mock.calls[0][0] as FormData;
    expect(fd.get("workerId")).toBe("w-9");
    expect(fd.get("crewId")).toBe("c-3");
    expect(fd.get("season")).toBe("2026-2027");

    await waitFor(() =>
      expect(screen.getByText("Welcome back")).toBeInTheDocument(),
    );
  });

  it("does NOT confirm success when the action resolves an error result", async () => {
    const action = vi.fn().mockResolvedValue({
      status: "error",
      message: "El trabajador no es elegible para recontratación.",
    });
    render(
      <RehireButton
        workerId="w-9"
        crewId="c-3"
        season="2026-2027"
        action={action}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Rehire/i }));

    // The action's error message surfaces…
    await waitFor(() =>
      expect(
        screen.getByText("El trabajador no es elegible para recontratación."),
      ).toBeInTheDocument(),
    );
    // …and the success confirmation is NEVER painted over the failure.
    expect(screen.queryByText("Welcome back")).not.toBeInTheDocument();
    // The button stays actionable so the tap can be retried. The transition's
    // pending flag settles a tick after the error paints, so wait for the
    // button to re-enable rather than asserting on the intermediate render.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Rehire/i })).toBeEnabled(),
    );
  });

  it("surfaces a fallback error and stays actionable when the action throws", async () => {
    const action = vi.fn().mockRejectedValue(new Error("network down"));
    render(
      <RehireButton
        workerId="w-9"
        crewId="c-3"
        season="2026-2027"
        action={action}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Rehire/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Welcome back")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Rehire/i })).toBeEnabled(),
    );
  });

  it("does not call the action when disabled", () => {
    const action = vi.fn().mockResolvedValue(undefined);
    render(
      <RehireButton
        workerId="w-1"
        crewId="c-1"
        season="2026-2027"
        action={action}
        disabled
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Rehire/i }));
    expect(action).not.toHaveBeenCalled();
  });
});
