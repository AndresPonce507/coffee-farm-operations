import { ArrowDownToLine, Sparkles } from "lucide-react";

import { Card } from "@/components/ui/card";
import { EntityLink } from "@/components/ui/entity-link";
import type { Payslip } from "@/lib/db/payroll";
import { payslipQrSvg } from "@/lib/payroll/qr";
import { cn, longDate } from "@/lib/utils";

import { PAYSLIP_TERMS, bilingual, speaksNgabere } from "./labels";

/** USD with 2-decimal precision, for the payslip's per-line figures. */
function usd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export interface QrPayslipProps {
  /** The frozen, identity-joined payslip payload (one worker, one period). */
  payslip: Payslip;
  /**
   * Deep link the QR encodes. Defaults to the canonical
   * `janson://payslip/<payPeriodId>/<workerId>` scheme.
   */
  deepLink?: string;
}

/** One line in the breakdown — bilingual label + a right-aligned money figure. */
function LineItem({
  label,
  value,
  testId,
  tone = "neutral",
  highlight = false,
}: {
  label: string;
  value: string;
  testId?: string;
  tone?: "neutral" | "deduction" | "make-whole";
  highlight?: boolean;
}) {
  return (
    <div
      data-testid={testId}
      data-highlight={highlight ? "true" : undefined}
      className={cn(
        "flex items-baseline justify-between gap-3 py-1.5",
        tone === "make-whole" &&
          "-mx-2 rounded-lg bg-honey-100 px-2 ring-1 ring-honey/25",
      )}
    >
      <span
        className={cn(
          "min-w-0 text-sm",
          tone === "make-whole"
            ? "flex items-center gap-1.5 font-medium text-honey-700"
            : "text-muted-fg",
        )}
      >
        {tone === "make-whole" ? (
          <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        ) : null}
        <span className="truncate">{label}</span>
      </span>
      <span
        className={cn(
          "shrink-0 text-sm font-semibold tabular-nums",
          tone === "deduction" && "text-cherry",
          tone === "make-whole" && "text-honey-700",
          tone === "neutral" && "text-ink",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * QrPayslip — the worker-facing bilingual payslip card.
 *
 * A glass card a worker can read in their own language and verify by scanning:
 * identity header (preferred name + legal name, the period window + season),
 * a blended breakdown (piece-rate + hourly → gross → statutory deductions →
 * a prominent NET take-home), the make-whole top-up surfaced + honey-highlighted
 * only when the legal-minimum guard actually lifted them, and a QR that deep-links
 * to the full detail. Print-friendly (clean glass, no PDF lib — it's a $0 in-app
 * payslip). Pure presentation: the server wrapper resolves getPayslip() upstream.
 */
export function QrPayslip({ payslip, deepLink }: QrPayslipProps) {
  const showNg = speaksNgabere(payslip.languages);
  const madeWhole = payslip.makeWholeUsd > 0;
  const headline = payslip.preferredName?.trim() || payslip.workerName;
  const hasDistinctLegalName =
    payslip.preferredName?.trim() &&
    payslip.preferredName.trim() !== payslip.workerName;

  const link =
    deepLink ?? `janson://payslip/${payslip.payPeriodId}/${payslip.workerId}`;

  return (
    <Card
      data-testid="qr-payslip"
      className={cn(
        "animate-rise overflow-hidden print:animate-none print:shadow-none print:ring-1 print:ring-line",
      )}
    >
      {/* ── Identity + period header ──────────────────────────────────── */}
      <header className="flex items-start justify-between gap-4 border-b border-line/70 px-5 pt-5 pb-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-fg">
            {bilingual(PAYSLIP_TERMS.payslip, showNg)}
          </p>
          <h2 className="mt-1 truncate font-display text-lg font-semibold text-ink">
            <EntityLink kind="worker" id={payslip.workerId}>
              {headline}
            </EntityLink>
          </h2>
          {hasDistinctLegalName ? (
            <p className="truncate text-xs text-muted-fg">
              {payslip.workerName}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-muted-fg">
            {longDate(payslip.periodStart)} – {longDate(payslip.periodEnd)}
            {payslip.season ? (
              <span className="text-muted-fg/80"> · {payslip.season}</span>
            ) : null}
          </p>
        </div>
      </header>

      <div className="grid gap-5 px-5 py-5 sm:grid-cols-[1fr_auto] sm:gap-6">
        {/* ── Breakdown ───────────────────────────────────────────────── */}
        <div className="min-w-0">
          <div className="divide-y divide-line/50">
            <LineItem
              label={bilingual(PAYSLIP_TERMS.pieceRate, showNg)}
              value={usd(payslip.pieceRateUsd)}
            />
            <LineItem
              label={bilingual(PAYSLIP_TERMS.hourly, showNg)}
              value={usd(payslip.hourlyUsd)}
            />
            {madeWhole ? (
              <LineItem
                testId="payslip-make-whole"
                tone="make-whole"
                highlight
                label={bilingual(PAYSLIP_TERMS.makeWhole, showNg)}
                value={usd(payslip.makeWholeUsd)}
              />
            ) : null}
          </div>

          {/* gross */}
          <div className="mt-1 border-t border-line pt-1">
            <LineItem
              testId="payslip-gross"
              label={bilingual(PAYSLIP_TERMS.gross, showNg)}
              value={usd(payslip.grossUsd)}
            />
          </div>

          {/* deductions */}
          <p className="mt-3 mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-fg">
            {bilingual(PAYSLIP_TERMS.deductions, showNg)}
          </p>
          <div className="divide-y divide-line/50">
            <LineItem
              tone="deduction"
              label={bilingual(PAYSLIP_TERMS.css, showNg)}
              value={`-${usd(payslip.cssUsd)}`}
            />
            <LineItem
              tone="deduction"
              label={bilingual(PAYSLIP_TERMS.seguroEducativo, showNg)}
              value={`-${usd(payslip.seguroEducativoUsd)}`}
            />
            <LineItem
              tone="deduction"
              label={bilingual(PAYSLIP_TERMS.decimo, showNg)}
              value={`-${usd(payslip.decimoAccrualUsd)}`}
            />
          </div>

          {/* ── Prominent NET take-home ───────────────────────────────── */}
          <div
            data-testid="payslip-net"
            className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-forest-100 px-4 py-3 ring-1 ring-forest/15"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-forest">
              <ArrowDownToLine className="h-4 w-4" aria-hidden="true" />
              {bilingual(PAYSLIP_TERMS.takeHome, showNg)}
            </span>
            <span className="font-display text-xl font-bold tabular-nums text-forest">
              {usd(payslip.netUsd)}
            </span>
          </div>
        </div>

        {/* ── QR block ────────────────────────────────────────────────── */}
        <div className="flex shrink-0 flex-col items-center justify-start gap-2 sm:w-[136px]">
          <div
            data-testid="payslip-qr"
            data-deep-link={link}
            aria-label="Payslip QR code"
            className="grid aspect-square w-32 place-items-center overflow-hidden rounded-xl bg-card p-2 ring-1 ring-line"
            // A real, scannable, $0 QR encoding the deep-link — rendered from the
            // dependency-free encoder in src/lib/payroll/qr.ts as inline SVG.
            dangerouslySetInnerHTML={{
              __html: payslipQrSvg(link, { cssColor: "#0f2a1d" }),
            }}
          />
          <p className="max-w-[136px] text-center text-[11px] leading-tight text-muted-fg">
            {bilingual(PAYSLIP_TERMS.scanForDetails, showNg)}
          </p>
        </div>
      </div>
    </Card>
  );
}
