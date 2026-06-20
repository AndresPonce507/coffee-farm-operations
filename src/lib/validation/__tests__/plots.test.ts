import { describe, expect, it } from "vitest";
import { validatePlot } from "@/lib/validation/plots";

const valid = {
  name: "Tizingal Alto",
  block: "Block A",
  variety: "Geisha",
  area_ha: "4.2",
  altitude_masl: "1690",
  trees: "14800",
  shade_pct: "55",
  established_year: "2014",
  status: "healthy",
  last_inspected: "2026-06-18",
  expected_yield_kg: "18600",
};

describe("validatePlot", () => {
  it("accepts a well-formed plot and trims/coerces it", () => {
    const res = validatePlot({ ...valid, name: "  Tizingal Alto  " });
    expect(res).toEqual({
      ok: true,
      data: {
        name: "Tizingal Alto",
        block: "Block A",
        variety: "Geisha",
        areaHa: 4.2,
        altitudeMasl: 1690,
        trees: 14800,
        shadePct: 55,
        establishedYear: 2014,
        status: "healthy",
        lastInspected: "2026-06-18",
        expectedYieldKg: 18600,
      },
    });
  });

  it("rejects an empty name or block", () => {
    expect(validatePlot({ ...valid, name: "   " }).ok).toBe(false);
    expect(validatePlot({ ...valid, block: "   " }).ok).toBe(false);
  });

  it("rejects an unknown variety or status", () => {
    expect(validatePlot({ ...valid, variety: "Bourbon" }).ok).toBe(false);
    expect(validatePlot({ ...valid, status: "dying" }).ok).toBe(false);
  });

  it("requires area_ha > 0 and altitude_masl > 0", () => {
    expect(validatePlot({ ...valid, area_ha: "0" }).ok).toBe(false);
    expect(validatePlot({ ...valid, area_ha: "-1" }).ok).toBe(false);
    expect(validatePlot({ ...valid, area_ha: "" }).ok).toBe(false);
    expect(validatePlot({ ...valid, altitude_masl: "0" }).ok).toBe(false);
    expect(validatePlot({ ...valid, altitude_masl: "-5" }).ok).toBe(false);
  });

  it("requires trees >= 0 as an integer", () => {
    const zero = validatePlot({ ...valid, trees: "0" });
    expect(zero.ok && zero.data.trees).toBe(0);
    expect(validatePlot({ ...valid, trees: "-1" }).ok).toBe(false);
    expect(validatePlot({ ...valid, trees: "12.5" }).ok).toBe(false);
  });

  it("requires shade_pct as an integer in 0–100", () => {
    const zero = validatePlot({ ...valid, shade_pct: "0" });
    expect(zero.ok && zero.data.shadePct).toBe(0);
    expect(validatePlot({ ...valid, shade_pct: "100" }).ok).toBe(true);
    expect(validatePlot({ ...valid, shade_pct: "-1" }).ok).toBe(false);
    expect(validatePlot({ ...valid, shade_pct: "101" }).ok).toBe(false);
    expect(validatePlot({ ...valid, shade_pct: "55.5" }).ok).toBe(false);
  });

  it("requires established_year as an integer in 1950–2100", () => {
    expect(validatePlot({ ...valid, established_year: "1949" }).ok).toBe(false);
    expect(validatePlot({ ...valid, established_year: "2101" }).ok).toBe(false);
    expect(validatePlot({ ...valid, established_year: "2014.5" }).ok).toBe(false);
    expect(validatePlot({ ...valid, established_year: "1950" }).ok).toBe(true);
    expect(validatePlot({ ...valid, established_year: "2100" }).ok).toBe(true);
  });

  it("requires a valid ISO last_inspected date", () => {
    expect(validatePlot({ ...valid, last_inspected: "June 18" }).ok).toBe(false);
    expect(validatePlot({ ...valid, last_inspected: "2026-6-5" }).ok).toBe(false);
    expect(validatePlot({ ...valid, last_inspected: "" }).ok).toBe(false);
  });

  it("requires expected_yield_kg >= 0", () => {
    const zero = validatePlot({ ...valid, expected_yield_kg: "0" });
    expect(zero.ok && zero.data.expectedYieldKg).toBe(0);
    expect(validatePlot({ ...valid, expected_yield_kg: "-1" }).ok).toBe(false);
    expect(validatePlot({ ...valid, expected_yield_kg: "nope" }).ok).toBe(false);
  });
});
