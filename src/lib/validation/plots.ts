import type { CoffeeVariety, PlotStatus } from "@/lib/types";
import { COFFEE_VARIETIES, PLOT_STATUSES } from "@/lib/enums";
import {
  isISODate,
  toNumber,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";

export interface PlotInput {
  name: string;
  block: string;
  variety: CoffeeVariety;
  areaHa: number;
  altitudeMasl: number;
  trees: number;
  shadePct: number;
  establishedYear: number;
  status: PlotStatus;
  lastInspected: string;
  expectedYieldKg: number;
}

/** Pure validation — mirrors the DB constraints so errors surface before the round-trip. */
export function validatePlot(
  raw: Record<string, unknown>,
): ValidationResult<PlotInput> {
  const errors: Record<string, string> = {};

  const name = trimmed(raw.name);
  if (!name) errors.name = "Name is required.";

  const block = trimmed(raw.block);
  if (!block) errors.block = "Block is required.";

  const variety = trimmed(raw.variety) as CoffeeVariety;
  if (!COFFEE_VARIETIES.includes(variety)) errors.variety = "Choose a variety.";

  const status = trimmed(raw.status) as PlotStatus;
  if (!PLOT_STATUSES.includes(status)) errors.status = "Choose a status.";

  const lastInspected = trimmed(raw.last_inspected);
  if (!isISODate(lastInspected)) errors.last_inspected = "Choose an inspection date.";

  const areaHa = toNumber(raw.area_ha);
  if (areaHa === null || areaHa <= 0) errors.area_ha = "Area must be greater than 0.";

  const altitudeMasl = toNumber(raw.altitude_masl);
  if (altitudeMasl === null || altitudeMasl <= 0)
    errors.altitude_masl = "Altitude must be greater than 0.";

  const trees = toNumber(raw.trees);
  if (trees === null || trees < 0 || !Number.isInteger(trees))
    errors.trees = "Trees must be a whole number ≥ 0.";

  const shadePct = toNumber(raw.shade_pct);
  if (shadePct === null || shadePct < 0 || shadePct > 100 || !Number.isInteger(shadePct))
    errors.shade_pct = "Shade must be a whole number 0–100.";

  const establishedYear = toNumber(raw.established_year);
  if (
    establishedYear === null ||
    establishedYear < 1950 ||
    establishedYear > 2100 ||
    !Number.isInteger(establishedYear)
  )
    errors.established_year = "Year must be between 1950 and 2100.";

  const expectedYieldKg = toNumber(raw.expected_yield_kg);
  if (expectedYieldKg === null || expectedYieldKg < 0)
    errors.expected_yield_kg = "Expected yield must be ≥ 0.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      name,
      block,
      variety,
      areaHa: areaHa as number,
      altitudeMasl: altitudeMasl as number,
      trees: trees as number,
      shadePct: shadePct as number,
      establishedYear: establishedYear as number,
      status,
      lastInspected,
      expectedYieldKg: expectedYieldKg as number,
    },
  };
}
