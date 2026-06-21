import type { BatchStage } from "@/lib/types";
import { getBatches } from "@/lib/db/processing";
import { BatchRowActions } from "./batch-actions";
import { AdvanceStageControl } from "./advance-stage-control";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/data-table";
import { kg, pct, longDate } from "@/lib/utils";

/**
 * BatchTable — full ledger of every processing batch on the patios and beds.
 * Server component (static display, no hooks/handlers).
 *
 * Stage drives both the Badge tone and the ProgressBar fill so the pipeline
 * reads at a glance: cherry/fermentation (early, wet) → drying → parchment →
 * milled → green (finished). Tone/fill maps are explicit literal records —
 * Tailwind never sees an interpolated class name.
 */

const STAGE_TONE: Record<BatchStage, BadgeTone> = {
  cherry: "cherry",
  fermentation: "honey",
  drying: "sky",
  parchment: "coffee",
  milled: "neutral",
  green: "forest",
};

type ProgressTone = "forest" | "honey" | "cherry" | "coffee" | "sky";

const STAGE_FILL: Record<BatchStage, ProgressTone> = {
  cherry: "cherry",
  fermentation: "honey",
  drying: "sky",
  parchment: "coffee",
  milled: "coffee",
  green: "forest",
};

const STAGE_LABEL: Record<BatchStage, string> = {
  cherry: "Cherry",
  fermentation: "Fermentation",
  drying: "Drying",
  parchment: "Parchment",
  milled: "Milled",
  green: "Green",
};

export async function BatchTable({ lots }: { lots: string[] }) {
  const batches = await getBatches();

  return (
    <Card className="animate-rise overflow-hidden">
      <CardHeader>
        <div>
          <CardTitle>All batches</CardTitle>
          <CardDescription>
            Every lot in the mill, from cherry intake to green coffee
          </CardDescription>
        </div>
        <Badge tone="forest">{batches.length} active</Badge>
      </CardHeader>

      <CardContent className="pt-4">
        <Table className="border-separate border-spacing-0">
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Lot</TH>
              <TH>Variety</TH>
              <TH>Method</TH>
              <TH>Stage</TH>
              <TH>Patio</TH>
              <TH>Started</TH>
              <TH className="text-right">Input</TH>
              <TH className="text-right">Current</TH>
              <TH className="text-right">Moisture</TH>
              <TH className="min-w-[10rem]">Progress</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>

          <TBody>
            {batches.map((batch) => (
              <TR key={batch.id} className="group">
                <TD>
                  <span className="font-mono text-sm font-medium text-ink transition-colors group-hover:text-forest-700">
                    {batch.lotCode}
                  </span>
                </TD>

                <TD>
                  <Badge tone="neutral">{batch.variety}</Badge>
                </TD>

                <TD>
                  <Badge tone="coffee">{batch.method}</Badge>
                </TD>

                <TD>
                  <Badge tone={STAGE_TONE[batch.stage]} dot>
                    {STAGE_LABEL[batch.stage]}
                  </Badge>
                </TD>

                <TD className="text-muted-fg">{batch.patio}</TD>

                <TD className="whitespace-nowrap text-muted-fg">
                  {longDate(batch.startedDate)}
                </TD>

                <TD className="text-right tabular-nums text-muted-fg">
                  {kg(batch.cherriesKg)}
                </TD>

                <TD className="text-right tabular-nums font-medium text-ink">
                  {kg(batch.currentKg)}
                </TD>

                <TD className="text-right tabular-nums text-muted-fg">
                  {pct(batch.moisturePct)}
                </TD>

                <TD>
                  <div className="flex items-center gap-3">
                    <ProgressBar
                      value={batch.progressPct}
                      tone={STAGE_FILL[batch.stage]}
                      className="h-1.5 flex-1"
                    />
                    <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums text-muted-fg">
                      {pct(batch.progressPct)}
                    </span>
                  </div>
                </TD>

                <TD className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <AdvanceStageControl batch={batch} />
                    <BatchRowActions batch={batch} lots={lots} />
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  );
}
