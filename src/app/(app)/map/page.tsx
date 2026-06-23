import { getTranslations } from "next-intl/server";

import { getPlotsGeoJSON, getReserveGeoJSON } from "@/lib/db/geo";
import { MapCanvas } from "@/components/islands/MapCanvas.client";
import { PALETTE } from "@/lib/brand";

/**
 * /map — the farm map spine. Server component: fetches the two GeoJSON
 * collections, then hands them to MapCanvas (a client wrapper that lazy-loads the
 * MapLibre island ssr:false, since GL needs a real context), with a glass
 * SkeletonMap during lazy-load so CLS≈0.
 *
 * Floating glass chrome (title + legend) is on-brand forest, on opaque inner chips
 * (AD-3) so labels never sit directly on the translucent map veil.
 */

const LEGEND: { key: string; color: string; ring?: boolean }[] = [
  { key: "healthy", color: PALETTE.forest500 },
  { key: "watch", color: PALETTE.honey },
  { key: "atRisk", color: PALETTE.cherry },
  { key: "reserve", color: PALETTE.forest, ring: true },
];

export default async function MapPage() {
  const t = await getTranslations("map");
  const [plots, reserve] = await Promise.all([
    getPlotsGeoJSON(),
    getReserveGeoJSON(),
  ]);

  return (
    <div className="animate-rise relative h-[calc(100vh-9rem)] min-h-[28rem] w-full overflow-hidden rounded-2xl">
      {/* The map fills the frame; chrome floats over it. */}
      <MapCanvas plots={plots} reserve={reserve} />

      {/* Title panel — floating glass, opaque inner content (AD-3). */}
      <div className="glass pointer-events-none absolute left-4 top-4 z-10 max-w-xs rounded-2xl p-4">
        <div className="rounded-xl bg-card/95 px-3.5 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-forest-500">
            Janson Coffee · Volcán
          </p>
          <h1 className="mt-0.5 font-display text-lg font-bold text-ink">
            {t("page.title")}
          </h1>
          <p className="mt-1 text-xs text-muted-fg">
            {t("page.subtitle")}
          </p>
        </div>
      </div>

      {/* Legend — floating glass, opaque chip rows (AD-3). */}
      <div className="glass pointer-events-none absolute bottom-4 left-4 z-10 rounded-2xl p-3">
        <ul className="space-y-1.5 rounded-xl bg-card/95 px-3 py-2.5">
          {LEGEND.map(({ key, color, ring }) => (
            <li key={key} className="flex items-center gap-2 text-xs text-ink">
              <span
                aria-hidden
                className="h-3 w-3 shrink-0 rounded-[4px]"
                style={
                  ring
                    ? { border: `1.5px dashed ${color}`, background: `${color}22` }
                    : { background: color }
                }
              />
              <span className="font-medium">{t(`legend.${key}`)}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* PLACEHOLDER notice — these boundaries aren't surveyed yet (family gate). */}
      <div className="glass pointer-events-none absolute right-4 top-4 z-10 max-w-[15rem] rounded-2xl p-2.5">
        <p className="rounded-lg bg-card/95 px-3 py-2 text-[11px] leading-snug text-muted-fg">
          {t("placeholderNote")}
        </p>
      </div>
    </div>
  );
}
