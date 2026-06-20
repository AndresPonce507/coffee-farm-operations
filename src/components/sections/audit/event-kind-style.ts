import { Coffee, FlaskConical, ListChecks, Users, Truck } from "lucide-react";

import type { ActivityItem } from "@/lib/types";

/**
 * Shared kind→glass-chip vocabulary for the event spine (S3).
 *
 * The activity feed (`activity-feed-card.tsx`) holds the canonical `KIND_ICON` /
 * `KIND_CHIP` maps keyed by the five projected `ActivityItem` kinds. The audit
 * drawer renders raw `lot_event` rows whose `kind` is a free string (e.g.
 * `cherry_intake`, `stage_advance`), so it cannot key those maps directly.
 *
 * To **reuse, not fork** that vocabulary, this module keeps the icon + chip
 * values byte-identical to the feed's and routes every ledger kind onto one of
 * the five activity buckets. The activity feed *is* a projection of this same
 * ledger (ADR-001), so the icon a row shows here matches the one the feed shows
 * for the same event — they cannot disagree.
 *
 * FOLLOW-UP (out of slice scope): promote the canonical maps to a single
 * exported module (e.g. `src/lib/activity-kind.ts`) and have both the feed and
 * this helper import it, so the vocabulary lives in exactly one place.
 */

type Icon = React.ComponentType<{ className?: string }>;
type ActivityKind = ActivityItem["kind"];

/** Icon per activity bucket — identical set to the activity feed's KIND_ICON. */
const BUCKET_ICON: Record<ActivityKind, Icon> = {
  harvest: Coffee,
  processing: FlaskConical,
  task: ListChecks,
  labor: Users,
  shipment: Truck,
};

/**
 * Icon-chip tone per bucket — identical literal strings to the feed's KIND_CHIP.
 * Full literal class strings only (never interpolated) so Tailwind keeps them.
 * The chip is an OPAQUE inner surface (bg-*-100 over text-*) → AA-contrast text
 * that never samples the translucent drawer behind it.
 */
const BUCKET_CHIP: Record<ActivityKind, string> = {
  harvest: "bg-cherry-100 text-cherry",
  processing: "bg-sky-100 text-sky",
  task: "bg-honey-100 text-honey",
  labor: "bg-forest-100 text-forest",
  shipment: "bg-coffee-200 text-coffee",
};

/**
 * Route a free-string ledger `kind` onto one of the five activity buckets.
 * Prefix-based so future kinds in a family inherit the right icon without churn.
 */
export function activityBucketFor(kind: string): ActivityKind {
  const k = kind.toLowerCase();
  if (k.includes("intake") || k.includes("harvest") || k.includes("pick")) {
    return "harvest";
  }
  if (
    k.includes("stage") ||
    k.includes("process") ||
    k.includes("ferment") ||
    k.includes("dry") ||
    k.includes("mill") ||
    k.includes("mint") ||
    k.includes("lot")
  ) {
    return "processing";
  }
  if (k.includes("task") || k.includes("inspect") || k.includes("prun")) {
    return "task";
  }
  if (k.includes("attend") || k.includes("labor") || k.includes("worker")) {
    return "labor";
  }
  if (k.includes("ship") || k.includes("deliver") || k.includes("dispatch")) {
    return "shipment";
  }
  // Unknown kinds default to the processing bucket — the ledger's most common
  // family — rather than throwing on an unforeseen event kind.
  return "processing";
}

/** The lucide icon component for a ledger event kind. */
export function eventKindIcon(kind: string): Icon {
  return BUCKET_ICON[activityBucketFor(kind)];
}

/** The opaque chip class string for a ledger event kind. */
export function eventKindChip(kind: string): string {
  return BUCKET_CHIP[activityBucketFor(kind)];
}

/**
 * Humanise a snake_case ledger kind for display, e.g.
 * `cherry_intake` → "Cherry intake", `stage_advance` → "Stage advance".
 */
export function humanizeKind(kind: string): string {
  const spaced = kind.replace(/[_-]+/g, " ").trim();
  if (!spaced) return kind;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
