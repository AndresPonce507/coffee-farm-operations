/**
 * /sales/shipments — instant route-loading skeleton.
 *
 * Rendered the moment the segment starts loading, swapped for the real board once
 * page.tsx resolves. Mirrors that page's shape — header, a 4-up summary strip, the
 * build bar, then a grid of shipment cards — so the layout never shifts. Pure server
 * component: no data, no client JS. Glassy animate-pulse placeholders the global
 * reduced-motion rule neutralizes.
 */
import { useTranslations } from "next-intl";

export default function ShipmentsLoading() {
  const t = useTranslations("shipments");
  return (
    <div className="space-y-6" aria-busy="true" aria-label={t("loading.board")}>
      {/* Header — title + subtitle over the hairline divider. */}
      <div className="animate-rise relative mb-6 pb-4">
        <div className="space-y-2.5">
          <div className="h-8 w-48 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-96 max-w-full animate-pulse rounded bg-line" />
        </div>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      {/* Summary strip — 4 KPI tiles in a divided glass card. */}
      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2.5 p-4">
            <div className="h-9 w-9 animate-pulse rounded-xl bg-muted" />
            <div className="h-3 w-20 animate-pulse rounded bg-line" />
            <div className="h-7 w-16 animate-pulse rounded bg-muted" />
            <div className="h-3 w-24 animate-pulse rounded bg-line" />
          </div>
        ))}
      </div>

      {/* Build bar. */}
      <div className="glass-card h-20 animate-pulse rounded-2xl" />

      {/* Shipment cards. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="glass-card space-y-4 rounded-2xl p-5">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                <div className="h-3 w-20 animate-pulse rounded bg-line" />
              </div>
              <div className="h-6 w-24 animate-pulse rounded-full bg-muted" />
            </div>
            <div className="h-6 w-40 animate-pulse rounded-lg bg-muted" />
            <div className="grid grid-cols-3 gap-3">
              <div className="h-12 animate-pulse rounded-xl bg-line" />
              <div className="h-12 animate-pulse rounded-xl bg-line" />
              <div className="h-12 animate-pulse rounded-xl bg-line" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
