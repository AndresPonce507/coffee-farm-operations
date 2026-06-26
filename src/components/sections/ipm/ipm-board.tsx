import { Bug, SprayCan } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Card, CardContent } from "@/components/ui/card";
import {
  getIpmThresholds,
  getPlotPhiStatus,
  getSprayHistory,
} from "@/lib/db/remote-sensing";
import { getPlotOptions, getValidApplicators } from "@/lib/db/ipm-applicators";
import { num } from "@/lib/utils";

import { PhiChips } from "./phi-chips";
import { ScoutingBoard } from "./scouting-board";
import { SprayHistory } from "./spray-history";
import { SprayLogForm } from "./spray-log-form";

/**
 * IpmBoard — the /scouting surface (P2-S12), the closed-loop IPM cockpit.
 *
 * Async Server Component: pulls the scouting threshold statuses, the active PHI/REI
 * windows, the spray history, and the cert-gated applicator list in parallel, then
 * lays out the scouting board, the cert-refusing spray-log form, the PHI countdown
 * chips, and the spray log. The recommend/hold call, the cert gate, and the safety
 * windows are all visible in one place — agronomy as a closed, safety-respecting
 * loop, not a dashboard.
 *
 * World-class: glass sections, a responsive 2-column split that stacks on mobile,
 * AA contrast, reduced-motion safe.
 */
export async function IpmBoard() {
  const t = await getTranslations("ipm");
  const [thresholds, phi, sprays, applicators, plots] = await Promise.all([
    getIpmThresholds(),
    getPlotPhiStatus(),
    getSprayHistory(),
    getValidApplicators(),
    getPlotOptions(),
  ]);

  const recommendCount = thresholds.filter((t) => t.recommend).length;

  return (
    <div className="space-y-6">
      <section aria-label={t("board.safetyWindowsLabel")}>
        <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-muted-fg">
          {t("board.safetyWindowsHeading")}
        </h2>
        <PhiChips rows={phi} />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <section className="lg:col-span-3" aria-label={t("board.scoutingLabel")}>
          <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wide text-muted-fg">
            <Bug className="h-4 w-4" aria-hidden />
            {t("board.scoutingHeading", {
              count: recommendCount,
              countLabel: num(recommendCount),
            })}
          </h2>
          <ScoutingBoard rows={thresholds} />
        </section>

        <section className="lg:col-span-2" aria-label={t("board.logSprayLabel")}>
          <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wide text-muted-fg">
            <SprayCan className="h-4 w-4" aria-hidden /> {t("board.logSprayHeading")}
          </h2>
          <Card className="animate-rise">
            <CardContent>
              <p className="mb-4 text-xs text-muted-fg">
                {t("board.logSprayHint")}
              </p>
              <SprayLogForm plots={plots} applicators={applicators} />
            </CardContent>
          </Card>
        </section>
      </div>

      <section aria-label={t("board.sprayHistoryLabel")}>
        <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-muted-fg">
          {t("board.sprayHistoryHeading")}
        </h2>
        <SprayHistory rows={sprays} />
      </section>
    </div>
  );
}
