import { FlaskConical } from "lucide-react";
import { useTranslations } from "next-intl";

import type { FermentBatch, FermentRecipe } from "@/lib/db/ferment";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { EntityLink } from "@/components/ui/entity-link";
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
  const t = useTranslations("ferment");
  if (batches.length === 0) {
    return (
      <Card className="animate-rise">
        <CardContent className="py-4">
          <EmptyState
            icon={FlaskConical}
            title={t("board.emptyTitle")}
            description={t("board.emptyDescription")}
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
            <Card
              key={b.id}
              data-testid={`ferment-card-${b.id}`}
              className="h-full transition-transform hover:-translate-y-0.5"
            >
              <CardContent className="space-y-3">
                {/*
                  The lot code NAMES a Lot entity → it is its own dossier link
                  (D2 — no entity-bearing row goes nowhere). It sits OUTSIDE the
                  batch link so we never nest <a> in <a>: the body below is the
                  batch-tracker link, this header chip is the lot link.
                */}
                <div className="flex items-center justify-between gap-2">
                  <EntityLink
                    kind="lot"
                    id={b.lotCode}
                    name={b.lotCode}
                    className="font-mono text-sm font-semibold text-ink underline-offset-4 transition-colors hover:text-forest hover:underline"
                  >
                    {b.lotCode}
                  </EntityLink>
                  {live ? (
                    <Badge tone="forest" dot>
                      {t("board.live")}
                    </Badge>
                  ) : (
                    <Badge tone="neutral" dot>
                      {t("board.finished")}
                    </Badge>
                  )}
                </div>

                {/* The card body navigates to the live batch tracker. */}
                <EntityLink
                  kind="batch"
                  id={b.id}
                  name={b.lotCode}
                  className="-m-1 block p-1 transition"
                >
                  <p className="text-xs text-muted-fg">
                    {b.method}
                    {b.recipeId
                      ? t("board.recipeApplied")
                      : t("board.noRecipe")}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-fg/70">
                    {t("board.started", { date: longDate(b.startedAt) })}
                  </p>
                </EntityLink>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
