import Link from "next/link";
import { ReceiptText } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PayrollSummary } from "@/components/sections/payroll/payroll-summary";
import { PeriodBoard } from "@/components/sections/payroll/period-board";
import { PayBreakdownTable } from "@/components/sections/payroll/pay-breakdown-table";
import { QrPayslip } from "@/components/sections/payroll/qr-payslip";
import {
  ApprovePayLineButton,
  ComputePeriodForm,
  DisbursementForm,
  DisbursementLedger,
} from "@/components/sections/payroll/disbursement-form.client";
import {
  getPayPeriods,
  getWorkerPayForPeriod,
  getPayslip,
  getDisbursementsForPeriod,
  type WorkerPay,
} from "@/lib/db/payroll";
import { cn } from "@/lib/utils";
import {
  approvePayLineAction,
  computePayPeriodAction,
  recordDisbursementAction,
} from "./actions";

/**
 * Payroll — the "/payroll" route for Coffee Farm Operations (P2-S7), the people-
 * trunk capstone and the join of both Phase-2 capture trunks (S1 attendance +
 * por-obra, S2 weigh kg). It makes the most legally/money-sensitive surface legible
 * AND drivable: the family runs payroll here, end to end.
 *
 *  - a headline strip (PayrollSummary) foregrounding the make-whole protection;
 *  - a glass period board (PeriodBoard) — open → calculated → approved → paid;
 *  - the CALCULATE form (ComputePeriodForm) that freezes a period's snapshot;
 *  - the per-worker pay cockpit (PayBreakdownTable) for the selected period, every
 *    figure traceable to its weigh/attendance/por-obra provenance, with the
 *    MIN-WAGE MAKE-WHOLE top-up surfaced + highlighted exactly when the legal-floor
 *    guard lifted a worker (the guard itself lives un-bypassably in the database);
 *  - the per-worker APPROVE gate + the deliberate RECORD-DISBURSEMENT form (the
 *    irreversible money action, with the $0 signed-cash signature capture for the
 *    unbanked crew) — both wired to the already-tested Server Actions;
 *  - a worker selector that opens any worker's bilingual (es/ngäbere) QR payslip in
 *    one tap (no hand-typed worker UUID);
 *  - the append-only disbursement ledger so the family can see who's been paid.
 *
 * Server Component: read data flows from the `payroll` read ports (security_invoker
 * views governed by the authenticated-read RLS the S7 migration set). The WRITE
 * islands are `"use client"` and receive the Server Actions BY SHAPE as props, so
 * the make-whole guard, statutory math, append-only ledgers, and the
 * disbursement→COGS write stay the DB's job; nothing here re-implements them.
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
  const activePeriod = periods.find((p) => p.id === activePeriodId) ?? null;

  const [rows, disbursements] = activePeriodId
    ? await Promise.all([
        getWorkerPayForPeriod(activePeriodId),
        getDisbursementsForPeriod(activePeriodId),
      ])
    : [[] as WorkerPay[], []];

  // resolve a worker's payslip only when both a period and a worker are selected.
  const payslip =
    activePeriodId && worker
      ? await getPayslip(activePeriodId, worker)
      : null;

  // workerId → name, for the disbursement ledger (the ledger has only ids).
  const workerNames = Object.fromEntries(
    rows.map((r) => [r.workerId, r.workerName]),
  );

  // Net already disbursed per worker (sum of all rows incl. reversing negatives),
  // so a worker is "fully paid" only once paid >= their net — partials show as owed.
  const paidByWorker = disbursements.reduce<Record<string, number>>((acc, d) => {
    acc[d.workerId] = (acc[d.workerId] ?? 0) + d.amountUsd;
    return acc;
  }, {});

  const isApproved = (r: WorkerPay) => r.status === "approved";
  const isCalculated = (r: WorkerPay) => r.status === "calculated";
  const isFullyPaid = (r: WorkerPay) => (paidByWorker[r.workerId] ?? 0) >= r.netUsd;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll"
        subtitle="Blended piece-rate + hourly pay, with the legal-minimum make-whole guaranteed at the data layer"
      />

      <PayrollSummary periods={periods} />

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-6">
          <PeriodBoard
            periods={periods}
            activePeriodId={activePeriodId ?? undefined}
          />

          {/* ── Calculate (freeze) a pay period ───────────────────────── */}
          <Card className="animate-rise">
            <CardContent className="space-y-3">
              <div>
                <h2 className="font-display text-sm font-semibold text-ink">
                  Calcular un período
                </h2>
                <p className="mt-0.5 text-xs text-muted-fg">
                  Congela el cálculo: una línea por trabajador, con el ajuste al
                  mínimo legal aplicado.
                </p>
              </div>
              <ComputePeriodForm
                action={computePayPeriodAction}
                defaultSeason={activePeriod?.season ?? undefined}
              />
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          {payslip ? <QrPayslip payslip={payslip} /> : null}

          {/* ── Worker selector → opens each worker's bilingual payslip ── */}
          {activePeriodId && rows.length > 0 ? (
            <Card data-testid="payslip-selector" className="animate-rise">
              <CardContent className="space-y-2">
                <div className="flex items-center gap-2">
                  <ReceiptText
                    className="h-4 w-4 text-coffee"
                    aria-hidden="true"
                  />
                  <h2 className="font-display text-sm font-semibold text-ink">
                    Comprobantes de pago
                  </h2>
                </div>
                <p className="text-xs text-muted-fg">
                  Toque a un trabajador para ver su comprobante bilingüe (es ·
                  ngäbere) con código QR.
                </p>
                <ul className="flex flex-wrap gap-2 pt-1">
                  {rows.map((r) => {
                    const selected = r.workerId === worker;
                    return (
                      <li key={r.workerId}>
                        <Link
                          href={`/payroll?period=${activePeriodId}&worker=${r.workerId}`}
                          aria-label={`Ver el comprobante de pago de ${r.workerName}`}
                          aria-current={selected ? "true" : undefined}
                          className={cn(
                            "block rounded-full border border-white/60 bg-white/60 px-3 py-1.5 text-xs font-medium text-ink",
                            "outline-none ring-forest/30 transition hover:bg-white/80 focus-visible:ring-2",
                            selected && "ring-2 ring-forest/60",
                          )}
                        >
                          {r.workerName}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <PayBreakdownTable rows={rows} />

          {/* ── Per-worker approve gate + record-disbursement door ─────── */}
          {activePeriodId && rows.length > 0 ? (
            <Card className="animate-rise">
              <CardContent className="space-y-4">
                <div>
                  <h2 className="font-display text-sm font-semibold text-ink">
                    Aprobar y pagar
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-fg">
                    Apruebe cada línea calculada, luego registre el pago (Yappy /
                    Nequi / ACH / efectivo firmado).
                  </p>
                </div>

                <ul className="space-y-4">
                  {rows.map((r) => (
                    <li
                      key={r.id}
                      data-testid={`pay-action-row-${r.workerId}`}
                      className="rounded-2xl border border-white/60 bg-white/45 p-4"
                    >
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink">
                            {r.workerName}
                          </p>
                          <p className="text-xs text-muted-fg">
                            {statusLabel(r.status)}
                            {isFullyPaid(r) ? " · pagado" : ""}
                          </p>
                        </div>
                        {isCalculated(r) ? (
                          <ApprovePayLineButton
                            payLineId={r.id}
                            workerName={r.workerName}
                            action={approvePayLineAction}
                          />
                        ) : null}
                      </div>

                      {isApproved(r) && !isFullyPaid(r) ? (
                        <DisbursementForm
                          payPeriodId={activePeriodId}
                          worker={r}
                          action={recordDisbursementAction}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {/* ── Append-only recorded-payment ledger ───────────────────── */}
          <DisbursementLedger
            disbursements={disbursements}
            workerNames={workerNames}
          />
        </div>
      </div>
    </div>
  );
}

/** A friendly Spanish label for a pay line's lifecycle status. */
function statusLabel(status: string): string {
  switch (status) {
    case "approved":
      return "aprobado";
    case "paid":
      return "pagado";
    case "calculated":
    default:
      return "calculado";
  }
}
