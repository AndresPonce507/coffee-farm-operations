import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WeighCapture,
  type WeighCaptureDeps,
} from "@/components/sections/weigh/weigh-capture";

afterEach(cleanup);

const PICKERS = [
  { workerId: "w-06", name: "Lucía Morales", crewName: "Crew Tizingal", kgToday: 25 },
];
const PLOTS = [
  { id: "p-tizingal-alto", name: "Tizingal Alto", lat: 8.777835, lng: -82.640344 },
  { id: "p-baru-vista", name: "Barú Vista", lat: 8.777835, lng: -82.633982 },
];

type SubmitFn = NonNullable<WeighCaptureDeps["submit"]>;
type SubmitArg = Parameters<SubmitFn>[0];

/** A deterministic deps bundle: a stub submit that records the command. */
function depsWith(submitOutcome: "queued" | "rejected" = "queued") {
  const submit = vi.fn<SubmitFn>(async () => ({
    outcome: submitOutcome,
    message:
      submitOutcome === "rejected"
        ? "worker is not an active crew member"
        : undefined,
  }));
  let n = 0;
  const deps: WeighCaptureDeps = {
    submit,
    mintKey: () => `key-${++n}`,
    now: () => "2026-06-21T15:00:00.000Z",
    deviceId: "dev-test",
    getPosition: async () => null, // no GPS in the smoke test
    readScale: async () => ({ ok: false, reason: "unsupported" }),
  };
  return { submit, deps };
}

/** Drive the four steps to a ready-to-capture state. */
function fillReady() {
  fireEvent.click(screen.getByText("Lucía Morales")); // badge picker
  fireEvent.click(screen.getByLabelText("Digit 1"));
  fireEvent.click(screen.getByLabelText("Digit 2")); // kg = 12
  fireEvent.click(screen.getByText("maduro")); // ripeness = ripe
}

describe("WeighCapture", () => {
  it("renders the four-step capture surface", () => {
    const { deps } = depsWith();
    render(<WeighCapture pickers={PICKERS} plots={PLOTS} farmKgToday={100} deps={deps} />);
    expect(screen.getByText(/Badge the picker/)).toBeInTheDocument();
    expect(screen.getByText(/Confirm the plot/)).toBeInTheDocument();
    expect(screen.getByText(/Weigh the lata/)).toBeInTheDocument();
    expect(screen.getByText(/Ripeness/)).toBeInTheDocument();
    // Capture is disabled until all four are set.
    expect(screen.getByRole("button", { name: /Capture weigh-in/i })).toBeDisabled();
  });

  it("captures through the offline-safe submit with the validated RPC envelope", async () => {
    const { submit, deps } = depsWith("queued");
    render(<WeighCapture pickers={PICKERS} plots={PLOTS} farmKgToday={100} deps={deps} />);

    fillReady();
    const capture = screen.getByRole("button", { name: /Capture weigh-in/i });
    expect(capture).toBeEnabled();
    fireEvent.click(capture);

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const cmd = submit.mock.calls[0][0] as SubmitArg;
    expect(cmd.rpc).toBe("record_weigh_in");
    expect(cmd.args.p_worker_id).toBe("w-06");
    expect(cmd.args.p_plot_id).toBe("p-tizingal-alto");
    expect(cmd.args.p_cherries_kg).toBe(12);
    expect(cmd.args.p_ripeness).toBe("ripe");
    expect(cmd.idempotencyKey).toBe("key-1"); // the exactly-once anchor rides along

    // a calm "captured" confirmation + the optimistic tally bump (25 + 12 = 37.0).
    await waitFor(() =>
      expect(screen.getByText(/Weight captured/i)).toBeInTheDocument(),
    );
    expect(screen.getByText("37.0")).toBeInTheDocument();
  });

  it("surfaces a business rejection (the active-crew gate) without losing the entry", async () => {
    const { deps } = depsWith("rejected");
    render(<WeighCapture pickers={PICKERS} plots={PLOTS} farmKgToday={100} deps={deps} />);
    fillReady();
    fireEvent.click(screen.getByRole("button", { name: /Capture weigh-in/i }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/active crew member/i),
    );
  });

  it("auto-selects the nearest plot from a GPS fix (a confirm chip, not a lock)", async () => {
    const { deps } = depsWith();
    // a fix right on Barú Vista's coordinate.
    deps.getPosition = async () => ({ lat: 8.777835, lng: -82.633982 });
    render(<WeighCapture pickers={PICKERS} plots={PLOTS} farmKgToday={100} deps={deps} />);

    fireEvent.click(screen.getByText("Use GPS"));
    await waitFor(() => expect(screen.getByText("GPS set")).toBeInTheDocument());
    const select = screen.getByLabelText("Plot") as HTMLSelectElement;
    expect(select.value).toBe("p-baru-vista");
  });

  it("shows a busy state and disables the GPS button while a fix is in flight", async () => {
    const { deps } = depsWith();
    // A controllable fix so we can observe the in-flight window before it resolves.
    let resolveFix!: (v: { lat: number; lng: number } | null) => void;
    deps.getPosition = () =>
      new Promise<{ lat: number; lng: number } | null>((r) => {
        resolveFix = r;
      });
    render(<WeighCapture pickers={PICKERS} plots={PLOTS} farmKgToday={100} deps={deps} />);

    const gps = screen.getByRole("button", { name: /GPS/i });
    fireEvent.click(gps);
    // In-flight: the affordance reports work and refuses concurrent taps.
    await waitFor(() => expect(gps).toBeDisabled());
    expect(gps).toHaveTextContent(/Buscando GPS|Locating|Buscando/i);

    resolveFix({ lat: 8.777835, lng: -82.633982 });
    // Settles back to an enabled, non-busy control.
    await waitFor(() => expect(gps).toBeEnabled());
  });

  it("surfaces a calm inline error when the GPS fix fails (and re-enables the button)", async () => {
    const { deps } = depsWith();
    deps.getPosition = async () => null; // permission denied / timeout
    render(<WeighCapture pickers={PICKERS} plots={PLOTS} farmKgToday={100} deps={deps} />);

    const gps = screen.getByRole("button", { name: /GPS/i });
    fireEvent.click(gps);

    // The picker is told why the plot didn't auto-change — no silent failure.
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/GPS|parcela|plot/i),
    );
    // …and the button is usable again (not stuck busy).
    expect(gps).toBeEnabled();
  });
});
