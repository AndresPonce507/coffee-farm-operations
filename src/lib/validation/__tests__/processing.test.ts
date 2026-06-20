import { describe, expect, it } from "vitest";
import { validateBatch } from "@/lib/validation/processing";

const valid = {
  lotCode: "JC-564",
  variety: "Geisha",
  method: "Washed",
  stage: "drying",
  startedDate: "2026-06-18",
  cherriesKg: "1240",
  currentKg: "1180",
  moisturePct: "60",
  patio: "Bed 7",
  progressPct: "55",
};

describe("validateBatch", () => {
  it("accepts a well-formed batch and coerces/normalizes it", () => {
    const res = validateBatch({ ...valid, patio: "  Bed 7  " });
    expect(res).toEqual({
      ok: true,
      data: {
        lotCode: "JC-564",
        variety: "Geisha",
        method: "Washed",
        stage: "drying",
        startedDate: "2026-06-18",
        cherriesKg: 1240,
        currentKg: 1180,
        moisturePct: 60,
        patio: "Bed 7",
        progressPct: 55,
      },
    });
  });

  it("requires a lot code in the JC-### format", () => {
    expect(validateBatch({ ...valid, lotCode: "" }).ok).toBe(false);
    expect(validateBatch({ ...valid, lotCode: "564" }).ok).toBe(false);
    expect(validateBatch({ ...valid, lotCode: "JC-5" }).ok).toBe(false);
    expect(validateBatch({ ...valid, lotCode: "X-564" }).ok).toBe(false);
  });

  it("rejects an unknown variety / method / stage", () => {
    expect(validateBatch({ ...valid, variety: "Bourbon" }).ok).toBe(false);
    expect(validateBatch({ ...valid, method: "Boiled" }).ok).toBe(false);
    expect(validateBatch({ ...valid, stage: "roasted" }).ok).toBe(false);
  });

  it("requires a valid ISO started date", () => {
    expect(validateBatch({ ...valid, startedDate: "June 18" }).ok).toBe(false);
    expect(validateBatch({ ...valid, startedDate: "2026-6-5" }).ok).toBe(false);
  });

  it("requires cherries_kg > 0", () => {
    expect(validateBatch({ ...valid, cherriesKg: "0" }).ok).toBe(false);
    expect(validateBatch({ ...valid, cherriesKg: "-5" }).ok).toBe(false);
    expect(validateBatch({ ...valid, cherriesKg: "abc" }).ok).toBe(false);
  });

  it("requires current_kg >= 0", () => {
    expect(validateBatch({ ...valid, currentKg: "-1" }).ok).toBe(false);
    expect(validateBatch({ ...valid, currentKg: "0" }).ok).toBe(true);
  });

  it("rejects current_kg greater than cherries_kg (mass conservation)", () => {
    const res = validateBatch({
      ...valid,
      cherriesKg: "1000",
      currentKg: "1200",
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.errors.currentKg).toBeTruthy();
  });

  it("requires moisture_pct in the 0–100 range", () => {
    expect(validateBatch({ ...valid, moisturePct: "-1" }).ok).toBe(false);
    expect(validateBatch({ ...valid, moisturePct: "101" }).ok).toBe(false);
    expect(validateBatch({ ...valid, moisturePct: "0" }).ok).toBe(true);
    expect(validateBatch({ ...valid, moisturePct: "100" }).ok).toBe(true);
  });

  it("requires a patio", () => {
    expect(validateBatch({ ...valid, patio: "   " }).ok).toBe(false);
  });

  it("requires an integer progress_pct in the 0–100 range", () => {
    expect(validateBatch({ ...valid, progressPct: "-1" }).ok).toBe(false);
    expect(validateBatch({ ...valid, progressPct: "101" }).ok).toBe(false);
    expect(validateBatch({ ...valid, progressPct: "55.5" }).ok).toBe(false);
    expect(validateBatch({ ...valid, progressPct: "0" }).ok).toBe(true);
    expect(validateBatch({ ...valid, progressPct: "100" }).ok).toBe(true);
  });
});
