/**
 * /storage — instant route-loading skeleton.
 *
 * Rendered the moment the segment starts loading, swapped for the real dashboard once
 * page.tsx resolves. Mirrors that page's shape — header, a 4-up summary strip, a
 * two-column gauge cluster + console, then the certificate log — so the layout never
 * shifts under the user. Pure server component: no data, no client JS. Glassy
 * animate-pulse placeholders the global reduced-motion rule neutralizes.
 */
import { useTranslations } from "next-intl";

export default function StorageLoading() {
  const t = useTranslations("storage");
  return (
    <div className="space-y-6" aria-busy="true" aria-label={t("loading.board")}>
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
            <div className="h-7 w-16 animate-pulse rounded bg-muted" />
            <div className="h-3 w-24 animate-pulse rounded bg-line" />
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass-card space-y-4 rounded-2xl p-5">
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-12 animate-pulse rounded bg-line" />
                </div>
                <div className="h-6 w-20 animate-pulse rounded-full bg-muted" />
              </div>
              {Array.from({ length: 3 }).map((__, j) => (
                <div key={j} className="space-y-2">
                  <div className="h-3 w-full animate-pulse rounded bg-line" />
                  <div className="h-2 w-full animate-pulse rounded-full bg-line" />
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="glass-card space-y-3 rounded-2xl p-5">
          <div className="h-5 w-28 animate-pulse rounded bg-muted" />
          <div className="h-8 w-full animate-pulse rounded-lg bg-line" />
          <div className="h-11 w-full animate-pulse rounded-xl bg-line" />
          <div className="h-11 w-full animate-pulse rounded-xl bg-line" />
        </div>
      </div>

      <div className="glass-card space-y-3 rounded-2xl p-5">
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-14 w-full animate-pulse rounded-xl bg-line" />
        ))}
      </div>
    </div>
  );
}
