import { describe, expect, it } from "vitest";

import {
  mapDisbursement,
  mapPayPeriodSummary,
  mapPayslip,
  mapWorkerPay,
  type DisbursementRow,
  type PayPeriodSummaryRow,
  type PayslipRow,
  type WorkerPayRow,
} from "@/lib/db/payroll";

/**
 * Direct coverage of the payroll read-port mappers (`src/lib/db/payroll.ts`) —
 * the P2-S7 blended piece-rate + hourly payroll read surface (the people-trunk
 * capstone). These pure snake_case → camelCase mappers carry the numeric
 * coercion (every *_usd / hours / count comes back as a string from PostgREST
 * numeric/aggregate columns), the made_whole boolean pass-through, the nullable
 * reverses_id / pay_line_id, and the languages-default-[] for the bilingual
 * payslip. The SQL of the underlying views (v_pay_period_summary / v_worker_pay /
 * v_payslip) + the disbursement ledger is pinned by the db-suite; this file pins
 * the TS seam. The cache()'d getters need a live DB and are not exercised here.
 */

describe("mapPayPeriodSummary", () => {
  it("coerces the counts + USD roll-ups to numbers and carries the lifecycle", () => {
    const row: PayPeriodSummaryRow = {
      id: "pp-2026-06-w3",
      period_start: "2026-06-15",
      period_end: "2026-06-21",
      season: "2026",
      status: "calculated",
      calculated_at: "2026-06-21T18:00:00Z",
      worker_count: "12",
      total_gross_usd: "1840.50",
      total_net_usd: "1638.05",
      total_make_whole_usd: "42.00",
      made_whole_count: "3",
    };
    expect(mapPayPeriodSummary(row)).toEqual({
      id: "pp-2026-06-w3",
      periodStart: "2026-06-15",
      periodEnd: "2026-06-21",
      season: "2026",
      status: "calculated",
      calculatedAt: "2026-06-21T18:00:00Z",
      workerCount: 12,
      totalGrossUsd: 1840.5,
      totalNetUsd: 1638.05,
      totalMakeWholeUsd: 42,
      madeWholeCount: 3,
    });
  });

  it("tolerates a still-open period (null season + null calculated_at)", () => {
    const m = mapPayPeriodSummary({
      id: "pp-2026-06-w4",
      period_start: "2026-06-22",
      period_end: "2026-06-28",
      season: null,
      status: "open",
      calculated_at: null,
      worker_count: 0,
      total_gross_usd: 0,
      total_net_usd: 0,
      total_make_whole_usd: 0,
      made_whole_count: 0,
    });
    expect(m.season).toBeNull();
    expect(m.calculatedAt).toBeNull();
    expect(m.workerCount).toBe(0);
    expect(m.totalGrossUsd).toBe(0);
  });
});

describe("mapWorkerPay", () => {
  it("coerces every figure, passes made_whole through, carries a null reverses_id", () => {
    const row: WorkerPayRow = {
      id: "57",
      pay_period_id: "pp-2026-06-w3",
      period_start: "2026-06-15",
      period_end: "2026-06-21",
      worker_id: "w-06",
      worker_name: "Lucía Morales",
      crew_name: "Tizingal",
      hours_worked: "40",
      piece_rate_usd: "120.00",
      hourly_usd: "0.00",
      min_wage_floor_usd: "32.00",
      make_whole_usd: "0.00",
      gross_usd: "120.00",
      css_usd: "11.70",
      seguro_educativo_usd: "1.50",
      decimo_accrual_usd: "10.00",
      net_usd: "106.80",
      status: "calculated",
      reverses_id: null,
      made_whole: false,
    };
    expect(mapWorkerPay(row)).toEqual({
      id: 57,
      payPeriodId: "pp-2026-06-w3",
      periodStart: "2026-06-15",
      periodEnd: "2026-06-21",
      workerId: "w-06",
      workerName: "Lucía Morales",
      crewName: "Tizingal",
      hoursWorked: 40,
      pieceRateUsd: 120,
      hourlyUsd: 0,
      minWageFloorUsd: 32,
      makeWholeUsd: 0,
      grossUsd: 120,
      cssUsd: 11.7,
      seguroEducativoUsd: 1.5,
      decimoAccrualUsd: 10,
      netUsd: 106.8,
      status: "calculated",
      reversesId: null,
      madeWhole: false,
    });
  });

  it("carries a make-whole top-up (made_whole true) and a null crew", () => {
    const m = mapWorkerPay({
      id: 58,
      pay_period_id: "pp-2026-06-w3",
      period_start: "2026-06-15",
      period_end: "2026-06-21",
      worker_id: "w-99",
      worker_name: "New Picker",
      crew_name: null,
      hours_worked: "8",
      piece_rate_usd: "4.00",
      hourly_usd: "0.00",
      min_wage_floor_usd: "6.40",
      make_whole_usd: "2.40",
      gross_usd: "6.40",
      css_usd: "0.39",
      seguro_educativo_usd: "0.05",
      decimo_accrual_usd: "0.33",
      net_usd: "5.96",
      status: "calculated",
      reverses_id: 57,
      made_whole: true,
    });
    expect(m.crewName).toBeNull();
    expect(m.makeWholeUsd).toBe(2.4);
    expect(m.madeWhole).toBe(true);
    expect(m.reversesId).toBe(57);
  });
});

describe("mapPayslip", () => {
  it("coerces the figures and carries the bilingual identity (preferred name + languages)", () => {
    const row: PayslipRow = {
      pay_line_id: "57",
      pay_period_id: "pp-2026-06-w3",
      period_start: "2026-06-15",
      period_end: "2026-06-21",
      season: "2026",
      worker_id: "w-06",
      worker_name: "Lucía Morales",
      preferred_name: "Luci",
      languages: ["es", "ngäbere"],
      hours_worked: "40",
      piece_rate_usd: "120.00",
      hourly_usd: "0.00",
      make_whole_usd: "0.00",
      gross_usd: "120.00",
      css_usd: "11.70",
      seguro_educativo_usd: "1.50",
      decimo_accrual_usd: "10.00",
      net_usd: "106.80",
      status: "approved",
    };
    expect(mapPayslip(row)).toEqual({
      payLineId: 57,
      payPeriodId: "pp-2026-06-w3",
      periodStart: "2026-06-15",
      periodEnd: "2026-06-21",
      season: "2026",
      workerId: "w-06",
      workerName: "Lucía Morales",
      preferredName: "Luci",
      languages: ["es", "ngäbere"],
      hoursWorked: 40,
      pieceRateUsd: 120,
      hourlyUsd: 0,
      makeWholeUsd: 0,
      grossUsd: 120,
      cssUsd: 11.7,
      seguroEducativoUsd: 1.5,
      decimoAccrualUsd: 10,
      netUsd: 106.8,
      status: "approved",
    });
  });

  it("defaults languages to [] when the identity join is null", () => {
    const m = mapPayslip({
      pay_line_id: 60,
      pay_period_id: "pp-2026-06-w3",
      period_start: "2026-06-15",
      period_end: "2026-06-21",
      season: null,
      worker_id: "w-12",
      worker_name: "Sin Identidad",
      preferred_name: null,
      languages: null,
      hours_worked: 0,
      piece_rate_usd: 0,
      hourly_usd: 0,
      make_whole_usd: 0,
      gross_usd: 0,
      css_usd: 0,
      seguro_educativo_usd: 0,
      decimo_accrual_usd: 0,
      net_usd: 0,
      status: "calculated",
    });
    expect(m.languages).toEqual([]);
    expect(m.preferredName).toBeNull();
    expect(m.season).toBeNull();
  });
});

describe("mapDisbursement", () => {
  it("coerces id/pay_line_id/amount and carries the signed-cash signature trail", () => {
    const row: DisbursementRow = {
      id: "9",
      pay_period_id: "pp-2026-06-w3",
      worker_id: "w-06",
      pay_line_id: "57",
      amount_usd: "106.80",
      method: "cash-signed",
      ref: "rcpt-0042",
      signature_ref: "sig://w-06/2026-06-21",
      disbursed_at: "2026-06-21T19:30:00Z",
    };
    expect(mapDisbursement(row)).toEqual({
      id: 9,
      payPeriodId: "pp-2026-06-w3",
      workerId: "w-06",
      payLineId: 57,
      amountUsd: 106.8,
      method: "cash-signed",
      ref: "rcpt-0042",
      signatureRef: "sig://w-06/2026-06-21",
      disbursedAt: "2026-06-21T19:30:00Z",
    });
  });

  it("tolerates a null pay_line_id and a digital-rail disbursement with no signature", () => {
    const m = mapDisbursement({
      id: 10,
      pay_period_id: "pp-2026-06-w3",
      worker_id: "w-07",
      pay_line_id: null,
      amount_usd: "88.20",
      method: "yappy",
      ref: "yap-7781",
      signature_ref: null,
      disbursed_at: "2026-06-21T19:31:00Z",
    });
    expect(m.payLineId).toBeNull();
    expect(m.signatureRef).toBeNull();
    expect(m.amountUsd).toBe(88.2);
    expect(m.method).toBe("yappy");
  });
});
