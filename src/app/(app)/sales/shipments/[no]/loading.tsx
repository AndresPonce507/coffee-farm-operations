/**
 * /sales/shipments/[no] — instant glass skeleton while the document pack streams in.
 * Server component (sync translator only, no data). Mirrors the detail layout:
 * back-link + header over the hairline divider + the 2-column story / doc-pack grid.
 * Pure animate-pulse the global reduced-motion rule neutralizes.
 */
import { useTranslations } from "next-intl";

export default function ShipmentDetailLoading() {
  const t = useTranslations("shipments");
  return (
    <div className="space-y-6" aria-busy="true" aria-label={t("loading.detail")}>
      <div className="h-5 w-36 animate-pulse rounded-lg bg-line" />

      <div className="relative mb-2 pb-4">
        <div className="h-3 w-32 animate-pulse rounded bg-line" />
        <div className="mt-2 space-y-2">
          <div className="h-7 w-56 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-80 max-w-full animate-pulse rounded bg-line" />
        </div>
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-6">
          <div className="glass-card h-56 animate-pulse rounded-2xl" />
          <div className="glass-card h-48 animate-pulse rounded-2xl" />
        </div>
        <div className="glass-card rounded-2xl p-5">
          <div className="h-6 w-40 animate-pulse rounded bg-muted" />
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-32 animate-pulse rounded-xl bg-line" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
