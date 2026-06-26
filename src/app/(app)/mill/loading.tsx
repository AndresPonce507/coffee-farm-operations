/**
 * /mill — instant route-loading skeleton.
 *
 * Rendered the moment the segment starts loading, swapped for the real board once
 * page.tsx resolves. Mirrors that page's shape — header, a 4-up summary strip, the
 * dry-mill chain registry, then a grid of per-lot gate cards — so the layout never
 * shifts under the user. Pure Server Component: no data, no client JS. Glassy
 * animate-pulse placeholders that the global reduced-motion rule neutralizes.
 */
import { useTranslations } from "next-intl";

export default function MillLoading() {
  const t = useTranslations("mill");
  return (
    <div className="space-y-6" aria-busy="true" aria-label={t("loading.board")}>
      {/* Header — mirrors PageHeader (title + subtitle, hairline divider). */}
      <div className="animate-rise relative mb-6 pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2.5">
            <div className="h-8 w-32 animate-pulse rounded-lg bg-muted" />
            <div className="h-4 w-80 max-w-full animate-pulse rounded bg-line" />
          </div>
          <div className="h-10 w-40 animate-pulse rounded-xl bg-muted" />
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
            <div className="h-7 w-12 animate-pulse rounded bg-muted" />
            <div className="h-3 w-24 animate-pulse rounded bg-line" />
          </div>
        ))}
      </div>

      {/* Dry-mill chain registry — five stage chips. */}
      <div className="glass-card space-y-4 rounded-2xl p-5">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="space-y-2 rounded-xl border border-forest/10 bg-paper/70 p-3"
            >
              <div className="h-8 w-8 animate-pulse rounded-lg bg-muted" />
              <div className="h-3 w-20 animate-pulse rounded bg-line" />
              <div className="h-3 w-14 animate-pulse rounded bg-line" />
            </div>
          ))}
        </div>
      </div>

      {/* Per-lot gate cards. */}
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
            <div className="h-12 animate-pulse rounded-xl bg-line" />
            <div className="h-4 w-40 animate-pulse rounded bg-line" />
          </div>
        ))}
      </div>
    </div>
  );
}
