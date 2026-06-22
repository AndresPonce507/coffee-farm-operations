import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkerIdentity, WorkerWeigh } from "@/lib/db/dossier/worker";
import type {
  AttendanceEvent,
  PorObraContract,
  WorkerCert,
} from "@/lib/db/people";
import type { WeighByPicker } from "@/lib/db/weigh";
import type { WorkerPay } from "@/lib/db/payroll";

/* ====================================================================== */
/* /workers/[id] DOSSIER page (US-04) — behavior test.                      */
/* Mirrors the lots/[code] exemplar: mock every read port so the async      */
/* Server Component composes against a seeded worker with NO Supabase, and   */
/* assert the dossier contract:                                              */
/*   • known id → renders the shell + all 5 sections (P2 anchor resolves),    */
/*   • unknown id → notFound() (the 404 AC; no fabricated worker),            */
/*   • ≥4 distinct cross-entity links (crew, plot, lot, pay-period) — the     */
/*     connectivity mandate (≥4 links/dossier).                              */
/* ====================================================================== */

const worker: WorkerIdentity = {
  workerId: "w-001",
  name: "Lupita González",
  preferredName: "Lupita",
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
    expiresAt: null,
    issuer: "MIDA",
  },
];

const summary: WeighByPicker = {
  workerId: "w-001",
  name: "Lupita González",
  crewId: "crew-norte",
  lataCount: 7,
  kgToday: 84.5,
  lastWeighAt: "2026-06-22T15:00:00Z",
};

const weighEvents: WorkerWeigh[] = [
  {
    eventUid: "we-1",
    plotId: "p-tizingal-alto",
    lotCode: "JC-564",
    kg: 12.3,
    ripeness: "ripe",
    brix: 21,
    geofenceOk: true,
    occurredAt: "2026-06-22T15:00:00Z",
  },
];

const attendance: AttendanceEvent[] = [
  {
    eventUid: "ae-1",
    workerId: "w-001",
    crewId: "crew-norte",
    eventKind: "clock-in",
    plotId: "p-baru-vista",
    occurredAt: "2026-06-22T11:00:00Z",
    recordedAt: "2026-06-22T11:00:01Z",
    deviceId: "dev-1",
    deviceSeq: 12,
  },
];

const contracts: PorObraContract[] = [
  {
    id: 1,
    workerId: "w-001",
    taskKind: "Recolección",
    rateBasis: "lata",
    rateUsd: 3.5,
    effectiveFrom: "2026-05-01",
    effectiveTo: null,
    signedAt: "2026-04-28",
    signatureRef: "sig-1",
    supersededBy: null,
  },
];

const pay: WorkerPay[] = [
  {
    id: 1,
    payPeriodId: "pp-2026-06",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-15",
    workerId: "w-001",
    workerName: "Lupita González",
    crewName: "Cuadrilla Norte",
    hoursWorked: 80,
    pieceRateUsd: 240,
    hourlyUsd: 0,
    minWageFloorUsd: 220,
    makeWholeUsd: 0,
    grossUsd: 240,
    cssUsd: 24,
    seguroEducativoUsd: 3,
    decimoAccrualUsd: 20,
    netUsd: 213,
    status: "approved",
    reversesId: null,
    madeWhole: false,
  },
];

// The dossier-scoped read ports (anchor + weigh evidence + pay history).
vi.mock("@/lib/db/dossier/worker", () => ({
  getWorkerById: vi.fn(async (): Promise<WorkerIdentity | null> => worker),
  getWorkerWeighEvents: vi.fn(async (): Promise<WorkerWeigh[]> => weighEvents),
  getWorkerPayHistory: vi.fn(async (): Promise<WorkerPay[]> => pay),
}));

// The shared people ports (certs, attendance, contracts, chain verify).
vi.mock("@/lib/db/people", () => ({
  getWorkerCertsValid: vi.fn(async (): Promise<WorkerCert[]> => certs),
  getWorkerAttendanceTimeline: vi.fn(
    async (): Promise<AttendanceEvent[]> => attendance,
  ),
  getWorkerPorObraHistory: vi.fn(
    async (): Promise<PorObraContract[]> => contracts,
  ),
  verifyAttendanceChain: vi.fn(async (): Promise<boolean> => true),
}));

// Today's weigh tally summary.
vi.mock("@/lib/db/weigh", () => ({
  getWorkerWeighSummary: vi.fn(
    async (): Promise<WeighByPicker | null> => summary,
  ),
}));

// notFound() throws a sentinel the router catches to render the 404 page.
const NOT_FOUND = new Error("NEXT_NOT_FOUND");
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
}));

import WorkerDossierPage from "@/app/(app)/workers/[id]/page";
import {
  getWorkerById,
  getWorkerWeighEvents,
  getWorkerPayHistory,
} from "@/lib/db/dossier/worker";
import { getWorkerWeighSummary } from "@/lib/db/weigh";
import { notFound } from "next/navigation";

afterEach(cleanup);

describe("/workers/[id] dossier page", () => {
  it("resolves the worker anchor by id and renders the shell + all five sections", async () => {
    const ui = await WorkerDossierPage({
      params: Promise.resolve({ id: "w-001" }),
    });
    render(ui);

    // P2 — the anchor getter is called with the route id.
    expect(getWorkerById).toHaveBeenCalledWith("w-001");
    // P3 — the section reads are fanned out for the same id.
    expect(getWorkerWeighEvents).toHaveBeenCalledWith("w-001");
    expect(getWorkerPayHistory).toHaveBeenCalledWith("w-001");
    expect(getWorkerWeighSummary).toHaveBeenCalledWith("w-001");

    // The shell names the worker (preferred name) and kind eyebrow.
    expect(
      screen.getByRole("heading", { level: 1, name: /Lupita/ }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("dossier-worker")).toBeInTheDocument();

    // All five sections render (identity, weighs, attendance, contracts, pay).
    expect(screen.getByTestId("section-identity")).toBeInTheDocument();
    expect(screen.getByTestId("section-weighs")).toBeInTheDocument();
    expect(screen.getByTestId("section-attendance")).toBeInTheDocument();
    expect(screen.getByTestId("section-contracts")).toBeInTheDocument();
    expect(screen.getByTestId("section-pay")).toBeInTheDocument();
  });

  it("surfaces at least four DISTINCT cross-entity links (crew, plot, lot, pay-period)", async () => {
    const ui = await WorkerDossierPage({
      params: Promise.resolve({ id: "w-001" }),
    });
    render(ui);

    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "");

    // The four dossier-kind cross-links the worker dossier must surface.
    expect(hrefs).toContain("/crew/crew-norte"); // identity → crew
    expect(hrefs).toContain("/plots/p-tizingal-alto"); // weigh → plot
    expect(hrefs).toContain("/lots/JC-564"); // weigh → lot
    expect(hrefs).toContain("/pay-period/pp-2026-06"); // pay → pay-period

    // Count the DISTINCT destination dossier kinds → ≥4 (the mandate).
    const kinds = new Set(
      hrefs
        .map((h) => h.match(/^\/(crew|plots|lots|pay-period|workers)\//)?.[1])
        .filter(Boolean),
    );
    expect(kinds.size).toBeGreaterThanOrEqual(4);
  });

  it("the back-link returns to the workers list", async () => {
    const ui = await WorkerDossierPage({
      params: Promise.resolve({ id: "w-001" }),
    });
    render(ui);
    const back = screen.getByRole("link", { name: /Todos los trabajadores/i });
    expect(back).toHaveAttribute("href", "/workers");
  });

  it("calls notFound() for an unknown worker id instead of fabricating a dossier", async () => {
    vi.mocked(getWorkerById).mockResolvedValueOnce(null);
    vi.mocked(notFound).mockClear();

    await expect(
      WorkerDossierPage({ params: Promise.resolve({ id: "w-nope" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("does not fetch any section for an unknown worker (anchor gate short-circuits)", async () => {
    vi.mocked(getWorkerById).mockResolvedValueOnce(null);
    vi.mocked(getWorkerWeighEvents).mockClear();
    vi.mocked(getWorkerPayHistory).mockClear();

    await expect(
      WorkerDossierPage({ params: Promise.resolve({ id: "w-nope" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(getWorkerWeighEvents).not.toHaveBeenCalled();
    expect(getWorkerPayHistory).not.toHaveBeenCalled();
  });
});
