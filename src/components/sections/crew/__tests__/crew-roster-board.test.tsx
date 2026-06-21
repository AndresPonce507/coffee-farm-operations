import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CrewRosterBoard } from "@/components/sections/crew/crew-roster-board";
import type { CrewRosterMember, WorkerCert } from "@/lib/db/people";

afterEach(cleanup);

function member(over: Partial<CrewRosterMember> = {}): CrewRosterMember {
  return {
    workerId: "w-1",
    name: "Rosa Quintero",
    role: "Picker",
    crewName: "Cuadrilla Volcán",
    crewId: "c-1",
    attendance: "present",
    preferredName: null,
    comarcaOrigin: null,
    languages: [],
    rehireEligible: true,
    ...over,
  };
}

const CERT: WorkerCert = {
  workerId: "w-1",
  certKind: "First aid",
  issuedAt: "2026-01-01",
  expiresAt: "2027-01-01",
  issuer: "Cruz Roja",
};

describe("CrewRosterBoard", () => {
  it("renders a crew column header and a member name", () => {
    render(<CrewRosterBoard members={[member()]} />);
    expect(
      screen.getByRole("heading", { name: "Cuadrilla Volcán" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Rosa Quintero")).toBeInTheDocument();
  });

  it("groups members into separate crew columns", () => {
    render(
      <CrewRosterBoard
        members={[
          member({ workerId: "w-1", crewName: "Cuadrilla Volcán" }),
          member({
            workerId: "w-2",
            name: "Esteban Mora",
            crewName: "Cuadrilla Río Sereno",
          }),
        ]}
      />,
    );
    expect(screen.getByLabelText("Cuadrilla Volcán crew")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Cuadrilla Río Sereno crew"),
    ).toBeInTheDocument();
  });

  it("shows a comarca chip when the member has an origin", () => {
    render(
      <CrewRosterBoard
        members={[member({ comarcaOrigin: "Ngäbe-Buglé" })]}
      />,
    );
    const chip = screen.getByTestId("comarca-w-1");
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent("Ngäbe-Buglé");
  });

  it("renders an attendance state on each worker card (not colour alone)", () => {
    render(<CrewRosterBoard members={[member({ attendance: "rest-day" })]} />);
    const card = screen.getByTestId("worker-card-w-1");
    expect(card).toHaveAttribute("data-attendance", "rest-day");
    // The state is carried by a readable label, not only the dot's colour.
    expect(within(card).getByText(/día de descanso|Rest day/i)).toBeInTheDocument();
  });

  it("renders a valid-cert badge from the certs map", () => {
    render(
      <CrewRosterBoard
        members={[member()]}
        certsByWorker={{ "w-1": [CERT] }}
      />,
    );
    const card = screen.getByTestId("worker-card-w-1");
    expect(within(card).getByText("1 cert")).toBeInTheDocument();
  });

  it("shows the es · ngäbere language chip for ngäbere speakers", () => {
    render(
      <CrewRosterBoard
        members={[member({ languages: ["es", "ngäbere"] })]}
      />,
    );
    expect(screen.getByTestId("lang-w-1")).toHaveTextContent("es · ngäbere");
  });

  it("renders an empty state when there are no crews", () => {
    render(<CrewRosterBoard members={[]} />);
    expect(screen.getByText("No crews on the roster")).toBeInTheDocument();
  });
});
