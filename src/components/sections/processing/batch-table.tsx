import type { BatchStage } from "@/lib/types";
import { getBatches } from "@/lib/db/processing";
import { getLotStages } from "@/lib/db/processing-lots";
import { getFermentBatches } from "@/lib/db/ferment";
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
import { EntityLink } from "@/components/ui/entity-link";

/**
 * BatchTable — full ledger of every processing batch on the patios and beds.
 * Server component (static display, no hooks/handlers).
 *
 * Stage drives both the Badge tone and the ProgressBar fill so the pipeline
 * reads at a glance: cherry/fermentation (early, wet) → drying → parchment →
 * milled → green (finished). Tone/fill maps are explicit literal records —
 * Tailwind never sees an interpolated class name.
 *
 * COHERENCE (pipeline-UI review fix): the advance write moves `lots.stage`, NOT
 * `processing_batches.stage`. So the Advance affordance is keyed off the LOT, not
 * the batch row — exactly ONE per `lot_code`, with its "from" stage read from
 * `getLotStages` (`lots.stage`). This kills the old defect where a lot_code with
 * several batch rows rendered several Advance buttons all mutating one shared
 * lot, and where the displayed stage drifted from what the advance actually
 * moves. After a successful advance, `revalidatePath('/processing')` re-reads
 * `getLotStages`, so the board reflects the new LOT stage on the next paint.
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
  const [batches, lotStages, fermentBatches] = await Promise.all([
    getBatches(),
    getLotStages(),
    getFermentBatches(),
  ]);

  // Build a map from lot_code → ferment_batches.id (uuid PK) so each processing
  // batch row can link to its corresponding /ferment/[id] dossier using the
  // ferment_batches table's uuid — not the processing_batches slug, which would
  // always 404 since the route resolves against ferment_batches.
  const fermentIdByLot = new Map(fermentBatches.map((fb) => [fb.lotCode, fb.id]));

  // The advance affordance is one-per-lot, keyed off the LOT's stage. Track which
  // lot_codes have already shown their control so a lot with several batch rows
  // surfaces exactly one Advance button (on its first row), mutating one lot.
  const lotControlShown = new Set<string>();

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
            {batches.length === 0 && (
              <TR className="hover:bg-transparent">
                <TD colSpan={11} className="px-4 py-10 text-center">
                  <span className="inline-block rounded-xl border border-dashed border-line bg-white/40 px-4 py-3 text-sm text-muted-fg">
                    No batches in process.
                  </span>
                </TD>
              </TR>
            )}
            {batches.map((batch) => {
              // The LOT's authoritative stage (lots.stage); fall back to the
              // batch's own stage only if the lot isn't in the map (defensive).
              const lotStage = lotStages.get(batch.lotCode) ?? batch.stage;
              // Show the advance control once per lot_code — on its first row.
              const showAdvance = !lotControlShown.has(batch.lotCode);
              if (showAdvance) lotControlShown.add(batch.lotCode);

              // The /ferment/[batch] route resolves the param against
              // ferment_batches.id (uuid PKs). Processing batch ids are slugs
              // from a different table — using them would always 404. Look up
              // the ferment_batch for this lot_code and use its uuid instead.
              const fermentId = fermentIdByLot.get(batch.lotCode);

              return (
              <TR key={batch.id} className="group">
                <TD>
                  <div className="flex items-center gap-1.5">
                    <EntityLink
                      kind="lot"
                      id={batch.lotCode}
                      className="font-mono text-sm font-medium text-ink underline-offset-2 transition-colors hover:text-forest-700 hover:underline focus-visible:text-forest-700 focus-visible:underline outline-none"
                    >
                      {batch.lotCode}
                    </EntityLink>
                    {fermentId && (
                      <EntityLink
                        kind="batch"
                        id={fermentId}
                        name={String(fermentId)}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-muted-fg transition-colors hover:text-forest-700 focus-visible:ring-2 focus-visible:ring-forest/60 outline-none"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 opacity-50 group-hover:opacity-80">
                          <path d="M6.22 8.72a.75.75 0 0 0 1.06 1.06l5.22-5.22v1.69a.75.75 0 0 0 1.5 0v-3.5a.75.75 0 0 0-.75-.75h-3.5a.75.75 0 0 0 0 1.5h1.69L6.22 8.72Z" />
                          <path d="M3.5 6.75c0-.69.56-1.25 1.25-1.25H7A.75.75 0 0 0 7 4H4.75A2.75 2.75 0 0 0 2 6.75v4.5A2.75 2.75 0 0 0 4.75 14h4.5A2.75 2.75 0 0 0 12 11.25V9a.75.75 0 0 0-1.5 0v2.25c0 .69-.56 1.25-1.25 1.25h-4.5c-.69 0-1.25-.56-1.25-1.25v-4.5Z" />
                        </svg>
                      </EntityLink>
                    )}
                  </div>
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
                    {showAdvance && (
                      <AdvanceStageControl
                        lotCode={batch.lotCode}
                        currentStage={lotStage}
                        currentKg={batch.currentKg}
                      />
                    )}
                    <BatchRowActions batch={batch} lots={lots} />
                  </div>
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
