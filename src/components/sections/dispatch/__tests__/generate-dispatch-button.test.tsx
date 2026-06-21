import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GenerateDispatchButton } from "@/components/sections/dispatch/generate-dispatch-button";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GenerateDispatchButton", () => {
  it("fires the generate action with the crew + date + season envelope", async () => {
    const action = vi.fn().mockResolvedValue({ status: "success" });
    render(
      <GenerateDispatchButton
        crewId="crew-norte"
        crewName="Crew Norte"
        dispatchDate="2026-06-22"
        season="2026"
        action={action}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /generate|draft|dispatch/i }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const fd = action.mock.calls[0][0] as FormData;
    expect(fd.get("crewId")).toBe("crew-norte");
    expect(fd.get("dispatchDate")).toBe("2026-06-22");
    expect(fd.get("season")).toBe("2026");
    // a default readiness threshold rides along.
    expect(fd.get("readinessThreshold")).toBeTruthy();
  });

  it("does not double-fire while pending", async () => {
    let resolve!: () => void;
    const action = vi.fn().mockImplementation(
      () => new Promise<{ status: string }>((r) => { resolve = () => r({ status: "success" }); }),
    );
    render(
      <GenerateDispatchButton
        crewId="crew-norte"
        crewName="Crew Norte"
        dispatchDate="2026-06-22"
        season="2026"
        action={action}
      />,
    );
    const btn = screen.getByRole("button", { name: /generate|draft|dispatch/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    resolve();
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });
});
