import {
  isISODate,
  toNumber,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";

export interface HarvestInput {
  date: string;
  plotId: string;
  workerId: string;
  cherriesKg: number;
  ripenessPct: number;
  brixAvg: number;
  lotCode: string;
}

/** Lot traceability code — mirrors the `lots_code_format` DB CHECK. */
const LOT_CODE = /^JC-[0-9]{3,}$/;

/** Pure validation — mirrors the harvests DB constraints so errors surface before the round-trip. */
export function validateHarvest(
  raw: Record<string, unknown>,
): ValidationResult<HarvestInput> {
  const errors: Record<string, string> = {};

  const date = trimmed(raw.date);
  if (!isISODate(date)) errors.date = "Choose a harvest date.";

  const plotId = trimmed(raw.plotId);
  if (!plotId) errors.plotId = "Choose a plot.";

  const workerId = trimmed(raw.workerId);
  if (!workerId) errors.workerId = "Choose a picker.";

  const cherriesKg = toNumber(raw.cherriesKg);
  if (cherriesKg === null || cherriesKg <= 0) {
    errors.cherriesKg = "Cherries (kg) must be greater than 0.";
  }

  const ripenessPct = toNumber(raw.ripenessPct);
  if (ripenessPct === null || ripenessPct < 0 || ripenessPct > 100) {
    errors.ripenessPct = "Ripeness must be between 0 and 100.";
  }

  const brixAvg = toNumber(raw.brixAvg);
  if (brixAvg === null || brixAvg < 0) {
    errors.brixAvg = "Brix must be 0 or greater.";
  }

  const lotCode = trimmed(raw.lotCode);
  if (!LOT_CODE.test(lotCode)) errors.lotCode = "Choose a lot code (e.g. JC-564).";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      date,
      plotId,
      workerId,
      cherriesKg: cherriesKg as number,
      ripenessPct: ripenessPct as number,
      brixAvg: brixAvg as number,
      lotCode,
    },
  };
}
