import { Coffee, Users, FlaskConical, Target } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { StatCard } from "@/components/ui/stat-card";
import { getWorkers } from "@/lib/db/workers";
import { getBatches } from "@/lib/db/processing";
import { getDailyCherries, getSeason, getSeasonProvenance } from "@/lib/db/trends";
import { kg, num, pct } from "@/lib/utils";

/**
 * KpiRow — the four headline metrics at the top of the Farm Operations
 * dashboard. Pure server component: every figure is derived from the canonical
 * mock data at module scope, so it renders identically on server and client.
 */
export async function KpiRow() {
  const t = await getTranslations("dashboard");
  const [workers, batches, dailyCherries, SEASON, provenance] = await Promise.all([
    getWorkers(),
    getBatches(),
    getDailyCherries(),
    getSeason(),
    getSeasonProvenance(),
  ]);

  // 1) Today's cherries — last 7 days of daily intake drive the sparkline,
  //    and the start→end change drives the delta chip.
  const last7 = dailyCherries.slice(-7);
  const spark = last7.map((p) => p.value);
  const first = spark[0];
  const latest = spark[spark.length - 1];
  const changePct = first > 0 ? ((latest - first) / first) * 100 : 0;
  // Arrow direction follows the computed change, not a hardcoded "up" — a
  // falling trend must show the down (cherry) arrow, never a green up-arrow.
  const deltaDir = changePct > 0 ? "up" : changePct < 0 ? "down" : "flat";

  // 2) Pickers present out of the full picker roster.
  const allPickers = workers.filter((w) => w.role === "Picker");
  const pickersPresent = allPickers.filter((w) => w.attendance === "present").length;

  // 3) Batches currently on the drying beds.
  const dryingBatches = batches.filter((b) => b.stage === "drying").length;

  // 4) Season-to-date harvest against the full-season target.
  const seasonPct = SEASON.targetKg > 0 ? (SEASON.harvestedKg / SEASON.targetKg) * 100 : 0;

  return (
    <section
      aria-label={t("metrics.ariaLabel")}
      className="stagger perf-contain grid animate-rise gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      <StatCard
        label={t("kpi.todaysCherries")}
        value={kg(SEASON.todayKg)}
        icon={Coffee}
        accent="forest"
        delta={{ value: t("kpi.vs7dAgo", { pct: pct(changePct) }), dir: deltaDir }}
        hint={t("kpi.todaysCherriesHint")}
        spark={spark}
      />

      <StatCard
        label={t("kpi.pickersPresent")}
        value={num(pickersPresent)}
        icon={Users}
        accent="honey"
        hint={t("kpi.pickersPresentHint", { count: num(allPickers.length) })}
      />

      <StatCard
        label={t("kpi.dryingBatches")}
        value={num(dryingBatches)}
        icon={FlaskConical}
        accent="coffee"
        hint={t("kpi.dryingBatchesHint")}
      />

      <StatCard
        label={t("kpi.seasonToDate")}
        value={kg(SEASON.harvestedKg)}
        icon={Target}
        accent="cherry"
        hint={t("kpi.seasonToDateHint", { pct: pct(seasonPct) })}
        // AD-4: this harvest figure is DERIVED by summing the logged harvests, so
        // it carries an honest, always-visible "derived from N harvests · <date>"
        // readout — a real row count + the most-recent harvest date (not a chip).
        provenance={provenance}
      />
    </section>
  );
}
