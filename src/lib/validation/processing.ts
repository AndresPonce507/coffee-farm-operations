import type {
  BatchStage,
  CoffeeVariety,
  ProcessMethod,
} from "@/lib/types";
import { BATCH_STAGES, COFFEE_VARIETIES, PROCESS_METHODS } from "@/lib/enums";
import {
  isISODate,
  toNumber,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";

export interface BatchInput {
  lotCode: string;
  variety: CoffeeVariety;
  method: ProcessMethod;
  stage: BatchStage;
  startedDate: string;
  cherriesKg: number;
  currentKg: number;
  moisturePct: number;
  patio: string;
  progressPct: number;
}

/** Lot codes are JC-### traceability codes (mirrors the lots_code_format CHECK). */
const LOT_CODE = /^JC-[0-9]{3,}$/;

/** Pure validation — mirrors the DB constraints so errors surface before the round-trip. */
export function validateBatch(
  raw: Record<string, unknown>,
): ValidationResult<BatchInput> {
  const errors: Record<string, string> = {};

  const lotCode = trimmed(raw.lotCode);
  if (!LOT_CODE.test(lotCode)) errors.lotCode = "Choose a lot (JC-###).";

  const variety = trimmed(raw.variety) as CoffeeVariety;
  if (!COFFEE_VARIETIES.includes(variety)) errors.variety = "Choose a variety.";

  const method = trimmed(raw.method) as ProcessMethod;
  if (!PROCESS_METHODS.includes(method)) errors.method = "Choose a method.";

  const stage = trimmed(raw.stage) as BatchStage;
  if (!BATCH_STAGES.includes(stage)) errors.stage = "Choose a stage.";

  const startedDate = trimmed(raw.startedDate);
  if (!isISODate(startedDate)) errors.startedDate = "Choose a start date.";

  const cherriesKg = toNumber(raw.cherriesKg);
  if (cherriesKg === null || cherriesKg <= 0) {
    errors.cherriesKg = "Cherry intake must be greater than 0.";
  }

  const currentKg = toNumber(raw.currentKg);
  if (currentKg === null || currentKg < 0) {
    errors.currentKg = "Current weight can't be negative.";
  } else if (cherriesKg !== null && currentKg > cherriesKg) {
    // Mass conservation: a batch can't weigh more than the cherries it started from.
    errors.currentKg = "Current weight can't exceed the cherry intake.";
  }

  const moisturePct = toNumber(raw.moisturePct);
  if (moisturePct === null || moisturePct < 0 || moisturePct > 100) {
    errors.moisturePct = "Moisture must be between 0 and 100.";
  }

  const patio = trimmed(raw.patio);
  if (!patio) errors.patio = "Patio / bed is required.";

  const progressPct = toNumber(raw.progressPct);
  if (
    progressPct === null ||
    !Number.isInteger(progressPct) ||
    progressPct < 0 ||
    progressPct > 100
  ) {
    errors.progressPct = "Progress must be a whole number from 0 to 100.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      lotCode,
      variety,
      method,
      stage,
      startedDate,
      cherriesKg: cherriesKg as number,
      currentKg: currentKg as number,
      moisturePct: moisturePct as number,
      patio,
      progressPct: progressPct as number,
    },
  };
}
