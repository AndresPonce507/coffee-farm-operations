import { LogIn, LogOut, Coffee, CircleSlash } from "lucide-react";
import { useTranslations } from "next-intl";

import { Card, CardContent } from "@/components/ui/card";
import { EntityLink } from "@/components/ui/entity-link";
import { DossierSection } from "@/components/dossier/dossier-section";
import type { AttendanceEvent } from "@/lib/db/people";

/**
 * WorkerAttendanceSection — the worker dossier's append-only attendance timeline.
 *
 * Pure presentational Server Component. Renders the worker's clock-in/out,
 * rest-day and absence events newest-first. Each event that names a plot links
 * it → /plots/[id] (where they were working) — the cross-entity link tying
 * attendance to the estate's geography. The chain-verified badge (recomputed
 * server-side) is shown when present. es-PA copy, AA on cream, reduced-motion.
 */
export interface WorkerAttendanceSectionProps {
  events: AttendanceEvent[];
  /** Whether the attendance hash-chain reconciled (corruption detector). */
  chainVerified?: boolean;
}

const KIND_META: Record<
  string,
  { labelKey: string; icon: React.ComponentType<{ className?: string }> }
> = {
  "clock-in": { labelKey: "attendanceSection.kindClockIn", icon: LogIn },
  "clock-out": { labelKey: "attendanceSection.kindClockOut", icon: LogOut },
  "rest-day": { labelKey: "attendanceSection.kindRestDay", icon: Coffee },
  absent: { labelKey: "attendanceSection.kindAbsent", icon: CircleSlash },
};

/** es-PA short timestamp; pure + locale-stable for the render test. */
function fmt(occurredAt: string): string {
  const d = new Date(occurredAt);
  return d.toLocaleString("es-PA", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function WorkerAttendanceSection({
  events,
  chainVerified,
}: WorkerAttendanceSectionProps) {
  const t = useTranslations("workers");
  return (
    <DossierSection
      id="attendance"
      title={t("attendanceSection.sectionTitle")}
      count={events.length}
      empty={events.length === 0}
      emptyLabel={t("attendanceSection.emptyLabel")}
    >
      <Card data-testid="worker-attendance-card" className="animate-rise">
        <CardContent>
          {typeof chainVerified === "boolean" && (
            <p
              data-testid="attendance-chain"
              className="mb-3 text-xs font-medium text-muted-fg"
            >
              {chainVerified
                ? t("attendanceSection.chainVerified")
                : t("attendanceSection.chainNotVerified")}
            </p>
          )}
          <ol className="space-y-3" data-testid="worker-attendance-timeline">
            {events.map((e) => {
              const meta = KIND_META[e.eventKind];
              const label = meta ? t(meta.labelKey) : e.eventKind;
              const Icon = meta?.icon ?? CircleSlash;
              return (
                <li key={e.eventUid} className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-forest-100 text-forest"
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-ink">
                        {label}
                      </span>
                      <span className="text-xs tabular-nums text-muted-fg">
                        {fmt(e.occurredAt)}
                      </span>
                    </div>
                    {e.plotId && (
                      <EntityLink
                        kind="plot"
                        id={e.plotId}
                        className="mt-0.5 inline-block rounded-md text-xs font-medium text-forest underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
                      >
                        {e.plotId}
                      </EntityLink>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>
    </DossierSection>
  );
}
