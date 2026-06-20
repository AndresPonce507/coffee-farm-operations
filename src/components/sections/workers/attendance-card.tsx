import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Donut } from "@/components/charts/donut";
import { workers } from "@/lib/data/workers";
import { PALETTE } from "@/lib/brand";
import type { AttendanceStatus } from "@/lib/types";

/**
 * AttendanceCard — daily roll-call snapshot for the workforce.
 * Tallies present / rest-day / absent across the whole crew and renders a
 * donut (present count at the center) alongside a labelled legend.
 *
 * Pure server component: no hooks, no handlers.
 */

interface AttendanceSlice {
  status: AttendanceStatus;
  label: string;
  color: string;
}

// Display order + the brand color each status maps to. Donut legend reuses this.
const SLICES: readonly AttendanceSlice[] = [
  { status: "present", label: "Present", color: PALETTE.forest500 },
  { status: "rest-day", label: "Rest day", color: PALETTE.honey },
  { status: "absent", label: "Absent", color: PALETTE.cherry },
] as const;

export function AttendanceCard() {
  // Tally each attendance status across the full workforce.
  const counts: Record<AttendanceStatus, number> = {
    present: 0,
    "rest-day": 0,
    absent: 0,
  };
  for (const w of workers) {
    counts[w.attendance] += 1;
  }

  const total = workers.length;
  const presentCount = counts.present;

  const donutData = SLICES.map((s) => ({
    label: s.label,
    value: counts[s.status],
    color: s.color,
  }));

  return (
    <Card className="glass-hover glass-sheen animate-rise">
      <CardHeader>
        <CardTitle>Attendance</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:justify-between">
          <Donut
            data={donutData}
            size={168}
            thickness={22}
            centerLabel={String(presentCount)}
            centerSub="present"
            className="shrink-0"
          />

          <ul className="stagger flex w-full flex-col gap-2.5 sm:w-auto sm:min-w-[11rem]">
            {SLICES.map((s) => {
              const count = counts[s.status];
              const share = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <li
                  key={s.status}
                  className="flex items-center justify-between gap-4 rounded-xl border border-white/60 bg-white/55 px-3 py-2"
                >
                  <span className="flex items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="text-sm text-muted-fg">{s.label}</span>
                  </span>
                  <span className="flex items-baseline gap-1.5">
                    <span className="font-display text-sm font-semibold tabular-nums text-ink">
                      {count}
                    </span>
                    <span className="text-xs tabular-nums text-muted-fg">
                      {share}%
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
