/**
 * /margins — instant route-loading skeleton.
 *
 * Rendered the moment the segment starts loading, swapped for the real board once
 * page.tsx resolves. Mirrors that page's shape — header, a 4-up summary strip, a grid
 * of per-lot margin cards, then the FX rate book panel — so the layout never shifts
 * under the user. Pure server component: no data, no client JS. Glassy animate-pulse
 * placeholders that the global reduced-motion rule neutralizes.
 */
import { useTranslations } from "next-intl";

export default function MarginsLoading() {
  const t = useTranslations("margins");
  return (
    <div className="space-y-6" aria-busy="true" aria-label={t("loading.board")}>
      {/* Header — mirrors PageHeader (title + subtitle, hairline divider). */}
      <div className="animate-rise relative mb-6 pb-4">
        <div className="space-y-2.5">
          <div className="h-8 w-40 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-80 max-w-full animate-pulse rounded bg-line" />
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

      {/* Per-lot margin cards. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="glass-card space-y-4 rounded-2xl p-5">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <div className="h-4 w-20 animate-pulse rounded bg-muted" />
                <div className="h-3 w-14 animate-pulse rounded bg-line" />
              </div>
              <div className="h-6 w-24 animate-pulse rounded-full bg-muted" />
            </div>
            <div className="h-8 w-32 animate-pulse rounded-lg bg-muted" />
            <div className="grid grid-cols-2 gap-3">
              <div className="h-12 animate-pulse rounded-xl bg-line" />
              <div className="h-12 animate-pulse rounded-xl bg-line" />
            </div>
            <div className="h-4 w-full animate-pulse rounded bg-line" />
          </div>
        ))}
      </div>

      {/* FX rate book panel. */}
      <div className="glass-card space-y-3 rounded-2xl p-5">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 animate-pulse rounded-xl bg-muted" />
          <div className="space-y-2">
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
            <div className="h-3 w-64 max-w-full animate-pulse rounded bg-line" />
          </div>
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between py-1.5">
            <div className="space-y-1.5">
              <div className="h-3.5 w-24 animate-pulse rounded bg-muted" />
              <div className="h-3 w-16 animate-pulse rounded bg-line" />
            </div>
            <div className="h-5 w-16 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
