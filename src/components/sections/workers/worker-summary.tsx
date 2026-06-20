import { Users, UserCheck, DollarSign, Layers } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Tile } from "@/components/ui/tile";
import { workers } from "@/lib/data/workers";
import { num, usd } from "@/lib/utils";

/**
 * WorkerSummary — at-a-glance workforce strip for the Workers section.
 * Server component: derives headcount, today's attendance, payroll, and crew
 * count directly from the canonical workers list. No hooks or handlers.
 */
export function WorkerSummary() {
  const present = workers.filter((w) => w.attendance === "present");

  const headcount = workers.length;
  const presentCount = present.length;
  const dailyPayroll = present.reduce((sum, w) => sum + w.dailyRateUsd, 0);
  const crewCount = new Set(workers.map((w) => w.crew)).size;

  return (
    <Card className="animate-rise overflow-hidden">
      <div className="stagger perf-contain grid grid-cols-1 divide-y divide-white/60 sm:grid-cols-2 sm:divide-y-0 sm:divide-x lg:grid-cols-4">
        <Tile
          label="Headcount"
          value={num(headcount)}
          sub="On the payroll"
          accent="forest"
          icon={Users}
          className="glass-hover rounded-2xl"
        />
        <Tile
          label="Present today"
          value={num(presentCount)}
          sub={`${num(headcount - presentCount)} off`}
          accent="honey"
          icon={UserCheck}
          className="glass-hover rounded-2xl"
        />
        <Tile
          label="Daily payroll"
          value={usd(dailyPayroll)}
          sub="Present workers"
          accent="coffee"
          icon={DollarSign}
          className="glass-hover rounded-2xl"
        />
        <Tile
          label="Crews"
          value={num(crewCount)}
          sub="Active teams"
          accent="sky"
          icon={Layers}
          className="glass-hover rounded-2xl"
        />
      </div>
    </Card>
  );
}
