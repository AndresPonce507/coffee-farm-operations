/**
 * Drying — instant route-loading skeleton (P2-S4).
 *
 * Rendered the moment the "/drying" segment starts loading, then swapped for the
 * real page. Mirrors that page's shape — header, the resting-lots board, then the
 * stations board — so the layout never shifts. Pure server component: glassy
 * `animate-pulse` placeholders over the global LivingBackground, no data, no JS.
 */
import { useTranslations } from "next-intl";

export default function DryingLoading() {
  const t = useTranslations("common");
  return (
    <div className="space-y-6" aria-busy="true" aria-label={t("loading.drying")}>
      {/* Header — title + subtitle, hairline divider. */}
      <div className="animate-rise relative mb-6 pb-4">
        <div className="space-y-2.5">
          <div className="h-8 w-48 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-80 animate-pulse rounded bg-line" />
        </div>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      {/* Resting board — header + 2-up lot cards (curve + chip). */}
      <div className="glass-card animate-rise overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between gap-3 p-5">
          <div className="h-5 w-56 animate-pulse rounded-lg bg-muted" />
          <div className="h-6 w-24 animate-pulse rounded-full bg-line" />
        </div>
        <div className="grid grid-cols-1 gap-4 px-5 pb-5 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="space-y-3 rounded-2xl border border-white/55 bg-white/55 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="h-5 w-24 animate-pulse rounded bg-muted" />
                <div className="h-6 w-40 animate-pulse rounded-full bg-line" />
              </div>
              <div className="h-[140px] w-full animate-pulse rounded-xl bg-muted/70" />
              <div className="flex items-center justify-between gap-3">
                <div className="h-3.5 w-48 animate-pulse rounded bg-line" />
                <div className="h-7 w-28 animate-pulse rounded-full bg-muted" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stations board — header + 3-up capacity cards. */}
      <div className="glass-card animate-rise overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between gap-3 p-5">
          <div className="h-5 w-36 animate-pulse rounded-lg bg-muted" />
          <div className="h-6 w-20 animate-pulse rounded-full bg-line" />
        </div>
        <div className="grid grid-cols-1 gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-3 rounded-2xl border border-white/55 bg-white/55 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="h-4 w-28 animate-pulse rounded bg-muted" />
                <div className="h-5 w-16 animate-pulse rounded-full bg-line" />
              </div>
              <div className="h-3.5 w-full animate-pulse rounded-full bg-muted" />
              <div className="h-3 w-16 animate-pulse rounded bg-line" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
