import { PageHeader } from "@/components/ui/page-header";
import { PayrollSummary } from "@/components/sections/payroll/payroll-summary";
import { PeriodBoard } from "@/components/sections/payroll/period-board";
import { PayBreakdownTable } from "@/components/sections/payroll/pay-breakdown-table";
import { QrPayslip } from "@/components/sections/payroll/qr-payslip";
import {
  getPayPeriods,
  getWorkerPayForPeriod,
  getPayslip,
} from "@/lib/db/payroll";

/**
 * Payroll — the "/payroll" route for Coffee Farm Operations (P2-S7), the people-
 * trunk capstone and the join of both Phase-2 capture trunks (S1 attendance +
 * por-obra, S2 weigh kg). It makes the most legally/money-sensitive surface legible:
 *
 *  - a headline strip (PayrollSummary) foregrounding the make-whole protection;
 *  - a glass period board (PeriodBoard) — open → calculated → approved → paid;
 *  - the per-worker pay cockpit (PayBreakdownTable) for the selected period, every
 *    figure traceable to its weigh/attendance/por-obra provenance, with the
 *    MIN-WAGE MAKE-WHOLE top-up surfaced + highlighted exactly when the legal-floor
 *    guard lifted a worker (the guard itself lives un-bypassably in the database);
 *  - a worker's bilingual (es/ngäbere) QR payslip when one is selected.
 *
 * Server Component: all data flows from the `payroll` read ports (security_invoker
 * views governed by the authenticated-read RLS the S7 migration set). The append-only
 * pay_line / disbursement ledgers are the audit trail behind every number; nothing
 * here re-implements a projection or the make-whole math (the DB is the source).
 *
 * The active period + an optional payslip worker are selected via searchParams
 * (?period=…&worker=…), so the cockpit + payslip are shareable, bookmarkable URLs.
 */
export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; worker?: string }>;
}) {
  const { period, worker } = await searchParams;

  const periods = await getPayPeriods();
  // default to the most-recent period (the board is ordered newest-first).
  const activePeriodId = period ?? periods[0]?.id ?? null;

  const rows = activePeriodId
    ? await getWorkerPayForPeriod(activePeriodId)
    : [];

  // resolve a worker's payslip only when both a period and a worker are selected.
  const payslip =
    activePeriodId && worker
      ? await getPayslip(activePeriodId, worker)
      : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll"
        subtitle="Blended piece-rate + hourly pay, with the legal-minimum make-whole guaranteed at the data layer"
      />

      <PayrollSummary periods={periods} />

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <PeriodBoard
          periods={periods}
          activePeriodId={activePeriodId ?? undefined}
        />

        <div className="min-w-0 space-y-6">
          {payslip ? (
            <QrPayslip payslip={payslip} />
          ) : null}

          <PayBreakdownTable rows={rows} />
        </div>
      </div>
    </div>
  );
}
