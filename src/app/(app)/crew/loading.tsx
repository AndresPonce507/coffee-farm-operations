/**
 * Crew — instant route-loading skeleton.
 *
 * Rendered by Next.js the moment the "/crew" segment starts loading, then swapped
 * for the real page once `page.tsx` resolves. Mirrors that page's shape — header, a
 * 3-up summary strip, then the crew roster board (crews as columns of glass
 * worker-cards) — so the layout never shifts under the user.
 *
 * Pure server component: no data imports, no client JS, no props. Glassy
 * `animate-pulse` placeholders float over the global LivingBackground.
 */
import { useTranslations } from "next-intl";

export default function CrewLoading() {
  const t = useTranslations("common");
  return (
    <div className="space-y-6" aria-busy="true" aria-label={t("loading.crew")}>
      {/* Header — mirrors PageHeader (title + subtitle, hairline divider). */}
      <div className="animate-rise relative mb-6 pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2.5">
            <div className="h-8 w-32 animate-pulse rounded-lg bg-muted" />
            <div className="h-4 w-80 animate-pulse rounded bg-line" />
          </div>
        </div>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      {/* Summary strip — 3 KPI tiles in a divided glass card. Mirrors CrewSummary's
          responsive grid (1 stacked column on mobile, 3-up from sm) so the layout
          never reflows when the data lands. */}
      <div className="glass-card grid grid-cols-1 gap-px overflow-hidden rounded-2xl sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2.5 p-4">
            <div className="h-9 w-9 animate-pulse rounded-xl bg-muted" />
            <div className="h-3 w-20 animate-pulse rounded bg-line" />
            <div className="h-7 w-16 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>

      {/* Roster board — crew columns of glass worker-cards (matches the real board:
          1 / sm:2 / xl:3, so the layout never reflows when the data lands). */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="glass-card space-y-3 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
              <div className="h-5 w-12 animate-pulse rounded-full bg-line" />
            </div>
            {Array.from({ length: 3 }).map((__, j) => (
              <div
                key={j}
                className="glass-card flex items-center gap-3 rounded-xl p-3"
              >
                <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-24 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-16 animate-pulse rounded bg-line" />
                </div>
                <div className="h-2 w-2 animate-pulse rounded-full bg-line" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
