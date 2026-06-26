import { ListChecks, Loader, TriangleAlert, Flag } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Card } from "@/components/ui/card";
import { Tile } from "@/components/ui/tile";
import { getTasks } from "@/lib/db/tasks";
import { num, today } from "@/lib/utils";

/**
 * TaskSummary — at-a-glance counts for the agronomy task board.
 * A divided grid of borderless Tiles inside a single Card surface.
 * Server component (pure render over the task reads).
 */
export async function TaskSummary() {
  const t = await getTranslations("tasks");
  const tasks = await getTasks();

  // Overdue keys off the LIVE today() — the same source the board + table use, so the
  // tile never disagrees with the rows it summarizes (a frozen anchor drifted apart).
  const todayStr = today();
  const openCount = tasks.filter((t) => t.status === "todo").length;
  const inProgressCount = tasks.filter((t) => t.status === "in-progress").length;
  const overdueCount = tasks.filter(
    (t) => t.due < todayStr && t.status !== "done"
  ).length;
  const highPriorityCount = tasks.filter(
    (t) => t.priority === "high" && t.status !== "done"
  ).length;

  return (
    <Card className="animate-rise overflow-hidden glass-hover glass-sheen">
      <div className="stagger perf-contain grid grid-cols-1 divide-y divide-white/60 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">
        <Tile
          label={t("summary.open")}
          value={num(openCount)}
          sub={t("summary.openSub")}
          accent="forest"
          icon={ListChecks}
          className="sm:border-r sm:border-white/60"
        />
        <Tile
          label={t("summary.inProgress")}
          value={num(inProgressCount)}
          sub={t("summary.inProgressSub")}
          accent="honey"
          icon={Loader}
          className="lg:border-r lg:border-white/60"
        />
        <Tile
          label={t("summary.overdue")}
          value={num(overdueCount)}
          sub={t("summary.overdueSub")}
          accent="cherry"
          icon={TriangleAlert}
          className="sm:border-r sm:border-white/60"
        />
        <Tile
          label={t("summary.highPriority")}
          value={num(highPriorityCount)}
          sub={t("summary.highPrioritySub")}
          accent="coffee"
          icon={Flag}
        />
      </div>
    </Card>
  );
}
