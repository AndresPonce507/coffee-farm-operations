import { describe, expect, it } from "vitest";

import {
  LB_TO_KG,
  convertMass,
  kgToLb,
  lbToKg,
  usdPerKgToUsdPerLb,
  usdPerLbToUsdPerKg,
} from "@/lib/pricing/convert";

// ─────────────────────────────────────────────────────────────────────────────
// The DATABASE is the source of truth. The `units` table seeds the avoirdupois
// pound as ('[lb]','mass',0.453592,'lb'), and convert_qty(qty,from,to) =
// qty * to_base(from) / to_base(to). These helpers mirror THAT exact factor for
// client-side display only — never a hardcoded 2.2046 magic literal.
//   convert_qty(1,'kg','[lb]') = 1 * 1 / 0.453592 = 1 / LB_TO_KG.
// ─────────────────────────────────────────────────────────────────────────────

describe("LB_TO_KG — the single source-of-truth factor (kg per pound)", () => {
  it("equals the DB units row to_base for '[lb]' (0.453592)", () => {
    // Pin the constant to the seeded `units` value so client and DB can never drift.
    expect(LB_TO_KG).toBe(0.453592);
  });
});

describe("lb↔kg mass conversion (mirrors convert_qty for the mass dimension)", () => {
  it("lbToKg multiplies by the SoT factor (1 lb = 0.453592 kg)", () => {
    expect(lbToKg(1)).toBe(0.453592);
    expect(lbToKg(2)).toBeCloseTo(0.907184, 12);
  });

  it("kgToLb divides by the SoT factor — exactly convert_qty(1,'kg','[lb]'), NOT a 2.2046 literal", () => {
    // 1 kg in lb = 1 / 0.453592 = 2.2046244202 — derived from the DB's SEEDED
    // 0.453592 (NOT the true-pound 2.2046226, which uses 0.45359237). Mirroring the
    // DB seed exactly is the whole point: the client must match convert_qty's value.
    expect(kgToLb(1)).toBe(1 / LB_TO_KG);
    expect(kgToLb(1)).toBeCloseTo(2.2046244202, 9);
  });

  it("round-trips kg -> lb -> kg without drift", () => {
    const kg = 137.5;
    expect(lbToKg(kgToLb(kg))).toBeCloseTo(kg, 10);
  });
});

describe("$/lb ↔ $/kg price conversion (the commodity 'C' factor)", () => {
  it("usdPerLbToUsdPerKg matches (price) × convert_qty(1,'kg','[lb]')", () => {
    // C 2.50 + 0.35 differential = 2.85 $/lb -> $/kg = 2.85 / 0.453592 = 6.2831796
    const usdPerLb = 2.85;
    expect(usdPerLbToUsdPerKg(usdPerLb)).toBe(usdPerLb / LB_TO_KG);
    expect(usdPerLbToUsdPerKg(usdPerLb)).toBeCloseTo(6.2831796, 5);
  });

  it("usdPerKgToUsdPerLb is the exact inverse (round-trips)", () => {
    const usdPerLb = 1.85;
    expect(usdPerKgToUsdPerLb(usdPerLbToUsdPerKg(usdPerLb))).toBeCloseTo(usdPerLb, 12);
  });

  it("converts $/kg back to $/lb by multiplying by the SoT factor", () => {
    expect(usdPerKgToUsdPerLb(10)).toBe(10 * LB_TO_KG);
  });
});

describe("convertMass — a faithful mirror of convert_qty over the mass dimension", () => {
  it("kg->[lb] equals kgToLb (the migration's lb/kg factor)", () => {
    expect(convertMass(1, "kg", "[lb]")).toBe(kgToLb(1));
  });

  it("[lb]->kg equals lbToKg", () => {
    expect(convertMass(1, "[lb]", "kg")).toBe(0.453592);
  });

  it("g->kg uses the seeded gram factor (1000 g = 1 kg)", () => {
    expect(convertMass(1000, "g", "kg")).toBeCloseTo(1, 12);
  });

  it("returns NULL for an unknown unit (fails loud, never a silent 0 — D8)", () => {
    expect(convertMass(1, "kg", "[brix]")).toBeNull();
    expect(convertMass(1, "furlong", "kg")).toBeNull();
  });
});
