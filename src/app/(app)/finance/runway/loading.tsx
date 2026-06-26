/**
 * /finance/runway — instant skeleton. Mirrors the header, the 3-up tiles, the
 * waterfall, and the pre-harvest cells. Pure server component, reduced-motion-safe.
 */
import { useTranslations } from "next-intl";

export default function RunwayLoading() {
  const t = useTranslations("finance");
  return (
    <div className="space-y-6" aria-busy="true" aria-label={t("loading.runway")}>
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

      <div className="glass-card grid grid-cols-3 gap-px overflow-hidden rounded-2xl">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2 p-4">
            <div className="h-8 w-8 animate-pulse rounded-lg bg-muted" />
            <div className="h-3 w-16 animate-pulse rounded bg-line" />
            <div className="h-7 w-24 animate-pulse rounded-lg bg-muted" />
          </div>
        ))}
      </div>

      <div className="glass-card space-y-4 rounded-2xl p-5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-3 w-24 animate-pulse rounded bg-line" />
            <div className="h-3 w-full animate-pulse rounded-full bg-muted" />
          </div>
        ))}
      </div>

      <div className="glass-card grid grid-cols-1 gap-3 rounded-2xl p-5 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-line" />
        ))}
      </div>
    </div>
  );
}
