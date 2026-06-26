import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SampleDispatchRow, SampleableLot } from "@/app/(app)/crm/data";

// The island calls the Server Actions; mock them so the smoke render never hits the
// network. We only assert the interactive affordances mount (the money-shaped dispatch
// is human-confirmed behind a glass dialog — this proves its trigger is present).
vi.mock("@/app/(app)/crm/actions", () => ({
  upsertContactAction: vi.fn(),
  recordContactEventAction: vi.fn(),
  recordSampleDispatchAction: vi.fn(),
  recordSampleFeedbackAction: vi.fn(),
}));
// The island router.refresh()es after a write; outside a request there is no app-router
// context, so stub useRouter for the smoke render.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { ContactActions } from "@/app/(app)/crm/[id]/contact-sheet.client";

const SAMPLES: SampleDispatchRow[] = [
  {
    sampleId: 55,
    greenLotCode: "JC-901",
    contactId: 1,
    contactName: "Onyx Coffee Lab",
    grams: 250,
    kg: 0.25,
    courier: "DHL",
    trackingNo: null,
    dispatchedAt: "2026-05-10T00:00:00Z",
    scaGrade: "Presidential",
    cuppingScore: 92,
    latestVerdict: null,
  },
];

const LOTS: SampleableLot[] = [
  { greenLotCode: "JC-902", scaGrade: "Specialty", atpKg: 40 },
];

afterEach(cleanup);

describe("ContactActions island (smoke)", () => {
  it("renders the log-activity control and the human-confirmed sample dispatch trigger", () => {
    render(
      <ContactActions contactId={1} samples={SAMPLES} sampleableLots={LOTS} />,
    );
    expect(
      screen.getByRole("button", { name: "Log it" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Dispatch sample" }),
    ).toBeInTheDocument();
  });

  it("offers a feedback affordance for a sample still awaiting its cup", () => {
    render(
      <ContactActions contactId={1} samples={SAMPLES} sampleableLots={LOTS} />,
    );
    expect(
      screen.getByRole("button", { name: "Record feedback" }),
    ).toBeInTheDocument();
  });

  it("disables the dispatch trigger when no green lot has stock to sample", () => {
    render(<ContactActions contactId={1} samples={[]} sampleableLots={[]} />);
    expect(
      screen.getByRole("button", { name: "Dispatch sample" }),
    ).toBeDisabled();
  });
});
