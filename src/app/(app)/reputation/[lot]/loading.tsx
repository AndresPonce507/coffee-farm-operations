/**
 * /reputation/[lot] — instant glass skeleton while the ledger streams in.
 * Server component (no hooks beyond the sync translator, no data). Mirrors the detail
 * page: back-link + header over the hairline divider + the 2-column card/ledger ∥
 * composer grid. Pure animate-pulse the global reduced-motion rule neutralizes.
 */
import { useTranslations } from "next-intl";

export default function LotReputationLoading() {
  const t = useTranslations("reputation");
  return (
    <div className="space-y-6" aria-busy="true" aria-label={t("loading.detail")}>
      <div className="h-5 w-40 animate-pulse rounded-lg bg-line" />

      <div className="relative mb-2 pb-4">
        <div className="h-3 w-24 animate-pulse rounded bg-line" />
        <div className="mt-2 flex items-center gap-3">
          <div className="h-7 w-40 animate-pulse rounded-lg bg-muted" />
          <div className="h-6 w-28 animate-pulse rounded-full bg-muted" />
        </div>
        <div className="mt-2 h-4 w-72 max-w-full animate-pulse rounded bg-line" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <div className="glass-card h-40 animate-pulse rounded-2xl" />
          <div className="glass-card h-64 animate-pulse rounded-2xl" />
        </div>
        <div className="glass-card h-64 animate-pulse rounded-2xl" />
      </div>
    </div>
  );
}
