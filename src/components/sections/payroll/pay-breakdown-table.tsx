import { HeartHandshake, Users } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { THead, TBody, TR, TH, TD } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { EntityLink } from "@/components/ui/entity-link";
import type { WorkerPay } from "@/lib/db/payroll";
import { cn } from "@/lib/utils";

/**
 * PayBreakdownTable — the per-worker pay cockpit for one period (P2-S7).
 *
 * Every original (non-reversal) pay line, fully decomposed: the blended
 * piece-rate + hourly base, the MAKE-WHOLE top-up (the legal-floor guard, the
 * emotional/legal centerpiece — when it fired we show the top-up amount in a
 * dignified honey pill labelled "topped up to the legal minimum"; otherwise a
 * muted dash), gross, the statutory withholdings (CSS, Seguro Educativo), the
 * décimo accrual, and net. A footer totals every money column.
 *
 * A made-whole row carries a subtle honey left-border + tint so the eye lands on
 * the worker the floor protected. Money is USD-with-cents via a shared `usd()`,
 * every figure tabular-nums so the columns align. Responsive: a dense table on md+
 * and a stacked record-card list below md — the SAME rows, no horizontal scroll.
 * Pure presentation; the route hands in the rows.
 */
export interface PayBreakdownTableProps {
  rows: WorkerPay[];
  className?: string;
}

/** USD with cents — the table's self-contained money formatter. */
function usd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const MADE_WHOLE_LABEL = "topped up to the legal minimum";

/** The make-whole cell — a dignified honey pill when it fired, else a muted dash. */
function MakeWholeCell({ row }: { row: WorkerPay }) {
  if (!row.madeWhole) {
    return <span className="text-muted-fg/60">—</span>;
  }
  return (
    <span
      data-testid={`make-whole-pill-${row.id}`}
      className="inline-flex items-center gap-1.5 rounded-full bg-honey-100 px-2.5 py-1 text-xs font-semibold tabular-nums text-honey-700 ring-1 ring-honey/30"
      title={MADE_WHOLE_LABEL}
    >
      <HeartHandshake className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        {usd(row.makeWholeUsd)}
        <span className="sr-only"> — {MADE_WHOLE_LABEL}</span>
      </span>
    </span>
  );
}

export function PayBreakdownTable({ rows, className }: PayBreakdownTableProps) {
  if (rows.length === 0) {
    return (
      <Card data-testid="pay-breakdown-table" className="animate-rise">
        <CardContent className="py-4">
          <EmptyState
            icon={Users}
            title="No pay lines for this period"
            description="Calculate the period to roll up each worker's blended piece-rate + hourly earnings, with the legal-minimum make-whole guard applied."
          />
        </CardContent>
      </Card>
    );
  }

  const totals = rows.reduce(
    (acc, r) => ({
      makeWhole: acc.makeWhole + r.makeWholeUsd,
      gross: acc.gross + r.grossUsd,
      css: acc.css + r.cssUsd,
      seguro: acc.seguro + r.seguroEducativoUsd,
      decimo: acc.decimo + r.decimoAccrualUsd,
      net: acc.net + r.netUsd,
    }),
    { makeWhole: 0, gross: 0, css: 0, seguro: 0, decimo: 0, net: 0 },
  );

  return (
    <div data-testid="pay-breakdown-table" className={cn("animate-rise", className)}>
      {/* ── Dense desktop table (lg+). Collapses to record-cards below lg. ── */}
      <div
        data-testid="pay-breakdown-desktop"
        className="hidden overflow-hidden rounded-2xl glass-card lg:block"
      >
        <table className="w-full border-separate border-spacing-0 text-sm">
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Worker</TH>
              <TH className="text-right">Piece-rate</TH>
              <TH className="text-right">Hourly</TH>
              <TH className="text-right">Make-whole</TH>
              <TH className="text-right">Gross</TH>
              <TH className="text-right">CSS</TH>
              <TH className="text-right">Seguro Educativo</TH>
              <TH className="text-right">Décimo</TH>
              <TH className="text-right">Net</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR
                key={r.id}
                data-made-whole={r.madeWhole ? "true" : "false"}
                className={cn(
                  "group align-middle",
                  r.madeWhole &&
                    "bg-honey-100/30 hover:bg-honey-100/50 [&>td:first-child]:border-l-2 [&>td:first-child]:border-honey",
                )}
              >
                <TD>
                  <div className="flex flex-col">
                    <EntityLink kind="worker" id={r.workerId} name={r.workerId}>
                      <span className="font-medium text-ink">{r.workerName}</span>
                    </EntityLink>
                    {r.crewName ? (
                      <span className="text-xs text-muted-fg">{r.crewName}</span>
                    ) : null}
                  </div>
                </TD>
                <TD className="text-right tabular-nums text-muted-fg">
                  {usd(r.pieceRateUsd)}
                </TD>
                <TD className="text-right tabular-nums text-muted-fg">
                  {usd(r.hourlyUsd)}
                </TD>
                <TD className="text-right">
                  <MakeWholeCell row={r} />
                </TD>
                <TD className="text-right tabular-nums font-medium text-ink">
                  {usd(r.grossUsd)}
                </TD>
                <TD className="text-right tabular-nums text-muted-fg">
                  {usd(r.cssUsd)}
                </TD>
                <TD className="text-right tabular-nums text-muted-fg">
                  {usd(r.seguroEducativoUsd)}
                </TD>
                <TD className="text-right tabular-nums text-muted-fg">
                  {usd(r.decimoAccrualUsd)}
                </TD>
                <TD className="text-right tabular-nums font-semibold text-forest-700">
                  {usd(r.netUsd)}
                </TD>
              </TR>
            ))}
          </TBody>
          <tfoot className="border-t border-white/60 bg-white/40">
            <tr className="font-semibold">
              <TD className="text-ink">Totals</TD>
              <TD className="text-right text-muted-fg/60">—</TD>
              <TD className="text-right text-muted-fg/60">—</TD>
              <TD className="text-right tabular-nums text-honey-700">
                {usd(totals.makeWhole)}
              </TD>
              <TD className="text-right tabular-nums text-ink">
                {usd(totals.gross)}
              </TD>
              <TD className="text-right tabular-nums text-muted-fg">
                {usd(totals.css)}
              </TD>
              <TD className="text-right tabular-nums text-muted-fg">
                {usd(totals.seguro)}
              </TD>
              <TD className="text-right tabular-nums text-muted-fg">
                {usd(totals.decimo)}
              </TD>
              <TD className="text-right tabular-nums text-forest-700">
                {usd(totals.net)}
              </TD>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Record-card list (below lg). Same rows, stacked, no horizontal scroll. ── */}
      <ul
        data-testid="pay-breakdown-mobile"
        className="stagger space-y-3 lg:hidden"
      >
        {rows.map((r) => (
          <li
            key={r.id}
            data-made-whole={r.madeWhole ? "true" : "false"}
            className={cn(
              "rounded-2xl border border-white/60 bg-white/55 p-4 shadow-[0_8px_24px_-16px_rgba(0,41,29,0.35)]",
              r.madeWhole && "border-l-2 border-l-honey bg-honey-100/30",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <EntityLink kind="worker" id={r.workerId} name={r.workerId}>
                  <p className="font-medium text-ink">{r.workerName}</p>
                </EntityLink>
                {r.crewName ? (
                  <p className="truncate text-xs text-muted-fg">{r.crewName}</p>
                ) : null}
              </div>
              <div className="text-right">
                <p className="text-[11px] uppercase tracking-wide text-muted-fg">
                  Net
                </p>
                <p className="font-display text-base font-semibold tabular-nums text-forest-700">
                  {usd(r.netUsd)}
                </p>
              </div>
            </div>

            {r.madeWhole ? (
              <div className="mt-3">
                <MakeWholeCell row={r} />
              </div>
            ) : null}

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted-fg">Piece-rate</dt>
                <dd className="tabular-nums text-ink">{usd(r.pieceRateUsd)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-fg">Hourly</dt>
                <dd className="tabular-nums text-ink">{usd(r.hourlyUsd)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-fg">Gross</dt>
                <dd className="tabular-nums font-medium text-ink">
                  {usd(r.grossUsd)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-fg">CSS</dt>
                <dd className="tabular-nums text-ink">{usd(r.cssUsd)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-fg">Seguro Educativo</dt>
                <dd className="tabular-nums text-ink">
                  {usd(r.seguroEducativoUsd)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-fg">Décimo</dt>
                <dd className="tabular-nums text-ink">
                  {usd(r.decimoAccrualUsd)}
                </dd>
              </div>
            </dl>
          </li>
        ))}

        {/* Totals footer card — same money columns as the desktop tfoot. */}
        <li className="rounded-2xl border border-white/60 bg-white/70 p-4">
          <p className="font-display text-sm font-semibold text-ink">Totals</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <div className="flex justify-between">
              <dt className="text-muted-fg">Make-whole</dt>
              <dd className="tabular-nums font-medium text-honey-700">
                {usd(totals.makeWhole)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-fg">Gross</dt>
              <dd className="tabular-nums font-medium text-ink">
                {usd(totals.gross)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-fg">CSS</dt>
              <dd className="tabular-nums text-ink">{usd(totals.css)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-fg">Seguro Educativo</dt>
              <dd className="tabular-nums text-ink">{usd(totals.seguro)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-fg">Décimo</dt>
              <dd className="tabular-nums text-ink">{usd(totals.decimo)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-fg">Net</dt>
              <dd className="tabular-nums font-semibold text-forest-700">
                {usd(totals.net)}
              </dd>
            </div>
          </dl>
        </li>
      </ul>
    </div>
  );
}
