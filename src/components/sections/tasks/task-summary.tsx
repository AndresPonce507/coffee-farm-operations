import { ListChecks, Loader, TriangleAlert, Flag } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Tile } from "@/components/ui/tile";
import { tasks } from "@/lib/data/tasks";
import { num } from "@/lib/utils";

/** "Today" for the mock data — tasks due before this are overdue. */
const TODAY = "2026-06-20";

const openCount = tasks.filter((t) => t.status === "todo").length;
const inProgressCount = tasks.filter((t) => t.status === "in-progress").length;
const overdueCount = tasks.filter(
  (t) => t.due < TODAY && t.status !== "done"
).length;
const highPriorityCount = tasks.filter(
  (t) => t.priority === "high" && t.status !== "done"
).length;

/**
 * TaskSummary — at-a-glance counts for the agronomy task board.
 * A divided grid of borderless Tiles inside a single Card surface.
 * Server component (pure render over static mock data).
 */
export function TaskSummary() {
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">
        <Tile
          label="Open"
          value={num(openCount)}
          sub="Awaiting a start"
          accent="forest"
          icon={ListChecks}
          className="sm:border-r sm:border-line"
        />
        <Tile
          label="In progress"
          value={num(inProgressCount)}
          sub="Underway in the field"
          accent="honey"
          icon={Loader}
          className="lg:border-r lg:border-line"
        />
        <Tile
          label="Overdue"
          value={num(overdueCount)}
          sub="Past due, not done"
          accent="cherry"
          icon={TriangleAlert}
          className="sm:border-r sm:border-line"
        />
        <Tile
          label="High priority"
          value={num(highPriorityCount)}
          sub="Needs attention first"
          accent="coffee"
          icon={Flag}
        />
      </div>
    </Card>
  );
}
