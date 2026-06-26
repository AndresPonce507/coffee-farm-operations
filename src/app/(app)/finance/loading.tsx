/**
 * /finance — instant cockpit skeleton. Mirrors the real layout (header, 4-up stat
 * strip, aging board + sync-health rail) so nothing shifts under the user. Pure
 * server component, glassy animate-pulse placeholders the reduced-motion rule
 * neutralizes.
 */
import { useTranslations } from "next-intl";

export default function FinanceLoading() {
  const t = useTranslations("finance");
  return (
    <div className="space-y-6" aria-busy="true" aria-label={t("loading.cockpit")}>
      <div className="animate-rise relative mb-6 pb-4">
        <div className="space-y-2.5">
          <div className="h-8 w-32 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-80 max-w-full animate-pulse rounded bg-line" />
        </div>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2.5 p-4">
            <div className="h-9 w-9 animate-pulse rounded-xl bg-muted" />
            <div className="h-3 w-20 animate-pulse rounded bg-line" />
            <div className="h-7 w-24 animate-pulse rounded bg-muted" />
            <div className="h-3 w-28 animate-pulse rounded bg-line" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass-card space-y-3 rounded-2xl p-4">
              <div className="flex items-start justify-between">
                <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                <div className="h-6 w-20 animate-pulse rounded-full bg-line" />
              </div>
              <div className="h-6 w-28 animate-pulse rounded-lg bg-muted" />
            </div>
          ))}
        </div>
        <div className="glass-card space-y-3 rounded-2xl p-4">
          <div className="h-6 w-28 animate-pulse rounded-full bg-muted" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded-xl bg-line" />
          ))}
        </div>
      </div>
    </div>
  );
}
