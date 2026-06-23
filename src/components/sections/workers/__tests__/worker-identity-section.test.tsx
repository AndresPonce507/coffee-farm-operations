import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  WorkerIdentitySection,
  certValidity,
} from "@/components/sections/workers/worker-identity-section";
import type { WorkerIdentity } from "@/lib/db/dossier/worker";
import type { WorkerCert } from "@/lib/db/people";

afterEach(cleanup);

const NOW = new Date("2026-06-22T12:00:00Z");

const worker: WorkerIdentity = {
  workerId: "w-001",
  name: "Lupita González",
  preferredName: null,
  role: "Picker",
  crewName: "Cuadrilla Norte",
  crewId: "crew-norte",
  comarcaOrigin: "Ngäbe-Buglé",
  languages: ["es", "ngäbere"],
  rehireEligible: true,
  attendance: "present",
  dailyRateUsd: 18.5,
  startedYear: 2019,
};

const certs: WorkerCert[] = [
  {
    workerId: "w-001",
    certKind: "Aplicador IPM",
    issuedAt: "2025-01-10",
    expiresAt: "2026-07-10", // 18 days out → expiring
    issuer: "MIDA",
  },
  {
    workerId: "w-001",
    certKind: "Primeros auxilios",
    issuedAt: "2024-03-01",
    expiresAt: null, // perennial
    issuer: null,
  },
];

describe("WorkerIdentitySection", () => {
  it("renders identity facts and the crew membership as a link to /crew/[id]", () => {
    render(<WorkerIdentitySection worker={worker} certs={certs} now={NOW} />);
    const card = screen.getByTestId("worker-identity-card");

    expect(within(card).getByText("Picker")).toBeInTheDocument();
    expect(within(card).getByText("Ngäbe-Buglé")).toBeInTheDocument();
    expect(within(card).getByText("es, ngäbere")).toBeInTheDocument();
    expect(within(card).getByText("$18.50")).toBeInTheDocument();

    // aria-label uses the human-readable crew name (WCAG 2.5.3), not the raw id.
    const crewLink = within(card).getByRole("link", {
      name: /cuadrilla Cuadrilla Norte/i,
    });
    expect(crewLink).toHaveAttribute("href", "/crew/crew-norte");
  });

  it("shows cert validity state (vigente / por vencer / sin vencimiento)", () => {
    render(<WorkerIdentitySection worker={worker} certs={certs} now={NOW} />);
    const list = screen.getByTestId("worker-certs");

    expect(within(list).getByText("Aplicador IPM")).toBeInTheDocument();
    expect(within(list).getByText(/Expires in 18 d/)).toBeInTheDocument();
    expect(within(list).getByText("No expiry")).toBeInTheDocument();
  });

  it("renders an empty cert state without throwing", () => {
    render(<WorkerIdentitySection worker={worker} certs={[]} now={NOW} />);
    expect(
      screen.getByText("No current certifications"),
    ).toBeInTheDocument();
  });

  it("certValidity classifies expiry windows correctly (pure)", () => {
    expect(certValidity(null, NOW).state).toBe("perennial");
    expect(certValidity("2026-07-10", NOW).state).toBe("expiring");
    expect(certValidity("2027-01-01", NOW).state).toBe("valid");
  });
});
