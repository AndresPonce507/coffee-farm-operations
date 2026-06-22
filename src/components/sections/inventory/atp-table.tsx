import { PackageOpen } from "lucide-react";

import type { GreenLotAtp, ScaGrade } from "@/lib/types";
import { AtpMeter } from "@/components/ui/atp-meter";
import { Badge, type BadgeTone } from "@/components/ui/badge";
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
import { ReservationDrawer } from "./reservation-drawer";
import { kg } from "@/lib/utils";

/**
 * AtpTable — the dense glass green-inventory table for /inventory (S5).
 *
 * Server Component (no hooks, no handlers): it renders the DERIVED available-to-
 * promise rows (`atp = current − Σreserved − Σshipped`, computed by the view) and
 * embeds the one client island per row — the <ReservationDrawer>.
 *
 * Responsive contract (D24): a *dense desktop table* (`md:block`, hidden below md)
 * and a *record-card list* (`md:hidden`) render the SAME data — the table
 * collapses into stacked cards on phones, it never horizontally scrolls. Two views
 * of one dataset, not an overflow scroller.
 *
 * Each row carries a per-lot dual-bar ATP meter (committed vs available) so the
 * "how much can I still sell?" signal reads at a glance, and a Reserve trigger
 * that is DISABLED when ATP is zero — the UI cannot even attempt a double-sell
 * (the `prevent_oversell` DB trigger is the real, fail-closed guard).
 */

const GRADE_TONE: Record<ScaGrade, BadgeTone> = {
  Presidential: "forest",
  Specialty: "honey",
  Premium: "coffee",
  "Below Specialty": "neutral",
};

function gradeTone(grade: ScaGrade | string): BadgeTone {
  return (GRADE_TONE as Record<string, BadgeTone>)[grade] ?? "neutral";
}

function committedOf(row: GreenLotAtp): number {
  return row.reservedKg + row.shippedKg;
}

export function AtpTable({ rows }: { rows: GreenLotAtp[] }) {
  const sellable = rows.filter((r) => r.atp > 0).length;

  return (
    <Card className="animate-rise overflow-hidden">
      <CardHeader>
        <div>
          <CardTitle>Green inventory</CardTitle>
          <CardDescription>
            Graded, located lots — available-to-promise is derived live from the
            reservation &amp; shipment ledgers
          </CardDescription>
        </div>
        <Badge tone="forest">{sellable} sellable</Badge>
      </CardHeader>

      <CardContent className="pt-4">
        {rows.length === 0 ? (
          <EmptyState
            icon={PackageOpen}
            title="No green inventory yet"
            description="Grade a finished lot in Processing to mint a located, available-to-promise green lot you can reserve against."
          />
        ) : (
          <>
            {/* ── Dense desktop table (md and up). No overflow-x scroller — it
                collapses to record-cards below md instead (D24). ── */}
            <div data-testid="atp-table-desktop" className="hidden md:block">
              <table className="w-full border-separate border-spacing-0 text-sm">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Lot</TH>
                    <TH>Grade</TH>
                    <TH>Location</TH>
                    <TH className="text-right">On hand</TH>
                    <TH className="min-w-[14rem]">Available to promise</TH>
                    <TH className="text-right">Reserve</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((row) => (
                    <TR key={row.greenLotCode} className="group align-top">
                      <TD>
                        <EntityLink
                          kind="lot"
                          id={row.greenLotCode}
                          className="font-mono text-sm font-medium text-ink underline-offset-4 transition-colors hover:text-forest-700 hover:underline focus-visible:text-forest-700 focus-visible:underline focus-visible:outline-none group-hover:text-forest-700"
                        >
                          {row.greenLotCode}
                        </EntityLink>
                      </TD>
                      <TD>
                        <Badge tone={gradeTone(row.scaGrade)} dot>
                          {row.scaGrade}
                        </Badge>
                      </TD>
                      <TD className="text-muted-fg">{row.location}</TD>
                      <TD className="text-right tabular-nums font-medium text-ink">
                        {kg(row.currentKg)}
                      </TD>
                      <TD>
                        <AtpMeter
                          committedKg={committedOf(row)}
                          availableKg={row.atp}
                        />
                      </TD>
                      <TD className="text-right">
                        <ReservationDrawer lot={row} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </table>
            </div>

            {/* ── Record-card list (below md). Same rows, stacked — glove-friendly
                touch targets, no hover dependence (AD-6). ── */}
            <ul
              data-testid="atp-cards-mobile"
              className="space-y-3 md:hidden"
            >
              {rows.map((row) => (
                <li
                  key={row.greenLotCode}
                  className="rounded-2xl border border-white/60 bg-white/55 p-4 shadow-[0_8px_24px_-16px_rgba(0,41,29,0.35)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <EntityLink
                        kind="lot"
                        id={row.greenLotCode}
                        className="font-mono text-sm font-medium text-ink underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
                      >
                        {row.greenLotCode}
                      </EntityLink>
                      <p className="mt-0.5 text-xs text-muted-fg">
                        {row.location}
                      </p>
                    </div>
                    <Badge tone={gradeTone(row.scaGrade)} dot>
                      {row.scaGrade}
                    </Badge>
                  </div>

                  <div className="mt-3">
                    <AtpMeter
                      committedKg={committedOf(row)}
                      availableKg={row.atp}
                    />
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-muted-fg">
                      <span className="font-medium text-ink tabular-nums">
                        {kg(row.currentKg)}
                      </span>{" "}
                      on hand
                    </span>
                    <ReservationDrawer lot={row} />
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
