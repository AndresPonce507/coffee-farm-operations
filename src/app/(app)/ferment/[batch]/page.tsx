import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { FermentTracker } from "@/components/sections/ferment/ferment-tracker";
import {
  getFermentBatches,
  getFermentCurve,
  getFermentCutpoint,
  getWaterPerKg,
} from "@/lib/db/ferment";

/**
 * /ferment/[batch] — the per-batch make-quality cockpit (P2-S3). Opens one ferment
 * batch and SEES its live evidence: the pH/temp/Brix curves against the recipe target
 * band, the cut-point alert (the closed-loop "cut now" signal), and the eco-mill
 * water-per-kg number — with the big log-reading control that grows the curve.
 *
 * Server Component. It resolves the batch from the batch list (the id is a uuid the
 * board links with), then awaits the curve / cut-point / water reads in parallel and
 * renders the <FermentTracker>. An unknown/injected batch id resolves to no batch → 404
 * rather than render a fabricated tracker. The only client JS is the log-reading island.
 */
export default async function FermentBatchPage({
  params,
}: {
  params: Promise<{ batch: string }>;
}) {
  const { batch: batchId } = await params;

  const batches = await getFermentBatches();
  const batch = batches.find((b) => b.id === batchId);
  if (!batch) {
    notFound();
  }

  const [curve, cutpoint, water] = await Promise.all([
    getFermentCurve(batch.id),
    getFermentCutpoint(batch.id),
    getWaterPerKg(batch.lotCode),
  ]);

  return (
    <div className="space-y-6">
      <Link
        href="/ferment"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-fg transition hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All ferments
      </Link>

      <FermentTracker
        batch={batch}
        curve={curve}
        cutpoint={cutpoint}
        water={water}
      />
    </div>
  );
}
