import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PasadaPlan, PlotReadiness } from "@/lib/types";

// The three Server Actions are the write doors; mock them so the island test asserts
// the UI→action round-trip (the slice's headline interactive capability) without a DB.
const schedulePasada = vi.fn();
const replanPasada = vi.fn();
const recordMaturationSignal = vi.fn();

vi.mock("@/app/(app)/plan/actions", () => ({
  schedulePasada: (...a: unknown[]) => schedulePasada(...a),
  replanPasada: (...a: unknown[]) => replanPasada(...a),
  recordMaturationSignal: (...a: unknown[]) => recordMaturationSignal(...a),
}));

import { PlanActions } from "@/components/sections/planning/plan-actions.client";

const plot: Pick<PlotReadiness, "plotId" | "plotName"> = {
  plotId: "p-cuesta-piedra",
  plotName: "Cuesta de Piedra",
};

const plan: Pick<
  PasadaPlan,
  "id" | "plotId" | "plotName" | "season" | "pasadaNumber"
> = {
  id: 1,
  plotId: "p-bambito",
  plotName: "Bambito",
  season: "2026",
  pasadaNumber: 1,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PlanActions — the /plan write doors render", () => {
  it("renders the three action buttons", () => {
    render(<PlanActions plots={[plot]} plans={[plan]} />);
    expect(
      screen.getByRole("button", { name: /schedule pasada/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /re-plan around rain/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /log maturation signal/i }),
    ).toBeInTheDocument();
  });

  it("disables Schedule / Log when there are no plots and Re-plan when there are no plans", () => {
    render(<PlanActions plots={[]} plans={[]} />);
    expect(screen.getByRole("button", { name: /schedule pasada/i })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /re-plan around rain/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /log maturation signal/i }),
    ).toBeDisabled();
  });
});

describe("PlanActions — UI → Server Action round-trips (the dogfood capability)", () => {
  it("schedules a pasada through the dialog → schedulePasada with the row's plot", async () => {
    schedulePasada.mockResolvedValue({ ok: true });
    render(<PlanActions plots={[plot]} plans={[plan]} />);

    fireEvent.click(screen.getByRole("button", { name: /schedule pasada/i }));
    // the dialog opened with the schedule form.
    const dialog = await screen.findByRole("dialog", { name: /schedule a pasada/i });
    fireEvent.change(within(dialog).getByLabelText(/^plot$/i), {
      target: { value: plot.plotId },
    });
    // the form's submit button (scoped to the dialog so it doesn't match the action bar)
    fireEvent.click(
      within(dialog).getByRole("button", { name: /^schedule pasada$/i }),
    );

    await waitFor(() => expect(schedulePasada).toHaveBeenCalledTimes(1));
    const input = schedulePasada.mock.calls[0][0] as { plotId: string; ripenessTarget: string };
    expect(input.plotId).toBe(plot.plotId);
    expect(input.ripenessTarget).toBe("medium");
    expect(dialog).toBeTruthy();
  });

  it("re-plans a pass through the dialog → replanPasada with a reason", async () => {
    replanPasada.mockResolvedValue({ ok: true });
    render(<PlanActions plots={[plot]} plans={[plan]} />);

    fireEvent.click(screen.getByRole("button", { name: /re-plan around rain/i }));
    await screen.findByRole("dialog", { name: /re-plan around rain/i });
    fireEvent.change(screen.getByLabelText(/scheduled pass/i), {
      target: { value: String(plan.id) },
    });
    fireEvent.click(screen.getByRole("button", { name: /re-plan pass/i }));

    await waitFor(() => expect(replanPasada).toHaveBeenCalledTimes(1));
    const input = replanPasada.mock.calls[0][0] as {
      plotId: string;
      pasadaNumber: number;
      reason: string;
    };
    expect(input.plotId).toBe(plan.plotId);
    expect(input.pasadaNumber).toBe(plan.pasadaNumber);
    expect(input.reason).toBe("rain front");
  });

  it("logs a maturation signal through the dialog → recordMaturationSignal", async () => {
    recordMaturationSignal.mockResolvedValue({ ok: true });
    render(<PlanActions plots={[plot]} plans={[plan]} />);

    fireEvent.click(screen.getByRole("button", { name: /log maturation signal/i }));
    await screen.findByRole("dialog", { name: /log a maturation signal/i });
    fireEvent.change(screen.getByLabelText(/^plot$/i), {
      target: { value: plot.plotId },
    });
    fireEvent.change(screen.getByLabelText(/gdd accumulated/i), {
      target: { value: "1200" },
    });
    fireEvent.click(screen.getByRole("button", { name: /log signal/i }));

    await waitFor(() => expect(recordMaturationSignal).toHaveBeenCalledTimes(1));
    const input = recordMaturationSignal.mock.calls[0][0] as {
      plotId: string;
      gddAccumulated: number | null;
    };
    expect(input.plotId).toBe(plot.plotId);
    expect(input.gddAccumulated).toBe(1200);
  });

  it("surfaces a Server Action error inline and keeps the dialog open", async () => {
    schedulePasada.mockResolvedValue({ ok: false, error: "That plot no longer exists." });
    render(<PlanActions plots={[plot]} plans={[plan]} />);

    fireEvent.click(screen.getByRole("button", { name: /schedule pasada/i }));
    const dialog = await screen.findByRole("dialog", { name: /schedule a pasada/i });
    fireEvent.change(within(dialog).getByLabelText(/^plot$/i), {
      target: { value: plot.plotId },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: /^schedule pasada$/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/no longer exists/i);
    // the dialog stays open so the user can retry.
    expect(
      screen.getByRole("dialog", { name: /schedule a pasada/i }),
    ).toBeInTheDocument();
  });
});
