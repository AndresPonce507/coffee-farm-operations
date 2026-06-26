/**
 * Weigh — instant route-loading skeleton.
 *
 * Rendered the moment the "/weigh" segment starts loading, then swapped for the real
 * page once `page.tsx` resolves. Mirrors that page's shape — header, the running
 * tally card, the picker grid, the plot row, the numeric pad, and the ripeness pad —
 * so the <3-second capture surface never shifts under a glove.
 *
 * Pure server component: no data imports, no client JS. Glassy `animate-pulse`
 * placeholders float over the global LivingBackground.
 */
import { useTranslations } from "next-intl";

export default function WeighLoading() {
  const t = useTranslations("common");
  return (
    <div className="space-y-6" aria-busy="true" aria-label={t("loading.weigh")}>
      {/* Header — mirrors PageHeader. */}
      <div className="animate-rise relative mb-6 pb-4">
        <div className="space-y-2.5">
          <div className="h-8 w-28 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-96 max-w-full animate-pulse rounded bg-line" />
        </div>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      {/* Tally card — two divided figures. */}
      <div className="glass-card grid grid-cols-2 rounded-2xl">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="space-y-2 px-4 py-3">
            <div className="h-3 w-24 animate-pulse rounded bg-line" />
            <div className="h-7 w-20 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>

      {/* Picker grid. */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="glass-card h-[72px] animate-pulse rounded-2xl" />
        ))}
      </div>

      {/* Numeric pad keys. */}
      <div className="grid grid-cols-3 gap-2.5">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="glass-card h-[58px] animate-pulse rounded-2xl" />
        ))}
      </div>

      {/* Ripeness pad. */}
      <div className="grid grid-cols-3 gap-2.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="glass-card h-[76px] animate-pulse rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
