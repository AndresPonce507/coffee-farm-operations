/**
 * /finance/sync — instant skeleton. Mirrors the header, the per-target health cards,
 * and the account-map / failed-posts two-column layout. Pure server component.
 */
import { useTranslations } from "next-intl";

export default function SyncLoading() {
  const t = useTranslations("finance");
  return (
    <div className="space-y-6" aria-busy="true" aria-label={t("loading.sync")}>
      <div className="animate-rise relative mb-6 pb-4">
        <div className="space-y-2.5">
          <div className="h-8 w-44 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-80 max-w-full animate-pulse rounded bg-line" />
        </div>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="glass-card space-y-4 rounded-2xl p-5">
            <div className="flex items-center justify-between">
              <div className="h-5 w-24 animate-pulse rounded bg-muted" />
              <div className="h-6 w-20 animate-pulse rounded-full bg-line" />
            </div>
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="h-12 animate-pulse rounded-lg bg-line" />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="glass-card space-y-3 rounded-2xl p-5">
            <div className="h-5 w-28 animate-pulse rounded bg-muted" />
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="h-10 animate-pulse rounded-xl bg-line" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
