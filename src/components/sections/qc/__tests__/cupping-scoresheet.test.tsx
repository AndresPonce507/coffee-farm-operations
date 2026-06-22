import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Worker } from "@/lib/types";

const recordCuppingSessionAction = vi.fn();
const recordCupScoreAction = vi.fn();

vi.mock("@/app/(app)/qc/actions", () => ({
  recordCuppingSessionAction: (prev: unknown, fd: FormData) =>
    recordCuppingSessionAction(prev, fd),
  recordCupScoreAction: (prev: unknown, fd: FormData) =>
    recordCupScoreAction(prev, fd),
  QC_IDLE: { status: "idle" },
}));

import { CuppingScoresheet } from "@/components/sections/qc/cupping-scoresheet";

const CUPPERS: Pick<Worker, "id" | "name">[] = [
  { id: "w-cup-1", name: "Marisol" },
  { id: "w-cup-2", name: "Diego" },
];

describe("CuppingScoresheet (smoke + live total)", () => {
  it("renders the scoresheet for a green lot with a protocol toggle", () => {
    render(<CuppingScoresheet lotCode="JC-9001" cuppers={CUPPERS} />);
    expect(screen.getByText("JC-9001")).toBeInTheDocument();
    // both protocols are offered.
    expect(screen.getByRole("button", { name: /sca cva/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /legacy/i })).toBeInTheDocument();
  });

  it("defaults to the 8 SCA CVA attributes", () => {
    render(<CuppingScoresheet lotCode="JC-9001" cuppers={CUPPERS} />);
    // CVA-specific attribute that legacy lacks.
    expect(screen.getByText(/mouthfeel/i)).toBeInTheDocument();
  });

  it("shows a live running total that updates as a score changes", () => {
    render(<CuppingScoresheet lotCode="JC-9001" cuppers={CUPPERS} />);
    const total = screen.getByTestId("cup-live-total");
    expect(total).toHaveTextContent("0");

    const sliders = screen.getAllByRole("slider");
    // set the first attribute to 8 → the live total reflects it.
    fireEvent.change(sliders[0], { target: { value: "8" } });
    expect(total).toHaveTextContent("8");
  });

  it("switches to the 10 legacy attributes when the toggle is pressed", () => {
    render(<CuppingScoresheet lotCode="JC-9001" cuppers={CUPPERS} />);
    fireEvent.click(screen.getByRole("button", { name: /legacy/i }));
    // legacy-specific attribute that CVA lacks.
    expect(screen.getByText(/clean.?cup/i)).toBeInTheDocument();
  });

  it("lists the cuppers to attribute the session to", () => {
    render(<CuppingScoresheet lotCode="JC-9001" cuppers={CUPPERS} />);
    expect(screen.getByText("Marisol")).toBeInTheDocument();
    expect(screen.getByText("Diego")).toBeInTheDocument();
  });
});

describe("CuppingScoresheet (save path → cupping ledger)", () => {
  beforeEach(() => {
    recordCuppingSessionAction.mockReset();
    recordCupScoreAction.mockReset();
    // The session action opens a session and returns its id (mirrors actions.ts).
    recordCuppingSessionAction.mockResolvedValue({
      status: "success",
      message: "Cupping session opened.",
      sessionId: 42,
    });
    recordCupScoreAction.mockResolvedValue({
      status: "success",
      message: "Score recorded.",
    });
  });

  it("offers a 'Record cup' submit affordance", () => {
    render(<CuppingScoresheet lotCode="JC-9001" cuppers={CUPPERS} />);
    expect(
      screen.getByRole("button", { name: /record cup/i }),
    ).toBeInTheDocument();
  });

  it("opens a session via recordCuppingSessionAction with lot/cupper/protocol/calibration", async () => {
    render(<CuppingScoresheet lotCode="JC-9001" cuppers={CUPPERS} />);

    // pick a cupper + tick calibration.
    fireEvent.change(screen.getByLabelText(/cupper/i), {
      target: { value: "w-cup-2" },
    });
    fireEvent.click(screen.getByLabelText(/calibration sample/i));

    // score one attribute so there is something to persist.
    const sliders = screen.getAllByRole("slider");
    fireEvent.change(sliders[0], { target: { value: "8" } });

    fireEvent.click(screen.getByRole("button", { name: /record cup/i }));

    await waitFor(() => expect(recordCuppingSessionAction).toHaveBeenCalledTimes(1));
    const fd = recordCuppingSessionAction.mock.calls[0][1] as FormData;
    expect(fd.get("greenLotCode")).toBe("JC-9001");
    expect(fd.get("cupperId")).toBe("w-cup-2");
    expect(fd.get("protocol")).toBe("sca-cva");
    expect(fd.get("isCalibration")).toBe("on");
  });

  it("appends each scored attribute via recordCupScoreAction against the returned sessionId", async () => {
    render(<CuppingScoresheet lotCode="JC-9001" cuppers={CUPPERS} />);

    const sliders = screen.getAllByRole("slider");
    // score exactly three attributes (the rest stay 0 and must NOT be appended).
    fireEvent.change(sliders[0], { target: { value: "9" } });
    fireEvent.change(sliders[1], { target: { value: "8.5" } });
    fireEvent.change(sliders[2], { target: { value: "7" } });

    fireEvent.click(screen.getByRole("button", { name: /record cup/i }));

    await waitFor(() =>
      expect(recordCupScoreAction).toHaveBeenCalledTimes(3),
    );
    // every score append carries the session id the open returned.
    for (const call of recordCupScoreAction.mock.calls) {
      const fd = call[1] as FormData;
      expect(fd.get("sessionId")).toBe("42");
      expect(Number(fd.get("score"))).toBeGreaterThan(0);
      expect(typeof fd.get("attribute")).toBe("string");
    }
  });

  it("does not append a score for an unscored (zero) attribute", async () => {
    render(<CuppingScoresheet lotCode="JC-9001" cuppers={CUPPERS} />);

    const sliders = screen.getAllByRole("slider");
    fireEvent.change(sliders[0], { target: { value: "6" } });

    fireEvent.click(screen.getByRole("button", { name: /record cup/i }));

    await waitFor(() =>
      expect(recordCupScoreAction).toHaveBeenCalledTimes(1),
    );
  });
});

describe("CuppingScoresheet (quality band tracks the cupping-score scale)", () => {
  it("bands a top SCA CVA cup as Presidential, never Below Specialty / Premium", () => {
    render(<CuppingScoresheet lotCode="JC-9001" cuppers={CUPPERS} />);
    // default protocol is sca-cva → 8 hedonic sections.
    const sliders = screen.getAllByRole("slider");
    expect(sliders).toHaveLength(8);
    for (const s of sliders) fireEvent.change(s, { target: { value: "9" } });

    // SCA CVA 2023 affine transform: 0.65625·72 + 52.75 = 100 → Presidential.
    // (The shared cupQualityBand reads the already-100-pt cupping score directly;
    //  a great Geisha cup must NOT surface as the neutral "Below Specialty".)
    expect(screen.getByTestId("cup-live-total")).toHaveTextContent("100");
    expect(screen.getByText("Presidential")).toBeInTheDocument();
    expect(screen.queryByText("Below Specialty")).not.toBeInTheDocument();
    expect(screen.queryByText("Premium")).not.toBeInTheDocument();
  });

  it("bands a mid SCA CVA cup (all 7s → 89.5) as Specialty", () => {
    render(<CuppingScoresheet lotCode="JC-9001" cuppers={CUPPERS} />);
    const sliders = screen.getAllByRole("slider");
    for (const s of sliders) fireEvent.change(s, { target: { value: "7" } });

    // 0.65625·56 + 52.75 = 89.5 → Specialty (and decisively not Below Specialty).
    expect(screen.getByText("Specialty")).toBeInTheDocument();
    expect(screen.queryByText("Below Specialty")).not.toBeInTheDocument();
  });

  it("bands the legacy 100-pt protocol on its native additive scale (86 → Specialty)", () => {
    render(<CuppingScoresheet lotCode="JC-9001" cuppers={CUPPERS} />);
    fireEvent.click(screen.getByRole("button", { name: /legacy/i }));
    const sliders = screen.getAllByRole("slider");
    expect(sliders).toHaveLength(10);
    // 9 attributes at 9 + 1 at 5 = 86 → Specialty on the 100-pt scale.
    sliders.forEach((s, i) =>
      fireEvent.change(s, { target: { value: i === 9 ? "5" : "9" } }),
    );

    expect(screen.getByTestId("cup-live-total")).toHaveTextContent("86");
    expect(screen.getByText("Specialty")).toBeInTheDocument();
  });
});
