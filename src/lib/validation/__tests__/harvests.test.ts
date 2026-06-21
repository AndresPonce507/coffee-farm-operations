import { describe, expect, it } from "vitest";
import { validateHarvest } from "@/lib/validation/harvests";

const valid = {
  date: "2026-06-20",
  plotId: "p-tizingal-alto",
  workerId: "w-02",
  cherriesKg: "120",
  ripenessPct: "96",
  brixAvg: "21.4",
  lotCode: "JC-564",
};

describe("validateHarvest", () => {
  it("accepts a well-formed harvest and coerces the numerics", () => {
    const res = validateHarvest({ ...valid, lotCode: "  JC-564  " });
    expect(res).toEqual({
      ok: true,
      data: {
        date: "2026-06-20",
        plotId: "p-tizingal-alto",
        workerId: "w-02",
        cherriesKg: 120,
        ripenessPct: 96,
        brixAvg: 21.4,
        lotCode: "JC-564",
      },
    });
  });

  it("requires a valid ISO date", () => {
    expect(validateHarvest({ ...valid, date: "" }).ok).toBe(false);
    expect(validateHarvest({ ...valid, date: "June 20" }).ok).toBe(false);
    expect(validateHarvest({ ...valid, date: "2026-6-5" }).ok).toBe(false);
  });

  it("requires a plot and a picker", () => {
    expect(validateHarvest({ ...valid, plotId: "" }).ok).toBe(false);
    expect(validateHarvest({ ...valid, workerId: "  " }).ok).toBe(false);
  });

  it("requires cherries_kg strictly greater than zero", () => {
    expect(validateHarvest({ ...valid, cherriesKg: "0" }).ok).toBe(false);
    expect(validateHarvest({ ...valid, cherriesKg: "-5" }).ok).toBe(false);
    expect(validateHarvest({ ...valid, cherriesKg: "" }).ok).toBe(false);
    expect(validateHarvest({ ...valid, cherriesKg: "abc" }).ok).toBe(false);
  });

  it("constrains ripeness to 0–100", () => {
    expect(validateHarvest({ ...valid, ripenessPct: "-1" }).ok).toBe(false);
    expect(validateHarvest({ ...valid, ripenessPct: "101" }).ok).toBe(false);
    expect(validateHarvest({ ...valid, ripenessPct: "0" }).ok).toBe(true);
    expect(validateHarvest({ ...valid, ripenessPct: "100" }).ok).toBe(true);
  });

  it("requires brix_avg to be non-negative", () => {
    expect(validateHarvest({ ...valid, brixAvg: "-0.1" }).ok).toBe(false);
    expect(validateHarvest({ ...valid, brixAvg: "0" }).ok).toBe(true);
  });

  // FINDING #25 — a blank/whitespace required numeric must ERROR, never silently
  // coerce to 0 (Number("") === 0). A blank ripeness/brix/cherries is missing data,
  // not "0% ripe" / "0 Brix" / "0 kg".
  it("rejects a blank or whitespace-only ripeness instead of recording 0", () => {
    const blank = validateHarvest({ ...valid, ripenessPct: "" });
    expect(blank.ok).toBe(false);
    expect(blank.ok === false && blank.errors.ripenessPct).toBeTruthy();

    const ws = validateHarvest({ ...valid, ripenessPct: "   " });
    expect(ws.ok).toBe(false);
    expect(ws.ok === false && ws.errors.ripenessPct).toBeTruthy();

    // a non-numeric is rejected too, never coerced.
    expect(validateHarvest({ ...valid, ripenessPct: "abc" }).ok).toBe(false);
  });

  it("rejects a blank or whitespace-only brix instead of recording 0", () => {
    const blank = validateHarvest({ ...valid, brixAvg: "" });
    expect(blank.ok).toBe(false);
    expect(blank.ok === false && blank.errors.brixAvg).toBeTruthy();

    const ws = validateHarvest({ ...valid, brixAvg: "  " });
    expect(ws.ok).toBe(false);
    expect(ws.ok === false && ws.errors.brixAvg).toBeTruthy();

    expect(validateHarvest({ ...valid, brixAvg: "abc" }).ok).toBe(false);
  });

  it("rejects a blank or whitespace-only cherries weight instead of recording 0", () => {
    const blank = validateHarvest({ ...valid, cherriesKg: "" });
    expect(blank.ok).toBe(false);
    expect(blank.ok === false && blank.errors.cherriesKg).toBeTruthy();

    const ws = validateHarvest({ ...valid, cherriesKg: "   " });
    expect(ws.ok).toBe(false);
    expect(ws.ok === false && ws.errors.cherriesKg).toBeTruthy();
  });

  it("still accepts a missing (undefined) optional-less field only when supplied; required numerics with no value error", () => {
    // omitting the key entirely (undefined) is treated as missing, not 0.
    const noRipeness = validateHarvest({ ...valid, ripenessPct: undefined });
    expect(noRipeness.ok).toBe(false);
    const noBrix = validateHarvest({ ...valid, brixAvg: undefined });
    expect(noBrix.ok).toBe(false);
  });

  it("requires a lot code matching ^JC-[0-9]{3,}$", () => {
    expect(validateHarvest({ ...valid, lotCode: "" }).ok).toBe(false);
    expect(validateHarvest({ ...valid, lotCode: "JC-12" }).ok).toBe(false);
    expect(validateHarvest({ ...valid, lotCode: "564" }).ok).toBe(false);
    expect(validateHarvest({ ...valid, lotCode: "jc-564" }).ok).toBe(false);
    expect(validateHarvest({ ...valid, lotCode: "JC-1234" }).ok).toBe(true);
  });

  it("reports field-level errors when invalid", () => {
    const res = validateHarvest({ ...valid, cherriesKg: "0", lotCode: "" });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.errors.cherriesKg).toBeTruthy();
    expect(res.ok === false && res.errors.lotCode).toBeTruthy();
  });
});
