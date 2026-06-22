import { HeartHandshake } from "lucide-react";

import { DossierSection } from "@/components/dossier/dossier-section";
import { EntityLink } from "@/components/ui/entity-link";
import { THead, TBody, TR, TH, TD } from "@/components/ui/data-table";
import type { PayPeriodPayLine } from "@/lib/db/dossier/pay-period";
import { cn } from "@/lib/utils";

import { usd } from "./labels";

/**
 * PayPeriodLinesSection — the per-worker pay lines for this period (#lines).
 *
 * THE connectivity spine of the pay-period dossier: every line names a WORKER
 * (→ /workers/[id] dossier) and their CREW (→ /crew/[id] dossier), so a glance
 * at who earned what is one tap from each person's full record. The crew link
 * is resolved from the live roster (the pay row only carries a crew NAME); when
 * a worker has left the roster (crewId null) the crew shows as plain text — no
 * fabricated link to a crew that no longer exists.
 *
 * The make-whole pill marks the lines the legal-floor guard lifted. Money is
 * USD-with-cents, tabular-nums. Responsive: a dense table on lg+, stacked
 * record-cards below (same rows, no horizontal scroll). Pure presentation.
 */
export interface PayPeriodLinesSectionProps {
  lines: PayPeriodPayLine[];
}

/** The worker name → /workers/[id] dossier link (the connectivity primitive). */
function WorkerName({ line }: { line: PayPeriodPayLine }) {
  return (
    <EntityLink
      kind="worker"
      id={line.workerId}
      className="font-medium text-ink underline-offset-2 outline-none transition-colors hover:text-forest hover:underline focus-visible:text-forest focus-visible:underline"
    >
      {line.workerName}
    </EntityLink>
  );
}

/** The crew → /crew/[id] dossier link, or plain text when off-roster. */
function CrewName({ line }: { line: PayPeriodPayLine }) {
  if (!line.crewId) {
    return <span className="text-xs text-muted-fg">{line.crewName}</span>;
  }
  return (
    <EntityLink
      kind="crew"
      id={line.crewId}
      className="text-xs text-muted-fg underline-offset-2 outline-none transition-colors hover:text-forest hover:underline focus-visible:text-forest focus-visible:underline"
    >
      {line.crewName}
    </EntityLink>
  );
}

export function PayPeriodLinesSection({ lines }: PayPeriodLinesSectionProps) {
  return (
    <DossierSection
      id="lines"
      title="Líneas de pago por trabajador"
      count={lines.length}
      empty={lines.length === 0}
      emptyLabel="Sin líneas calculadas todavía"
    >
      {/* ── Dense desktop table (lg+). ── */}
      <div className="hidden overflow-hidden rounded-2xl glass-card lg:block">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Trabajador</TH>
              <TH>Cuadrilla</TH>
              <TH className="text-right">Por obra</TH>
              <TH className="text-right">Por hora</TH>
              <TH className="text-right">Ajuste</TH>
              <TH className="text-right">Bruto</TH>
              <TH className="text-right">Neto</TH>
            </TR>
          </THead>
          <TBody>
            {lines.map((line) => (
              <TR
                key={line.id}
                data-made-whole={line.madeWhole ? "true" : "false"}
                className={cn(
                  "align-middle",
                  line.madeWhole &&
                    "bg-honey-100/30 [&>td:first-child]:border-l-2 [&>td:first-child]:border-honey",
                )}
              >
                <TD>
                  <WorkerName line={line} />
                </TD>
                <TD>
                  <CrewName line={line} />
                </TD>
                <TD className="text-right tabular-nums text-muted-fg">
                  {usd(line.pieceRateUsd)}
                </TD>
                <TD className="text-right tabular-nums text-muted-fg">
                  {usd(line.hourlyUsd)}
                </TD>
                <TD className="text-right">
                  {line.madeWhole ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-honey-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-honey-700 ring-1 ring-honey/30">
                      <HeartHandshake className="h-3 w-3 shrink-0" aria-hidden="true" />
                      {usd(line.makeWholeUsd)}
                    </span>
                  ) : (
                    <span className="text-muted-fg/60">—</span>
                  )}
                </TD>
                <TD className="text-right tabular-nums font-medium text-ink">
                  {usd(line.grossUsd)}
                </TD>
                <TD className="text-right tabular-nums font-semibold text-forest-700">
                  {usd(line.netUsd)}
                </TD>
              </TR>
            ))}
          </TBody>
        </table>
      </div>

      {/* ── Record-card list (below lg). Same rows, stacked. ── */}
      <ul className="stagger space-y-3 lg:hidden">
        {lines.map((line) => (
          <li
            key={line.id}
            data-made-whole={line.madeWhole ? "true" : "false"}
            className={cn(
              "rounded-2xl border border-white/60 bg-white/55 p-4 shadow-[0_8px_24px_-16px_rgba(0,41,29,0.35)]",
              line.madeWhole && "border-l-2 border-l-honey bg-honey-100/30",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p>
                  <WorkerName line={line} />
                </p>
                <p className="mt-0.5">
                  <CrewName line={line} />
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] uppercase tracking-wide text-muted-fg">
                  Neto
                </p>
                <p className="font-display text-base font-semibold tabular-nums text-forest-700">
                  {usd(line.netUsd)}
                </p>
              </div>
            </div>

            {line.madeWhole ? (
              <div className="mt-3">
                <span className="inline-flex items-center gap-1 rounded-full bg-honey-100 px-2.5 py-1 text-xs font-semibold tabular-nums text-honey-700 ring-1 ring-honey/30">
                  <HeartHandshake className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {usd(line.makeWholeUsd)} · ajuste al mínimo legal
                </span>
              </div>
            ) : null}

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted-fg">Por obra</dt>
                <dd className="tabular-nums text-ink">{usd(line.pieceRateUsd)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-fg">Por hora</dt>
                <dd className="tabular-nums text-ink">{usd(line.hourlyUsd)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-fg">Bruto</dt>
                <dd className="tabular-nums font-medium text-ink">
                  {usd(line.grossUsd)}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </DossierSection>
  );
}
