import { Satellite } from "lucide-react";
import { useTranslations } from "next-intl";

import { DossierSection } from "@/components/dossier/dossier-section";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { PlotVegetation, VegetationConfidence } from "@/lib/types";

/* The /plots/[id] dossier's NDVI / vegetation section. Surfaces the fused index
 * value AND the HONEST confidence badge (the differentiator — the cloud is
 * never hidden). Pure Server Component. A null read renders the honest "no
 * trustworthy signal" empty state, never a fabricated value. */

/** Confidence → its translation key under plots.satellite.confidence. */
const CONFIDENCE_KEY: Record<VegetationConfidence, string> = {
  high: "high",
  medium: "medium",
  low: "low",
};
const CONFIDENCE_TONE: Record<VegetationConfidence, BadgeTone> = {
  high: "ok",
  medium: "warn",
  low: "danger",
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("es-PA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

export function PlotSatelliteSection({
  vegetation,
}: {
  vegetation: PlotVegetation | null;
}) {
  const t = useTranslations("plots");
  const hasSignal = vegetation != null && vegetation.value != null;

  return (
    <DossierSection
      id="vegetation"
      title={t("satellite.title")}
      empty={!hasSignal}
      emptyLabel={t("satellite.empty")}
    >
      {vegetation && vegetation.value != null && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-5">
            <div
              aria-hidden
              className="grid h-12 w-12 place-items-center rounded-2xl bg-forest-100 text-forest"
            >
              <Satellite className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-fg">
                {(vegetation.indexKind ?? t("satellite.indexFallback")).toUpperCase()}
              </p>
              <p className="font-display text-2xl font-bold text-ink">
                {vegetation.value.toFixed(2)}
              </p>
            </div>
            <div className="ml-auto flex flex-col items-end gap-1.5">
              <Badge tone={CONFIDENCE_TONE[vegetation.confidence]} dot>
                {t(`satellite.confidence.${CONFIDENCE_KEY[vegetation.confidence]}`)}
              </Badge>
              <span className="text-xs text-muted-fg">
                {vegetation.basis === "optical" ? t("satellite.optical") : "SAR"}
                {vegetation.cloudPct != null &&
                  ` · ${t("satellite.cloud", { pct: vegetation.cloudPct })}`}
                {vegetation.observedAt &&
                  ` · ${fmtDate(vegetation.observedAt)}`}
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </DossierSection>
  );
}
