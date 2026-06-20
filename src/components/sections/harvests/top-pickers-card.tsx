import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { ProgressBar } from "@/components/ui/progress-bar";
import { pickers } from "@/lib/data/workers";
import { kg } from "@/lib/utils";

/**
 * Top pickers today — leaderboard of cherry pickers ranked by today's kilograms.
 * Server component (no hooks/handlers). Active pickers sorted desc and capped at six;
 * pickers with nothing today (absent / rest-day) are listed faded beneath.
 */
export function TopPickersCard() {
  const active = pickers
    .filter((p) => p.todayKg > 0)
    .sort((a, b) => b.todayKg - a.todayKg)
    .slice(0, 6);

  const idle = pickers
    .filter((p) => p.todayKg === 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Guard against division by zero when no one has picked yet.
  const maxTodayKg = active.length > 0 ? active[0].todayKg : 1;

  return (
    <Card className="animate-rise">
      <CardHeader>
        <div>
          <CardTitle>Top pickers today</CardTitle>
          <CardDescription>Cherries picked since this morning</CardDescription>
        </div>
      </CardHeader>

      <CardContent>
        <ol className="stagger space-y-2.5 perf-contain">
          {active.map((picker, index) => (
            <li
              key={picker.id}
              className="glass-hover flex items-center gap-3 rounded-xl border border-white/60 bg-white/55 px-3 py-2.5"
            >
              <span
                className="w-4 shrink-0 text-right text-xs font-semibold tabular-nums text-honey-700"
                aria-hidden="true"
              >
                {index + 1}
              </span>

              <Avatar name={picker.name} size="md" className="ring-white/60" />

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-sm font-medium text-ink">{picker.name}</p>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                    {kg(picker.todayKg)}
                  </p>
                </div>
                <div className="mt-1.5 flex items-center gap-3">
                  <ProgressBar
                    value={(picker.todayKg / maxTodayKg) * 100}
                    tone="forest"
                    className="flex-1"
                  />
                  <span className="shrink-0 text-xs text-muted-fg">{picker.crew}</span>
                </div>
              </div>
            </li>
          ))}
        </ol>

        {idle.length > 0 && (
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-fg">
              Off today
            </p>
            <ul className="mt-3 space-y-2">
              {idle.map((picker) => (
                <li
                  key={picker.id}
                  className="flex items-center gap-3 rounded-xl border border-white/50 bg-white/40 px-3 py-2 opacity-60"
                >
                  <span className="w-4 shrink-0" aria-hidden="true" />
                  <Avatar name={picker.name} size="md" className="ring-white/60" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{picker.name}</p>
                    <p className="text-xs text-muted-fg">{picker.crew}</p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-muted-fg">
                    {kg(picker.todayKg)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
