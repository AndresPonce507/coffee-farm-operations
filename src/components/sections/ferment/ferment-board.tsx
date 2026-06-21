import Link from "next/link";
import { FlaskConical } from "lucide-react";

import type { FermentBatch, FermentRecipe } from "@/lib/db/ferment";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { longDate } from "@/lib/utils";
import { StartFermentButton } from "./start-ferment-button";

/**
 * FermentBoard — the /ferment overview (P2-S3). A glass grid of ferment batches, each
 * a card linking to its live tracker. A live (no ended_at) batch is the make-quality
 * loop in flight; a finished one carries its full curve as evidence. The header offers
 * the Start-ferment affordance (the one client island here). Server Component — it is
 * handed the data by the route; the only client JS is the start dialog.
 */
export function FermentBoard({
  batches,
  lots,
  recipes,
}: {
  batches: FermentBatch[];
  lots: string[];
  recipes: FermentRecipe[];
}) {
  if (batches.length === 0) {
    return (
      <Card className="animate-rise">
        <CardContent className="py-4">
          <EmptyState
            icon={FlaskConical}
            title="Nothing fermenting yet"
            description="Start a ferment on a milled-in lot to open the make-quality loop — live pH/temp/Brix curves and a cut-point alert before the window closes."
          />
          <div className="mt-4 flex justify-center">
            <StartFermentButton lots={lots} recipes={recipes} />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <StartFermentButton lots={lots} recipes={recipes} />
      </div>

      <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {batches.map((b) => {
          const live = b.endedAt === null;
          return (
            <Link
              key={b.id}
              href={`/ferment/${b.id}`}
              data-testid={`ferment-batch-${b.id}`}
              className="block rounded-2xl outline-none ring-forest/30 transition focus-visible:ring-2"
            >
              <Card className="h-full transition-transform hover:-translate-y-0.5">
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-semibold text-ink">
                      {b.lotCode}
                    </span>
                    {live ? (
                      <Badge tone="forest" dot>
                        Live
                      </Badge>
                    ) : (
                      <Badge tone="neutral" dot>
                        Finished
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-fg">
                    {b.method}
                    {b.recipeId ? " · recipe applied" : " · no recipe"}
                  </p>
                  <p className="text-[11px] text-muted-fg/70">
                    Started {longDate(b.startedAt)}
                  </p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
