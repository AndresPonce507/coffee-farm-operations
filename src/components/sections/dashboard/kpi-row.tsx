import { Coffee, Users, FlaskConical, Target } from "lucide-react";

import { StatCard } from "@/components/ui/stat-card";
import { getWorkers } from "@/lib/db/workers";
import { getBatches } from "@/lib/db/processing";
import { getDailyCherries, getSeason } from "@/lib/db/trends";
import { kg, num, pct } from "@/lib/utils";

/**
 * KpiRow — the four headline metrics at the top of the Farm Operations
 * dashboard. Pure server component: every figure is derived from the canonical
 * mock data at module scope, so it renders identically on server and client.
 */
export async function KpiRow() {
  const [workers, batches, dailyCherries, SEASON] = await Promise.all([
    getWorkers(),
    getBatches(),
    getDailyCherries(),
    getSeason(),
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
      aria-label="Key farm metrics"
      className="stagger perf-contain grid animate-rise gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      <StatCard
        label="Today's cherries"
        value={kg(SEASON.todayKg)}
        icon={Coffee}
        accent="forest"
        delta={{ value: `${pct(changePct)} vs 7d ago`, dir: deltaDir }}
        hint="received today"
        spark={spark}
      />

      <StatCard
        label="Pickers present"
        value={num(pickersPresent)}
        icon={Users}
        accent="honey"
        hint={`of ${num(allPickers.length)} pickers`}
      />

      <StatCard
        label="Drying batches"
        value={num(dryingBatches)}
        icon={FlaskConical}
        accent="coffee"
        hint="on the beds now"
      />

      <StatCard
        label="Season to date"
        value={kg(SEASON.harvestedKg)}
        icon={Target}
        accent="cherry"
        hint={`${pct(seasonPct)} of target`}
      />
    </section>
  );
}
