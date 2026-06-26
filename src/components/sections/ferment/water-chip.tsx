import { Droplets } from "lucide-react";
import { useTranslations } from "next-intl";

import type { WaterPerKg } from "@/lib/db/ferment";
import { num } from "@/lib/utils";

/**
 * WaterChip — the eco-mill water-per-kg sustainability chip (P2-S3). Pure
 * presentation: the L/kg number Phase-3/4 carbon & Bird-Friendly dossiers read,
 * derived live from the lot's water log vs its mass (`v_water_per_kg`). A null /
 * underived value renders a calm no-data state, never a misleading zero.
 */
export function WaterChip({ water }: { water: WaterPerKg | null }) {
  const t = useTranslations("ferment");
  const perKg = water?.litersPerKg ?? null;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-sky-100 bg-sky-100/40 px-4 py-3">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-sky-100/70 text-sky">
        <Droplets className="h-4 w-4" aria-hidden />
      </span>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-fg">
          {t("waterChip.waterUse")}
        </p>
        {perKg === null ? (
          <p className="font-display text-base font-semibold text-muted-fg">
            — <span className="text-xs font-normal">{t("waterChip.noWater")}</span>
          </p>
        ) : (
          <p className="font-display text-base font-semibold tabular-nums text-ink">
            {t("waterChip.perKg", { value: num(perKg, perKg < 10 ? 1 : 0) })}
            <span className="ml-2 text-xs font-normal text-muted-fg">
              {t("waterChip.totalOver", {
                liters: num(water!.totalLiters),
                kg: num(water!.lotKg),
              })}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
