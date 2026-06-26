/**
 * /mill/[runId] — instant glass skeleton while the finalize panel streams in.
 * Server component (sync translator only, no data). Mirrors the page: back-link +
 * header over the hairline divider + the KPI strip + the 2-column balance/surface grid.
 * Pure animate-pulse the global reduced-motion rule neutralizes.
 */
import { useTranslations } from "next-intl";

export default function FinalizeLoading() {
  const t = useTranslations("millFinalize");
  return (
    <div className="space-y-6" aria-busy="true" aria-label={t("loading.finalize")}>
      <div className="h-5 w-36 animate-pulse rounded-lg bg-line" />

      <div className="relative mb-2 pb-4">
        <div className="h-3 w-24 animate-pulse rounded bg-line" />
        <div className="mt-2 space-y-2">
          <div className="h-7 w-52 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-64 max-w-full animate-pulse rounded bg-line" />
        </div>
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent" />
      </div>

      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="p-4">
            <div className="h-9 w-9 animate-pulse rounded-xl bg-muted" />
            <div className="mt-3 h-3 w-16 animate-pulse rounded bg-line" />
            <div className="mt-2 h-6 w-20 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="glass-card h-72 animate-pulse rounded-2xl" />
        <div className="glass-card h-96 animate-pulse rounded-2xl" />
      </div>
    </div>
  );
}
