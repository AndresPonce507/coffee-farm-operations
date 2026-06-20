import type { Plot, Worker } from "@/lib/types";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/data-table";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { getHarvests } from "@/lib/db/harvests";
import { kg, num, longDate, shortDate } from "@/lib/utils";
import { HarvestRowActions } from "./harvest-actions";

/** How many of the most-recent picking records to surface in the log. */
const ROW_LIMIT = 16;

/**
 * Map a ripeness percentage to a Badge tone.
 * >= 95 reads as picking at peak (ok); 88–94 is acceptable (warn); below that
 * the lot skewed under/overripe and gets a neutral tone so it doesn't alarm.
 */
function ripenessTone(pct: number): BadgeTone {
  if (pct >= 95) return "ok";
  if (pct >= 88) return "warn";
  return "neutral";
}

/**
 * HarvestLogTable — the traceability ledger for the current picking window.
 *
 * Server component (no hooks/handlers). Renders the most recent {@link ROW_LIMIT}
 * harvest records sorted by date descending, each row carrying its lot code,
 * source plot, picker, weight, ripeness quality, and average Brix.
 */
export async function HarvestLogTable({
  plots,
  pickers,
  lots,
}: {
  plots: Plot[];
  pickers: Worker[];
  lots: string[];
}) {
  const harvests = await getHarvests();
  const rows = [...harvests]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, ROW_LIMIT);

  return (
    <Card className="animate-rise overflow-hidden">
      <CardHeader>
        <div>
          <CardTitle>Harvest log</CardTitle>
          <CardDescription>
            Most recent {rows.length} picking records, newest first
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="px-0 pb-0 pt-4">
        <Table className="border-0 ring-0">
          <THead className="bg-white/70">
            <TR>
              <TH>Date</TH>
              <TH>Lot</TH>
              <TH>Plot</TH>
              <TH>Picker</TH>
              <TH className="text-right">Cherries</TH>
              <TH>Ripeness</TH>
              <TH className="text-right">Brix</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((h) => (
              <TR key={h.id}>
                <TD className="whitespace-nowrap text-muted-fg">
                  <span title={longDate(h.date)}>{shortDate(h.date)}</span>
                </TD>
                <TD>
                  <span className="font-mono text-xs text-coffee">
                    {h.lotCode}
                  </span>
                </TD>
                <TD className="whitespace-nowrap font-medium text-ink">
                  {h.plotName}
                </TD>
                <TD className="whitespace-nowrap text-muted-fg">{h.picker}</TD>
                <TD className="whitespace-nowrap text-right font-medium tabular-nums text-ink">
                  {kg(h.cherriesKg)}
                </TD>
                <TD>
                  <Badge tone={ripenessTone(h.ripenessPct)} dot>
                    {num(h.ripenessPct)}%
                  </Badge>
                </TD>
                <TD className="whitespace-nowrap text-right tabular-nums text-ink">
                  {h.brixAvg.toFixed(1)}
                </TD>
                <TD className="text-right">
                  <HarvestRowActions
                    harvest={h}
                    plots={plots}
                    pickers={pickers}
                    lots={lots}
                  />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  );
}
