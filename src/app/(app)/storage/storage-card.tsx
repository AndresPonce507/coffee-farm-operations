import type { getTranslations } from "next-intl/server";
import { Snowflake } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { longDate, num } from "@/lib/utils";
import { BandMeter } from "./gauge";
import type { StorageLocationStatus } from "./data";

type StorageT = Awaited<ReturnType<typeof getTranslations<"storage">>>;

/**
 * StorageCard — one controlled-environment location (P3-S20). A glass-lite card with
 * the location's name + an honest verdict badge (in band / out of band / no readings),
 * then three BandMeters for temperature, humidity, and water activity showing the
 * target band and the latest reading. Pure server component (the gauges are CSS),
 * so the whole cluster renders at 60fps. A location with no readings shows the
 * no-data state on every gauge — never a fabricated in-band claim (rail §5).
 */
export function StorageCard({
  status,
  t,
}: {
  status: StorageLocationStatus;
  t: StorageT;
}) {
  const s = status;
  const verdict =
    s.inBand == null
      ? { tone: "neutral" as const, label: t("status.noData") }
      : s.inBand
        ? { tone: "forest" as const, label: t("status.inBand") }
        : { tone: "danger" as const, label: t("status.excursion") };

  return (
    <div
      data-testid={`storage-card-${s.locationId}`}
      className="glass-card glass-hover perf-contain rounded-2xl p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold text-ink">{s.name}</p>
          <p className="text-xs text-muted-fg">{s.code}</p>
        </div>
        <Badge tone={verdict.tone} dot>
          {verdict.label}
        </Badge>
      </div>

      <div className="mt-5 space-y-4">
        <BandMeter
          label={t("metric.temp")}
          unit="°C"
          value={s.latestTempC}
          min={s.tempMinC}
          max={s.tempMaxC}
          format={(v) => num(v, 1)}
          noReadingLabel={t("status.noData")}
        />
        <BandMeter
          label={t("metric.rh")}
          unit="%"
          value={s.latestRhPct}
          min={s.rhMinPct}
          max={s.rhMaxPct}
          format={(v) => num(v, 0)}
          noReadingLabel={t("status.noData")}
        />
        <BandMeter
          label={t("metric.aw")}
          unit="aw"
          value={s.latestAw}
          min={0}
          max={s.awMax}
          upperOnly
          format={(v) => num(v, 2)}
          noReadingLabel={t("status.noData")}
        />
      </div>

      <div className="mt-5 flex items-center gap-2 text-xs text-muted-fg">
        <Snowflake aria-hidden className="h-3.5 w-3.5" />
        <span className="tabular-nums">
          {s.latestReadingAt == null
            ? t("card.noReadings")
            : t("card.lastReading", { when: longDate(s.latestReadingAt) })}
        </span>
      </div>
    </div>
  );
}
