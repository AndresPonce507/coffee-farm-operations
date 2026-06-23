import { Users, UserCheck, DollarSign, Layers } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Card } from "@/components/ui/card";
import { Tile } from "@/components/ui/tile";
import { getWorkers } from "@/lib/db/workers";
import { num, usd } from "@/lib/utils";

/**
 * WorkerSummary — at-a-glance workforce strip for the Workers section.
 * Server component: derives headcount, today's attendance, payroll, and crew
 * count directly from the canonical workers list. No hooks or handlers.
 */
export async function WorkerSummary() {
  const t = await getTranslations("workers");
  const workers = await getWorkers();

  const present = workers.filter((w) => w.attendance === "present");

  const headcount = workers.length;
  const presentCount = present.length;
  const dailyPayroll = present.reduce((sum, w) => sum + w.dailyRateUsd, 0);
  const crewCount = new Set(workers.map((w) => w.crew)).size;

  return (
    <Card className="animate-rise overflow-hidden">
      <div className="stagger perf-contain grid grid-cols-1 divide-y divide-white/60 sm:grid-cols-2 sm:divide-y-0 sm:divide-x lg:grid-cols-4">
        <Tile
          label={t("summary.headcount")}
          value={num(headcount)}
          sub={t("summary.headcountSub")}
          accent="forest"
          icon={Users}
          className="glass-hover rounded-2xl"
        />
        <Tile
          label={t("summary.presentToday")}
          value={num(presentCount)}
          sub={t("summary.presentSub", { n: num(headcount - presentCount) })}
          accent="honey"
          icon={UserCheck}
          className="glass-hover rounded-2xl"
        />
        <Tile
          label={t("summary.dailyPayroll")}
          value={usd(dailyPayroll)}
          sub={t("summary.dailyPayrollSub")}
          accent="coffee"
          icon={DollarSign}
          className="glass-hover rounded-2xl"
        />
        <Tile
          label={t("summary.crews")}
          value={num(crewCount)}
          sub={t("summary.crewsSub")}
          accent="sky"
          icon={Layers}
          className="glass-hover rounded-2xl"
        />
      </div>
    </Card>
  );
}
