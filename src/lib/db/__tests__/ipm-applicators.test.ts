import { describe, expect, it } from "vitest";

import { computeCertifiedApplicators } from "@/lib/db/ipm-applicators";

/**
 * Pure helper test for the cert-gated applicator list (P2-S12). The spray-log form
 * must know which workers currently hold a VALID pesticide-handling cert so it can
 * disable the rest — this is the UI projection of S1's v_worker_certs_valid. The
 * pure join is tested here; the getters are thin Supabase wrappers around it.
 */

const workers = [
  { id: "w-agro", name: "Lucía Mendez" },
  { id: "w-06", name: "Ana Pérez" },
  { id: "w-01", name: "Miguel Janson" },
];

describe("computeCertifiedApplicators", () => {
  it("marks a worker with a valid pesticide-handling cert as certified", () => {
    const certs = [{ worker_id: "w-agro", cert_kind: "pesticide-handling" }];
    const out = computeCertifiedApplicators(workers, certs);
    expect(out.find((a) => a.id === "w-agro")?.certified).toBe(true);
  });

  it("marks a worker with NO cert — or only a non-pesticide cert — as uncertified", () => {
    const certs = [
      { worker_id: "w-01", cert_kind: "first-aid" }, // not the pesticide cert
    ];
    const out = computeCertifiedApplicators(workers, certs);
    expect(out.find((a) => a.id === "w-01")?.certified).toBe(false);
    expect(out.find((a) => a.id === "w-06")?.certified).toBe(false); // no cert at all
  });

  it("returns every worker (the form shows the whole crew, certified or not)", () => {
    const out = computeCertifiedApplicators(workers, []);
    expect(out).toHaveLength(3);
    expect(out.every((a) => a.certified === false)).toBe(true);
  });

  it("carries the worker name through for the picker label", () => {
    const out = computeCertifiedApplicators(workers, [{ worker_id: "w-agro", cert_kind: "pesticide-handling" }]);
    expect(out.find((a) => a.id === "w-agro")?.name).toBe("Lucía Mendez");
  });
});
