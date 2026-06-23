import type { CoffeeVariety, Plot, PlotStatus } from "@/lib/types";
import { getPlots } from "@/lib/db/plots";
import { EntityLink } from "@/components/ui/entity-link";
import { PlotRowActions } from "./plot-actions";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import {
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui/data-table";
import { kg, num, pct } from "@/lib/utils";

/** Variety → on-brand Badge tone (explicit literal map; no string interpolation). */
const VARIETY_TONE: Record<CoffeeVariety, BadgeTone> = {
  Geisha: "honey",
  Caturra: "coffee",
  Catuaí: "forest",
  Pacamara: "cherry",
  Typica: "sky",
};

/** Status → Badge tone + label. */
const STATUS_TONE: Record<PlotStatus, BadgeTone> = {
  healthy: "ok",
  watch: "warn",
  "at-risk": "danger",
};

const STATUS_LABEL: Record<PlotStatus, string> = {
  healthy: "Healthy",
  watch: "Watch",
  "at-risk": "At risk",
};

/** Share of expected season yield harvested so far (0–100). */
function harvestedShare(plot: Plot): number {
  if (plot.expectedYieldKg <= 0) return 0;
  return (plot.harvestedKg / plot.expectedYieldKg) * 100;
}

/**
 * PlotsTable — full detail table of every growing lot on the farm.
 * Server component (static display, no hooks/handlers).
 */
export async function PlotsTable() {
  const plots = await getPlots();
  return (
    <Card className="animate-rise cv-auto overflow-hidden">
      <CardHeader>
        <CardTitle>All plots</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0 pt-4">
        <Table className="border-0 ring-0">
          <THead>
            <TR>
              <TH>Plot</TH>
              <TH>Variety</TH>
              <TH className="text-right">Altitude</TH>
              <TH className="text-right">Area</TH>
              <TH className="text-right">Trees</TH>
              <TH className="text-right">Shade</TH>
              <TH className="text-right">Established</TH>
              <TH>Status</TH>
              <TH className="text-right">Harvested</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {plots.map((plot) => {
              const share = harvestedShare(plot);
              return (
                <TR key={plot.id}>
                  <TD>
                    <EntityLink
                      kind="plot"
                      id={plot.id}
                      name={plot.id}
                      className="group/plot inline-flex flex-col rounded-md outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
                    >
                      <span className="font-medium text-ink transition-colors group-hover/plot:text-forest">
                        {plot.name}
                      </span>
                      <span className="text-xs text-muted-fg">{plot.block}</span>
                    </EntityLink>
                  </TD>
                  <TD>
                    <Badge tone={VARIETY_TONE[plot.variety]}>
                      {plot.variety}
                    </Badge>
                  </TD>
                  <TD className="text-right tabular-nums">
                    {num(plot.altitudeMasl)}
                    <span className="text-muted-fg"> masl</span>
                  </TD>
                  <TD className="text-right tabular-nums">
                    {num(plot.areaHa, 1)}
                    <span className="text-muted-fg"> ha</span>
                  </TD>
                  <TD className="text-right tabular-nums">{num(plot.trees)}</TD>
                  <TD className="text-right tabular-nums">
                    {pct(plot.shadePct)}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {plot.establishedYear}
                  </TD>
                  <TD>
                    <Badge tone={STATUS_TONE[plot.status]} dot>
                      {STATUS_LABEL[plot.status]}
                    </Badge>
                  </TD>
                  <TD className="text-right tabular-nums">
                    <div className="font-medium text-ink">
                      {kg(plot.harvestedKg)}
                    </div>
                    <div className="text-xs text-muted-fg">
                      {pct(share)} of expected
                    </div>
                  </TD>
                  <TD className="text-right">
                    <PlotRowActions plot={plot} />
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  );
}
