import { Coffee, FlaskConical, ListChecks, Users, Truck } from "lucide-react";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { EntityLink } from "@/components/ui/entity-link";
import { getActivity } from "@/lib/db/activity";
import type { ActivityItem } from "@/lib/types";
import { relativeDay } from "@/lib/utils";

/**
 * Lot codes (`JC-NNN`) are embedded in the free-text activity copy. We surface the
 * first one as a real link to its lot dossier so an event that NAMES a lot is no
 * longer dead UI — the rest of the text stays as written. Events that name no lot
 * (e.g. a crew clock-in) render as plain text, never a fabricated link.
 */
const LOT_CODE = /\b(JC-\d+)\b/;

/**
 * Render activity text, turning the first `JC-NNN` lot code into an `<EntityLink>`
 * while preserving the surrounding prose verbatim. Returns the plain string when no
 * lot code is present.
 */
function renderActivityText(text: string): React.ReactNode {
  const match = LOT_CODE.exec(text);
  if (!match) return text;

  const code = match[1];
  const start = match.index;
  const before = text.slice(0, start);
  const after = text.slice(start + code.length);

  return (
    <>
      {before}
      <EntityLink
        kind="lot"
        id={code}
        className="rounded font-medium text-forest underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-300"
      >
        {code}
      </EntityLink>
      {after}
    </>
  );
}

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
export async function ActivityFeedCard() {
  const activity = await getActivity();

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
                  <p className="text-sm text-ink">{renderActivityText(item.text)}</p>
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
