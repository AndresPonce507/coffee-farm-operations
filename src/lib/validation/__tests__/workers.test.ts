import { describe, expect, it } from "vitest";

import { validateWorker } from "@/lib/validation/workers";

/**
 * validateWorker mirrors the DB CHECKs from migration 20260620160000:
 *   - name required (non-empty)
 *   - role in WORKER_ROLES
 *   - daily_rate_usd >= 0 (finite number)
 *   - attendance in ATTENDANCE_STATUSES
 *   - started_year an integer in 1950..2100
 *   - phone required (non-empty)
 *   - crew required (non-empty)
 * today_kg is intentionally NOT part of the input (computed view later).
 */
const valid = {
  name: "Eduardo Pérez",
  role: "Picker",
  daily_rate_usd: "22",
  attendance: "present",
  started_year: "2015",
  phone: "+507 6612-7741",
  crew: "Crew Norte",
};

describe("validateWorker", () => {
  it("accepts a fully valid worker and coerces the numeric fields", () => {
    const result = validateWorker(valid);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      name: "Eduardo Pérez",
      role: "Picker",
      dailyRateUsd: 22,
      attendance: "present",
      startedYear: 2015,
      phone: "+507 6612-7741",
      crew: "Crew Norte",
    });
  });

  it("trims the name and rejects when it is empty", () => {
    const blank = validateWorker({ ...valid, name: "   " });
    expect(blank.ok).toBe(false);
    if (blank.ok) return;
    expect(blank.errors.name).toBeDefined();

    const trimmedOk = validateWorker({ ...valid, name: "  Rosa Quintero  " });
    expect(trimmedOk.ok).toBe(true);
    if (!trimmedOk.ok) return;
    expect(trimmedOk.data.name).toBe("Rosa Quintero");
  });

  it("rejects a role outside WORKER_ROLES", () => {
    const result = validateWorker({ ...valid, role: "CEO" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.role).toBeDefined();
  });

  it("accepts a zero day rate but rejects a negative one", () => {
    const zero = validateWorker({ ...valid, daily_rate_usd: "0" });
    expect(zero.ok).toBe(true);

    const negative = validateWorker({ ...valid, daily_rate_usd: "-5" });
    expect(negative.ok).toBe(false);
    if (negative.ok) return;
    expect(negative.errors.daily_rate_usd).toBeDefined();
  });

  it("rejects a non-numeric day rate", () => {
    const result = validateWorker({ ...valid, daily_rate_usd: "abc" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.daily_rate_usd).toBeDefined();
  });

  it("rejects an attendance value outside ATTENDANCE_STATUSES", () => {
    const result = validateWorker({ ...valid, attendance: "vacation" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.attendance).toBeDefined();
  });

  it("rejects a started_year below 1950 or above 2100", () => {
    const tooLow = validateWorker({ ...valid, started_year: "1949" });
    expect(tooLow.ok).toBe(false);
    if (tooLow.ok) return;
    expect(tooLow.errors.started_year).toBeDefined();

    const tooHigh = validateWorker({ ...valid, started_year: "2101" });
    expect(tooHigh.ok).toBe(false);
  });

  it("accepts the boundary years 1950 and 2100", () => {
    expect(validateWorker({ ...valid, started_year: "1950" }).ok).toBe(true);
    expect(validateWorker({ ...valid, started_year: "2100" }).ok).toBe(true);
  });

  it("rejects a non-integer started_year", () => {
    const result = validateWorker({ ...valid, started_year: "2015.5" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.started_year).toBeDefined();
  });

  it("rejects an empty phone", () => {
    const result = validateWorker({ ...valid, phone: "  " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.phone).toBeDefined();
  });

  it("rejects an empty crew", () => {
    const result = validateWorker({ ...valid, crew: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.crew).toBeDefined();
  });

  it("does not include today_kg in the parsed data", () => {
    const result = validateWorker({ ...valid, today_kg: "99" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).not.toHaveProperty("today_kg");
    expect(result.data).not.toHaveProperty("todayKg");
  });

  it("collects every error at once for an all-invalid payload", () => {
    const result = validateWorker({
      name: "",
      role: "Astronaut",
      daily_rate_usd: "-1",
      attendance: "nope",
      started_year: "1800",
      phone: "",
      crew: "",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual([
      "attendance",
      "crew",
      "daily_rate_usd",
      "name",
      "phone",
      "role",
      "started_year",
    ]);
  });
});
