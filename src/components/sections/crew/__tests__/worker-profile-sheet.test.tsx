import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WorkerProfileSheet } from "@/components/sections/crew/worker-profile-sheet";
import type {
  AttendanceEvent,
  PorObraContract,
  WorkerCert,
} from "@/lib/db/people";

afterEach(cleanup);

const ATTENDANCE: AttendanceEvent[] = [
  {
    eventUid: "a-2",
    workerId: "w-1",
    crewId: "c-1",
    eventKind: "clock-in",
    plotId: "p-1",
    occurredAt: "2026-06-20T11:00:00Z",
    recordedAt: "2026-06-20T11:00:01Z",
    deviceId: "ipad-1",
    deviceSeq: 2,
  },
  {
    eventUid: "a-1",
    workerId: "w-1",
    crewId: "c-1",
    eventKind: "rest-day",
    plotId: null,
    occurredAt: "2026-06-19T06:00:00Z",
    recordedAt: "2026-06-19T06:00:01Z",
    deviceId: "ipad-1",
    deviceSeq: 1,
  },
];

const CONTRACTS: PorObraContract[] = [
  {
    id: 2,
    workerId: "w-1",
    taskKind: "Cherry picking",
    rateBasis: "lata",
    rateUsd: 3.5,
    effectiveFrom: "2026-06-01",
    effectiveTo: null,
    signedAt: "2026-05-30",
    signatureRef: "sig-2",
    supersededBy: null,
  },
  {
    id: 1,
    workerId: "w-1",
    taskKind: "Cherry picking",
    rateBasis: "lata",
    rateUsd: 3.0,
    effectiveFrom: "2025-06-01",
    effectiveTo: "2026-05-31",
    signedAt: "2025-05-30",
    signatureRef: "sig-1",
    supersededBy: 2,
  },
];

const CERTS: WorkerCert[] = [
  {
    workerId: "w-1",
    certKind: "First aid",
    issuedAt: "2026-01-01",
    expiresAt: "2027-01-01",
    issuer: "Cruz Roja",
  },
];

describe("WorkerProfileSheet", () => {
  it("renders the identity header with name and comarca", () => {
    render(
      <WorkerProfileSheet
        name="Rosa Quintero"
        comarcaOrigin="Ngäbe-Buglé"
        languages={["es", "ngäbere"]}
        attendance={ATTENDANCE}
        contracts={CONTRACTS}
        certs={CERTS}
        chainVerified
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Rosa Quintero" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ngäbe-Buglé")).toBeInTheDocument();
  });

  it("renders the ngäbere language chip with WCAG-AA contrast-safe tokens", () => {
    render(
      <WorkerProfileSheet
        name="Rosa Quintero"
        languages={["es", "ngäbere"]}
        attendance={[]}
        contracts={[]}
        certs={[]}
        chainVerified
      />,
    );
    const chip = screen.getByText("es · ngäbere").closest("span");
    expect(chip).not.toBeNull();
    // AA-safe (5.14:1) — mirrors the crew-roster-board chip.
    expect(chip).toHaveClass("bg-muted", "text-muted-fg", "ring-line");
    // The prior sky pair (4.11:1) must be gone.
    expect(chip).not.toHaveClass("bg-sky-100");
    expect(chip).not.toHaveClass("text-sky");
  });

  it("renders the attendance timeline with an event kind", () => {
    render(
      <WorkerProfileSheet
        name="Rosa Quintero"
        languages={[]}
        attendance={ATTENDANCE}
        contracts={[]}
        certs={[]}
        chainVerified
      />,
    );
    const timeline = screen.getByTestId("attendance-timeline");
    expect(within(timeline).getByText(/clock-in|entrada/i)).toBeInTheDocument();
  });

  it("dims a superseded por-obra contract", () => {
    render(
      <WorkerProfileSheet
        name="Rosa Quintero"
        languages={[]}
        attendance={[]}
        contracts={CONTRACTS}
        certs={[]}
        chainVerified
      />,
    );
    const history = screen.getByTestId("por-obra-history");
    const rows = within(history).getAllByRole("listitem");
    const superseded = rows.find(
      (r) => r.getAttribute("data-superseded") === "true",
    );
    expect(superseded).toBeDefined();
    expect(superseded).toHaveClass("opacity-55");
  });

  it("renders the valid cert ledger", () => {
    render(
      <WorkerProfileSheet
        name="Rosa Quintero"
        languages={[]}
        attendance={[]}
        contracts={[]}
        certs={CERTS}
        chainVerified
      />,
    );
    const ledger = screen.getByTestId("cert-ledger");
    expect(within(ledger).getByText("First aid")).toBeInTheDocument();
  });

  it("shows a chain-verified badge when the chain reconciles", () => {
    render(
      <WorkerProfileSheet
        name="Rosa Quintero"
        languages={[]}
        attendance={[]}
        contracts={[]}
        certs={[]}
        chainVerified
      />,
    );
    expect(screen.getByTestId("chain-badge")).toHaveTextContent(
      "Chain verified",
    );
  });

  it("shows the unverified state when the chain does not reconcile", () => {
    render(
      <WorkerProfileSheet
        name="Rosa Quintero"
        languages={[]}
        attendance={[]}
        contracts={[]}
        certs={[]}
        chainVerified={false}
      />,
    );
    expect(screen.getByTestId("chain-badge")).toHaveTextContent(
      "Chain unverified",
    );
  });
});
