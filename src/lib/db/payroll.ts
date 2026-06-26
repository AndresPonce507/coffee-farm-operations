import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/* ====================================================================== */
/* P2-S7 — blended piece-rate + hourly PAYROLL read-port (THE PEOPLE-TRUNK */
/* CAPSTONE). The read side of the make-whole-guarded earnings ledger: the */
/* per-period board roll-up, the per-worker calculated pay breakdown (with  */
/* the make-whole highlight signal), the bilingual QR-payslip payload, and  */
/* the append-only disbursement record. Each read from the frozen DB        */
/* contract (v_pay_period_summary / v_worker_pay / v_payslip views +         */
/* the disbursement ledger). Writes never flow through here — they go        */
/* through the compute_pay_period / approve_pay_line / record_disbursement   */
/* command RPCs (the make-whole guard is the table's, enforced in three DB   */
/* layers). Mirrors the people.ts / weigh.ts shape: Row iface + pure map +   */
/* cache()'d getter, snake_case → camelCase, numeric coercion via Number().  */
/* ====================================================================== */

/* ---------------------------------------------------------------------- */
/* Pay-period board — v_pay_period_summary                                */
/* ---------------------------------------------------------------------- */

/** A `v_pay_period_summary` row as PostgREST returns it (snake_case). */
export interface PayPeriodSummaryRow {
  id: string;
  period_start: string;
  period_end: string;
  season: string | null;
  status: string;
  calculated_at: string | null;
  worker_count: number | string;
  total_gross_usd: number | string;
  total_net_usd: number | string;
  total_make_whole_usd: number | string;
  made_whole_count: number | string;
}

/** Domain shape of one payroll period's board roll-up (camelCase). */
export interface PayPeriodSummary {
  id: string;
  periodStart: string;
  periodEnd: string;
  season: string | null;
  status: string;
  calculatedAt: string | null;
  workerCount: number;
  totalGrossUsd: number;
  totalNetUsd: number;
  totalMakeWholeUsd: number;
  madeWholeCount: number;
}

/** Pure row → domain mapper (numeric coercion of the counts + USD roll-ups). */
export function mapPayPeriodSummary(r: PayPeriodSummaryRow): PayPeriodSummary {
  return {
    id: r.id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    season: r.season,
    status: r.status,
    calculatedAt: r.calculated_at,
    workerCount: Number(r.worker_count),
    totalGrossUsd: Number(r.total_gross_usd),
    totalNetUsd: Number(r.total_net_usd),
    totalMakeWholeUsd: Number(r.total_make_whole_usd),
    madeWholeCount: Number(r.made_whole_count),
  };
}

/**
 * The payroll period board — every pay window with its status, calculate
 * timestamp, and the per-period roll-ups (worker count, Σ gross/net/make-whole,
 * how many workers were lifted to the legal floor). Newest window first.
 */
export const getPayPeriods = cache(async (): Promise<PayPeriodSummary[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_pay_period_summary")
    .select("*")
    .order("period_start", { ascending: false });
  if (error) throw new Error(`getPayPeriods: ${error.message}`);
  return (data as PayPeriodSummaryRow[]).map(mapPayPeriodSummary);
});

/**
 * ONE pay period by its id — the /pay-period/[id] dossier anchor (Phase 5 L2,
 * facet-02 §5/§11). Reads the SAME `v_pay_period_summary` view getPayPeriods()
 * reads, narrowed to a single id (the same id getPayPeriods() exposes as the row
 * key, so entityHref["pay-period"] links resolve here). Returns null for an
 * unknown id so the dossier calls notFound() (no fabricated period). Read-only.
 */
export const getPayPeriodById = cache(
  async (id: string): Promise<PayPeriodSummary | null> => {
    const { data, error } = await (await getSupabase())
      .from("v_pay_period_summary")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`getPayPeriodById: ${error.message}`);
    return data ? mapPayPeriodSummary(data as PayPeriodSummaryRow) : null;
  },
);

/* ---------------------------------------------------------------------- */
/* Per-worker calculated pay — v_worker_pay                               */
/* ---------------------------------------------------------------------- */

/** A `v_worker_pay` row as PostgREST returns it (snake_case). */
export interface WorkerPayRow {
  id: number | string;
  pay_period_id: string;
  period_start: string;
  period_end: string;
  worker_id: string;
  worker_name: string;
  crew_name: string | null;
  hours_worked: number | string;
  piece_rate_usd: number | string;
  hourly_usd: number | string;
  min_wage_floor_usd: number | string;
  make_whole_usd: number | string;
  gross_usd: number | string;
  css_usd: number | string;
  seguro_educativo_usd: number | string;
  decimo_accrual_usd: number | string;
  net_usd: number | string;
  status: string;
  reverses_id: number | null;
  made_whole: boolean;
}

/** Domain shape of one worker's frozen pay-line breakdown (camelCase). */
export interface WorkerPay {
  id: number;
  payPeriodId: string;
  periodStart: string;
  periodEnd: string;
  workerId: string;
  workerName: string;
  crewName: string | null;
  hoursWorked: number;
  pieceRateUsd: number;
  hourlyUsd: number;
  minWageFloorUsd: number;
  makeWholeUsd: number;
  grossUsd: number;
  cssUsd: number;
  seguroEducativoUsd: number;
  decimoAccrualUsd: number;
  netUsd: number;
  status: string;
  reversesId: number | null;
  madeWhole: boolean;
}

/** Pure row → domain mapper (numeric coercion of every figure; made_whole passes through). */
export function mapWorkerPay(r: WorkerPayRow): WorkerPay {
  return {
    id: Number(r.id),
    payPeriodId: r.pay_period_id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    workerId: r.worker_id,
    workerName: r.worker_name,
    crewName: r.crew_name,
    hoursWorked: Number(r.hours_worked),
    pieceRateUsd: Number(r.piece_rate_usd),
    hourlyUsd: Number(r.hourly_usd),
    minWageFloorUsd: Number(r.min_wage_floor_usd),
    makeWholeUsd: Number(r.make_whole_usd),
    grossUsd: Number(r.gross_usd),
    cssUsd: Number(r.css_usd),
    seguroEducativoUsd: Number(r.seguro_educativo_usd),
    decimoAccrualUsd: Number(r.decimo_accrual_usd),
    netUsd: Number(r.net_usd),
    status: r.status,
    reversesId: r.reverses_id,
    madeWhole: r.made_whole,
  };
}

/**
 * One period's per-worker pay breakdown — every original (non-reversal)
 * calculated line with its full blended figures, the make-whole top-up, the
 * statutory withholdings, and the `madeWhole` highlight flag. Highest gross
 * first. Reversing rows are filtered out (`reverses_id is null`).
 */
export const getWorkerPayForPeriod = cache(
  async (payPeriodId: string): Promise<WorkerPay[]> => {
    const { data, error } = await (await getSupabase())
      .from("v_worker_pay")
      .select("*")
      .eq("pay_period_id", payPeriodId)
      .is("reverses_id", null)
      .order("gross_usd", { ascending: false });
    if (error) throw new Error(`getWorkerPayForPeriod: ${error.message}`);
    return (data as WorkerPayRow[]).map(mapWorkerPay);
  },
);

/* ---------------------------------------------------------------------- */
/* Bilingual QR payslip — v_payslip                                       */
/* ---------------------------------------------------------------------- */

/** A `v_payslip` row as PostgREST returns it (snake_case). */
export interface PayslipRow {
  pay_line_id: number | string;
  pay_period_id: string;
  period_start: string;
  period_end: string;
  season: string | null;
  worker_id: string;
  worker_name: string;
  preferred_name: string | null;
  languages: string[] | null;
  hours_worked: number | string;
  piece_rate_usd: number | string;
  hourly_usd: number | string;
  make_whole_usd: number | string;
  gross_usd: number | string;
  css_usd: number | string;
  seguro_educativo_usd: number | string;
  decimo_accrual_usd: number | string;
  net_usd: number | string;
  status: string;
}

/** Domain shape of one bilingual QR-payslip payload (camelCase). */
export interface Payslip {
  payLineId: number;
  payPeriodId: string;
  periodStart: string;
  periodEnd: string;
  season: string | null;
  workerId: string;
  workerName: string;
  preferredName: string | null;
  languages: string[];
  hoursWorked: number;
  pieceRateUsd: number;
  hourlyUsd: number;
  makeWholeUsd: number;
  grossUsd: number;
  cssUsd: number;
  seguroEducativoUsd: number;
  decimoAccrualUsd: number;
  netUsd: number;
  status: string;
}

/** Pure row → domain mapper. `languages` defaults to [] when null/absent. */
export function mapPayslip(r: PayslipRow): Payslip {
  return {
    payLineId: Number(r.pay_line_id),
    payPeriodId: r.pay_period_id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    season: r.season,
    workerId: r.worker_id,
    workerName: r.worker_name,
    preferredName: r.preferred_name,
    languages: r.languages ?? [],
    hoursWorked: Number(r.hours_worked),
    pieceRateUsd: Number(r.piece_rate_usd),
    hourlyUsd: Number(r.hourly_usd),
    makeWholeUsd: Number(r.make_whole_usd),
    grossUsd: Number(r.gross_usd),
    cssUsd: Number(r.css_usd),
    seguroEducativoUsd: Number(r.seguro_educativo_usd),
    decimoAccrualUsd: Number(r.decimo_accrual_usd),
    netUsd: Number(r.net_usd),
    status: r.status,
  };
}

/**
 * One worker's payslip for a period — the frozen pay line joined to their
 * identity (preferred name + languages, for the es/ngäbere bilingual render)
 * and the period window. Returns null when no line exists for that pair.
 */
export const getPayslip = cache(
  async (payPeriodId: string, workerId: string): Promise<Payslip | null> => {
    const { data, error } = await (await getSupabase())
      .from("v_payslip")
      .select("*")
      .eq("pay_period_id", payPeriodId)
      .eq("worker_id", workerId)
      .maybeSingle();
    if (error) throw new Error(`getPayslip: ${error.message}`);
    return data ? mapPayslip(data as PayslipRow) : null;
  },
);

/* ---------------------------------------------------------------------- */
/* Disbursement ledger — disbursement (append-only)                       */
/* ---------------------------------------------------------------------- */

/** A `disbursement` row as PostgREST returns it (snake_case). */
export interface DisbursementRow {
  id: number | string;
  pay_period_id: string;
  worker_id: string;
  pay_line_id: number | string | null;
  amount_usd: number | string;
  method: string;
  ref: string | null;
  signature_ref: string | null;
  disbursed_at: string;
}

/** Domain shape of one append-only payment record (camelCase). */
export interface Disbursement {
  id: number;
  payPeriodId: string;
  workerId: string;
  payLineId: number | null;
  amountUsd: number;
  method: string;
  ref: string | null;
  signatureRef: string | null;
  disbursedAt: string;
}

/** Pure row → domain mapper (numeric coercion of id/pay_line_id/amount). */
export function mapDisbursement(r: DisbursementRow): Disbursement {
  return {
    id: Number(r.id),
    payPeriodId: r.pay_period_id,
    workerId: r.worker_id,
    payLineId: r.pay_line_id === null ? null : Number(r.pay_line_id),
    amountUsd: Number(r.amount_usd),
    method: r.method,
    ref: r.ref,
    signatureRef: r.signature_ref,
    disbursedAt: r.disbursed_at,
  };
}

/**
 * One period's append-only disbursement ledger — every recorded payment
 * (Yappy / Nequi / ACH / signed-cash), newest first. Record-only; corrections
 * are reversing (negative-amount) rows. The signed-cash dignity trail keeps
 * its signature reference.
 */
export const getDisbursementsForPeriod = cache(
  async (payPeriodId: string): Promise<Disbursement[]> => {
    const { data, error } = await (await getSupabase())
      .from("disbursement")
      .select(
        "id,pay_period_id,worker_id,pay_line_id,amount_usd,method,ref,signature_ref,disbursed_at",
      )
      .eq("pay_period_id", payPeriodId)
      .order("disbursed_at", { ascending: false });
    if (error) throw new Error(`getDisbursementsForPeriod: ${error.message}`);
    return (data as DisbursementRow[]).map(mapDisbursement);
  },
);
