import { Cloud, CloudFog, CloudRain, Droplet, Sun } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { weather } from "@/lib/data/weather";
import type { WeatherDay } from "@/lib/types";

/**
 * WeatherStripCard — compact 5-day Volcán forecast strip for the dashboard.
 * Server component (static display): no hooks, no handlers.
 */

type WeatherIcon = WeatherDay["icon"];

/** Lucide icon per forecast condition. */
const ICON_BY_CONDITION: Record<
  WeatherIcon,
  React.ComponentType<{ className?: string }>
> = {
  sun: Sun,
  cloud: Cloud,
  rain: CloudRain,
  fog: CloudFog,
};

/** Brand-token icon color per condition (full literal strings — never interpolated). */
const ICON_COLOR_BY_CONDITION: Record<WeatherIcon, string> = {
  sun: "text-honey",
  cloud: "text-sky",
  rain: "text-sky",
  fog: "text-muted-fg",
};

/** Human-readable condition label for accessibility. */
const CONDITION_LABEL: Record<WeatherIcon, string> = {
  sun: "Sunny",
  cloud: "Cloudy",
  rain: "Rain",
  fog: "Fog",
};

export function WeatherStripCard() {
  return (
    <Card className="animate-rise overflow-hidden">
      <CardHeader>
        <div>
          <CardTitle>Volcán forecast</CardTitle>
          <p className="mt-0.5 text-xs text-muted-fg">
            Chiriquí highlands · 5-day
          </p>
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        <ul className="grid grid-cols-5 gap-2 sm:gap-3">
          {weather.map((day) => {
            const Icon = ICON_BY_CONDITION[day.icon];
            const iconColor = ICON_COLOR_BY_CONDITION[day.icon];
            return (
              <li
                key={day.day}
                className="flex flex-col items-center gap-2 rounded-xl border border-line bg-paper-2 px-1.5 py-3 text-center sm:px-2"
              >
                <span className="font-display text-xs font-semibold text-ink sm:text-sm">
                  {day.day}
                </span>

                <span role="img" aria-label={CONDITION_LABEL[day.icon]}>
                  <Icon className={`h-6 w-6 ${iconColor}`} />
                </span>

                <span className="text-sm leading-none">
                  <span className="font-semibold text-ink">{day.hi}°</span>
                  <span className="ml-1 text-muted-fg">{day.lo}°</span>
                </span>

                <span className="flex items-center gap-0.5 text-xs text-muted-fg">
                  <Droplet className="h-3 w-3 text-sky" aria-hidden="true" />
                  {day.rainPct}%
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
