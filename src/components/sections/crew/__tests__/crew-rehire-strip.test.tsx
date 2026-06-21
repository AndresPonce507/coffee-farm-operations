import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CrewRehireStrip,
  type CrewMemberProfile,
} from "@/components/sections/crew/crew-rehire-strip";
import type { CrewRosterMember } from "@/lib/db/people";

afterEach(cleanup);

const lucia: CrewRosterMember = {
  workerId: "w-06",
  name: "Lucía Morales",
  role: "Picker",
  crewName: "Crew Tizingal",
  crewId: "crew-tizingal",
  attendance: "present",
  preferredName: "Lucía",
  comarcaOrigin: "Ngäbe-Buglé",
  languages: ["es", "ngäbere"],
  rehireEligible: true,
};

const carlos: CrewRosterMember = {
  workerId: "w-07",
  name: "Carlos Beker",
  role: "Picker",
  crewName: "Crew Norte",
  crewId: "crew-norte",
  attendance: "rest-day",
  preferredName: null,
  comarcaOrigin: null,
  languages: ["es"],
  rehireEligible: false,
};

const profiles: Record<string, CrewMemberProfile> = {
  "w-06": {
    attendance: [
      {
        eventUid: "e1",
        workerId: "w-06",
        crewId: "crew-tizingal",
        eventKind: "clock-in",
        plotId: null,
        occurredAt: "2026-06-21T12:00:00.000Z",
        recordedAt: "2026-06-21T12:00:01.000Z",
        deviceId: "dev-A",
        deviceSeq: 1,
      },
    ],
    contracts: [],
    certs: [
      {
        workerId: "w-06",
        certKind: "pesticide-handling",
        issuedAt: "2026-01-15",
        expiresAt: "2027-01-15",
        issuer: "MIDA Panamá",
      },
    ],
    chainVerified: true,
  },
};

describe("CrewRehireStrip", () => {
  it("renders returning partners with comarca chip + valid-cert badge", () => {
    render(
      <CrewRehireStrip
        members={[lucia]}
        profiles={profiles}
        season="2026-2027"
        rehireAction={vi.fn(async () => undefined)}
      />,
    );
    expect(screen.getByText("Lucía")).toBeInTheDocument();
    expect(screen.getByText("Ngäbe-Buglé")).toBeInTheDocument();
    expect(screen.getByText(/1 valid cert/)).toBeInTheDocument();
    // bilingual chip surfaces for the ngäbere speaker.
    expect(screen.getByText("es · ngäbere")).toBeInTheDocument();
  });

  it("renders nothing when there are no eligible members", () => {
    const { container } = render(
      <CrewRehireStrip
        members={[]}
        profiles={{}}
        season="2026-2027"
        rehireAction={vi.fn(async () => undefined)}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the profile sheet (timeline + cert ledger) when a name is clicked", () => {
    render(
      <CrewRehireStrip
        members={[lucia]}
        profiles={profiles}
        season="2026-2027"
        rehireAction={vi.fn(async () => undefined)}
      />,
    );
    // the name button opens the dialog with the profile sheet.
    fireEvent.click(screen.getByRole("button", { name: "Lucía" }));
    // the dialog surfaces the cert ledger content.
    expect(screen.getAllByText(/pesticide-handling/i).length).toBeGreaterThan(0);
  });

  it("fires the rehire action with the worker + crew + season on tap", async () => {
    const rehireAction = vi.fn(
      async (_fd: FormData): Promise<unknown> => undefined,
    );
    render(
      <CrewRehireStrip
        members={[lucia]}
        profiles={profiles}
        season="2026-2027"
        rehireAction={rehireAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /rehire/i }));
    await waitFor(() => expect(rehireAction).toHaveBeenCalledTimes(1));
    const fd = rehireAction.mock.calls[0][0];
    expect(fd.get("workerId")).toBe("w-06");
    expect(fd.get("crewId")).toBe("crew-tizingal");
    expect(fd.get("season")).toBe("2026-2027");
  });

  it("disables rehire for a non-eligible returning worker", () => {
    render(
      <CrewRehireStrip
        members={[carlos]}
        profiles={{}}
        season="2026-2027"
        rehireAction={vi.fn(async () => undefined)}
      />,
    );
    expect(screen.getByRole("button", { name: /rehire/i })).toBeDisabled();
  });
});
