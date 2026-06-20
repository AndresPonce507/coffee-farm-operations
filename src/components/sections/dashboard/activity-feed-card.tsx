import { Coffee, FlaskConical, ListChecks, Users, Truck } from "lucide-react";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { activity } from "@/lib/data/activity";
import type { ActivityItem } from "@/lib/types";
import { relativeDay } from "@/lib/utils";

type Icon = React.ComponentType<{ className?: string }>;
type ActivityKind = ActivityItem["kind"];

/** Icon per activity kind. */
const KIND_ICON: Record<ActivityKind, Icon> = {
  harvest: Coffee,
  processing: FlaskConical,
  task: ListChecks,
  labor: Users,
  shipment: Truck,
};

/**
 * Icon-chip tone per kind. Full literal class strings only — never interpolated,
 * so Tailwind keeps them in the build.
 */
const KIND_CHIP: Record<ActivityKind, string> = {
  harvest: "bg-cherry-100 text-cherry",
  processing: "bg-sky-100 text-sky",
  task: "bg-honey-100 text-honey",
  labor: "bg-forest-100 text-forest",
  shipment: "bg-coffee-200 text-coffee",
};

/**
 * ActivityFeedCard — the dashboard's "what just happened" stream.
 * A vertical, divider-separated timeline of the most recent farm events.
 */
export function ActivityFeedCard() {
  return (
    <Card className="animate-rise">
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        <ul className="stagger -mx-2 divide-y divide-line">
          {activity.map((item) => {
            const Icon = KIND_ICON[item.kind];
            return (
              <li
                key={item.id}
                className="flex items-start gap-3 rounded-xl px-2 py-3 transition-colors duration-200 first:pt-0 last:pb-0 hover:bg-white/55"
              >
                <span
                  className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${KIND_CHIP[item.kind]}`}
                  aria-hidden="true"
                >
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{item.text}</p>
                  <p className="mt-0.5 text-xs text-muted-fg">{relativeDay(item.at)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
