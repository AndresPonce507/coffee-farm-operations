import type { AttendanceStatus, WorkerRole } from "@/lib/types";
import { ATTENDANCE_STATUSES, WORKER_ROLES } from "@/lib/enums";
import {
  toNumber,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";

export interface WorkerInput {
  name: string;
  role: WorkerRole;
  dailyRateUsd: number;
  attendance: AttendanceStatus;
  startedYear: number;
  phone: string;
  crew: string;
}

/**
 * Pure validation — mirrors the `workers` DB constraints (NOT NULL columns,
 * the role/attendance enums, and the CHECKs from migration 20260620160000:
 * daily_rate_usd >= 0, started_year between 1950 and 2100) so errors surface
 * before the round-trip. `today_kg` is intentionally excluded — it becomes a
 * computed view later, so it is never written from the form.
 */
export function validateWorker(
  raw: Record<string, unknown>,
): ValidationResult<WorkerInput> {
  const errors: Record<string, string> = {};

  const name = trimmed(raw.name);
  if (!name) errors.name = "Name is required.";

  const role = trimmed(raw.role) as WorkerRole;
  if (!WORKER_ROLES.includes(role)) errors.role = "Choose a role.";

  const dailyRateUsd = toNumber(raw.daily_rate_usd);
  if (dailyRateUsd === null || dailyRateUsd < 0) {
    errors.daily_rate_usd = "Enter a day rate of $0 or more.";
  }

  const attendance = trimmed(raw.attendance) as AttendanceStatus;
  if (!ATTENDANCE_STATUSES.includes(attendance)) {
    errors.attendance = "Choose an attendance status.";
  }

  const startedYear = toNumber(raw.started_year);
  if (
    startedYear === null ||
    !Number.isInteger(startedYear) ||
    startedYear < 1950 ||
    startedYear > 2100
  ) {
    errors.started_year = "Enter a year between 1950 and 2100.";
  }

  const phone = trimmed(raw.phone);
  if (!phone) errors.phone = "Phone is required.";

  const crew = trimmed(raw.crew);
  if (!crew) errors.crew = "Choose a crew.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      name,
      role,
      dailyRateUsd: dailyRateUsd as number,
      attendance,
      startedYear: startedYear as number,
      phone,
      crew,
    },
  };
}
