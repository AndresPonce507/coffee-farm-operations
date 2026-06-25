/**
 * /hedge — instant route-loading skeleton.
 *
 * Rendered the moment the "/hedge" segment starts loading, swapped for the real
 * cockpit once page.tsx resolves. Mirrors that page's shape — header, a 4-up
 * exposure headline strip, then a grid of per-reservation glass cards — so the
 * layout never shifts under the user.
 *
 * Pure Server Component: no data, no client JS. The only motion is the Tailwind
 * `animate-pulse` shimmer, which the global `prefers-reduced-motion` rule already
 * neutralises. Uses the `hedge` namespace for its own aria label (so it never
 * depends on a key in another team's `common` dictionary).
 */
import { useTranslations } from "next-intl";

export default function HedgeLoading() {
  const t = useTranslations("hedge");
  return (
    <div className="space-y-6" aria-busy="true" aria-label={t("loading.label")}>
      {/* Header — mirrors PageHeader (title + subtitle, hairline divider). */}
      <div className="animate-rise relative mb-6 pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2.5">
            <div className="h-8 w-40 animate-pulse rounded-lg bg-muted" />
            <div className="h-4 w-80 animate-pulse rounded bg-line" />
          </div>
        </div>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      {/* Exposure headline strip — 4 KPI tiles in a divided glass card. */}
      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2.5 p-4">
            <div className="h-9 w-9 animate-pulse rounded-xl bg-muted" />
            <div className="h-3 w-20 animate-pulse rounded bg-line" />
            <div className="h-7 w-24 animate-pulse rounded bg-muted" />
            <div className="h-3 w-16 animate-pulse rounded bg-line" />
          </div>
        ))}
      </div>

      {/* A thin note line placeholder (the commodity-only rule). */}
      <div className="h-3 w-72 animate-pulse rounded bg-line" />

      {/* Per-reservation cards — a responsive grid of glass placeholders. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="glass-card space-y-4 rounded-2xl p-5">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                <div className="h-3 w-16 animate-pulse rounded bg-line" />
              </div>
              <div className="h-6 w-8 animate-pulse rounded-full bg-line" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 3 }).map((__, j) => (
                <div key={j} className="space-y-1.5">
                  <div className="h-3 w-12 animate-pulse rounded bg-line" />
                  <div className="h-5 w-14 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <div className="h-8 w-28 animate-pulse rounded-xl bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
