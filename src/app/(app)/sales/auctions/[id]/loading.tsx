/**
 * /sales/auctions/[id] — instant glass skeleton while the auction workspace streams.
 * Server component (sync translator only, no data). Mirrors the detail page: back
 * link + header over the hairline divider + the 2-column round/enter grid. Pure
 * animate-pulse the global reduced-motion rule neutralizes.
 */
import { useTranslations } from "next-intl";

export default function AuctionDetailLoading() {
  const t = useTranslations("auctions");
  return (
    <div className="space-y-6" aria-busy="true" aria-label={t("loading.detail")}>
      <div className="h-5 w-36 animate-pulse rounded-lg bg-line" />

      <div className="relative mb-2 pb-4">
        <div className="h-3 w-40 animate-pulse rounded bg-line" />
        <div className="mt-2 space-y-2">
          <div className="h-7 w-56 animate-pulse rounded-lg bg-muted" />
          <div className="h-3 w-64 max-w-full animate-pulse rounded bg-line" />
        </div>
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <div className="h-5 w-40 animate-pulse rounded bg-line" />
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="glass-card space-y-4 rounded-2xl p-5">
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-16 animate-pulse rounded bg-line" />
                </div>
                <div className="h-6 w-16 animate-pulse rounded-full bg-muted" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="h-12 animate-pulse rounded-xl bg-line" />
                <div className="h-12 animate-pulse rounded-xl bg-line" />
                <div className="h-12 animate-pulse rounded-xl bg-line" />
              </div>
              <div className="h-16 animate-pulse rounded-xl bg-line" />
            </div>
          ))}
        </div>
        <div className="glass-card h-80 animate-pulse rounded-2xl" />
      </div>
    </div>
  );
}
