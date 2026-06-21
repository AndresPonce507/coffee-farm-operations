import { CalendarCheck2, Users, UsersRound } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * CrewSummary — the headline strip above the roster board.
 *
 * Three counts on one divided glass card: crews, total members, present today.
 * Pure presentation — the thin server wrapper derives the counts from the
 * roster projection and hands them in. The divider hairlines stack vertically
 * on mobile and split horizontally from `sm` up; no motion beyond the card's
 * shared `animate-rise` entrance (reduced-motion-safe globally).
 */
export interface CrewSummaryProps {
  crews: number;
  members: number;
  presentToday: number;
  className?: string;
}

interface Stat {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
}

export function CrewSummary({
  crews,
  members,
  presentToday,
  className,
}: CrewSummaryProps) {
  const stats: Stat[] = [
    { label: "Crews", value: crews, icon: UsersRound },
    { label: "Members", value: members, icon: Users },
    { label: "Present today", value: presentToday, icon: CalendarCheck2 },
  ];

  return (
    <Card
      data-testid="crew-summary"
      className={cn(
        "animate-rise grid grid-cols-1 divide-y divide-white/50 sm:grid-cols-3 sm:divide-x sm:divide-y-0",
        className,
      )}
    >
      {stats.map(({ label, value, icon: Icon }) => (
        <div key={label} className="flex items-center gap-3 px-5 py-4">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-forest-100 text-forest"
          >
            <Icon className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <p className="font-display text-xl font-semibold tabular-nums text-ink">
              {value}
            </p>
            <p className="text-xs text-muted-fg">{label}</p>
          </div>
        </div>
      ))}
    </Card>
  );
}
