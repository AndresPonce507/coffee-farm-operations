import Link from "next/link";
import { CheckCircle2, Coffee, PackageOpen, ShieldAlert } from "lucide-react";

import type { QcStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { THead, TBody, TR, TH, TD } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { EntityLink } from "@/components/ui/entity-link";
import { num } from "@/lib/utils";
import { QcHoldControl } from "./qc-hold-control";

/**
 * QcStatusTable — the QC dashboard for /qc (P2-S6). Each green lot's QC posture in
 * one dense glass row: its held/clear state, the latest cup final score, the
 * primary/secondary defect tallies, a link into its cupping form, and the
 * place/release-hold control. A held lot is the loud, un-missable state — the cup
 * protection made visible.
 *
 * Server Component (the hold control is the one client island). Responsive: a dense
 * desktop table (md+) and a stacked record-card list (below md) render the SAME
 * rows — no horizontal scroll (D24). AA-on-glass; the only animation is the card
 * rise (reduced-motion safe in globals.css).
 */

function scoreLabel(score: number | null): string {
  return score == null ? "—" : num(score, 1);
}

function HeldBadge({ held }: { held: boolean }) {
  return held ? (
    <Badge tone="cherry" dot>
      On hold
    </Badge>
  ) : (
    <Badge tone="ok" dot>
      Clear
    </Badge>
  );
}

export function QcStatusTable({ rows }: { rows: QcStatus[] }) {
  const heldCount = rows.filter((r) => r.held).length;

  return (
    <Card className="animate-rise overflow-hidden">
      <CardHeader>
        <div>
          <CardTitle>Quality control</CardTitle>
          <CardDescription>
            Cup scores, green-grading defects, and the QC-HOLD quarantine — a held
            lot is physically un-sellable until released
          </CardDescription>
        </div>
        {heldCount > 0 ? (
          <Badge tone="cherry" dot>
            {heldCount} on hold
          </Badge>
        ) : (
          <Badge tone="forest" dot>
            all clear
          </Badge>
        )}
      </CardHeader>

      <CardContent className="pt-4">
        {rows.length === 0 ? (
          <EmptyState
            icon={PackageOpen}
            title="No green lots to QC yet"
            description="Grade a finished lot in Inventory to mint a green lot you can cup, grade for defects, and hold."
          />
        ) : (
          <>
            {/* ── Dense desktop table (md+). Collapses to record-cards below md. ── */}
            <div data-testid="qc-table-desktop" className="hidden md:block">
              <table className="w-full border-separate border-spacing-0 text-sm">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Lot</TH>
                    <TH>QC state</TH>
                    <TH className="text-right">Latest cup</TH>
                    <TH className="text-right">Primary</TH>
                    <TH className="text-right">Secondary</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((row) => (
                    <TR key={row.greenLotCode} className="group align-middle">
                      <TD>
                        <EntityLink
                          kind="lot"
                          id={row.greenLotCode}
                          className="font-mono text-sm font-medium text-ink underline-offset-4 transition-colors hover:text-forest-700 hover:underline group-hover:text-forest-700"
                        >
                          {row.greenLotCode}
                        </EntityLink>
                      </TD>
                      <TD>
                        <div className="flex flex-col gap-0.5">
                          <HeldBadge held={row.held} />
                          {row.held && row.holdReason && (
                            <span className="max-w-[16rem] truncate text-xs text-cherry/80">
                              {row.holdReason}
                            </span>
                          )}
                        </div>
                      </TD>
                      <TD className="text-right tabular-nums font-medium text-ink">
                        {scoreLabel(row.latestCupScore)}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {row.primaryDefects > 0 ? (
                          <span className="text-cherry">{row.primaryDefects}</span>
                        ) : (
                          <span className="text-muted-fg">0</span>
                        )}
                      </TD>
                      <TD className="text-right tabular-nums text-muted-fg">
                        {row.secondaryDefects}
                      </TD>
                      <TD className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/qc/cup/${encodeURIComponent(row.greenLotCode)}`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white/60 px-2.5 py-1.5 text-xs font-medium text-ink transition hover:border-forest-300 hover:text-forest-700"
                            aria-label={`Cup ${row.greenLotCode}`}
                          >
                            <Coffee className="h-3.5 w-3.5" />
                            Cup
                          </Link>
                          <QcHoldControl lot={row} />
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </table>
            </div>

            {/* ── Record-card list (below md). Same rows, stacked, glove-friendly. ── */}
            <ul data-testid="qc-cards-mobile" className="space-y-3 md:hidden">
              {rows.map((row) => (
                <li
                  key={row.greenLotCode}
                  className="rounded-2xl border border-white/60 bg-white/55 p-4 shadow-[0_8px_24px_-16px_rgba(0,41,29,0.35)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <EntityLink
                      kind="lot"
                      id={row.greenLotCode}
                      className="font-mono text-sm font-medium text-ink underline-offset-4 hover:text-forest-700 hover:underline"
                    >
                      {row.greenLotCode}
                    </EntityLink>
                    <HeldBadge held={row.held} />
                  </div>
                  {row.held && row.holdReason && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-cherry">
                      <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                      {row.holdReason}
                    </p>
                  )}
                  <div className="mt-3 flex items-center justify-between text-xs text-muted-fg">
                    <span>
                      Cup{" "}
                      <span className="font-medium tabular-nums text-ink">
                        {scoreLabel(row.latestCupScore)}
                      </span>
                    </span>
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5 text-forest-600" />
                      {row.primaryDefects}p · {row.secondaryDefects}s
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-end gap-2">
                    <Link
                      href={`/qc/cup/${encodeURIComponent(row.greenLotCode)}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white/60 px-3 py-2 text-xs font-medium text-ink transition hover:border-forest-300 hover:text-forest-700"
                    >
                      <Coffee className="h-3.5 w-3.5" />
                      Cup
                    </Link>
                    <QcHoldControl lot={row} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
