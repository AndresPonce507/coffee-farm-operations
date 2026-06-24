/**
 * Payroll — instant route-loading skeleton.
 *
 * Rendered the moment the "/payroll" segment starts loading, then swapped for the
 * real page. Mirrors that page's shape — header, a summary strip, then the
 * period-board + cockpit two-column grid — so the layout never shifts.
 *
 * Pure server component: no data imports, no client JS, no props.
 */
import { useTranslations } from "next-intl";

export default function PayrollLoading() {
  const t = useTranslations("common");
  return (
    <div className="space-y-6" aria-busy="true" aria-label={t("loading.payroll")}>
      {/* Header — mirrors PageHeader. */}
      <div className="animate-rise relative mb-6 pb-4">
        <div className="space-y-2.5">
          <div className="h-8 w-36 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-96 max-w-full animate-pulse rounded bg-line" />
        </div>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      {/* Summary strip — 4 stat tiles. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-line sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2 bg-card px-5 py-4">
            <div className="h-7 w-20 animate-pulse rounded bg-muted" />
            <div className="h-3 w-24 animate-pulse rounded bg-line" />
          </div>
        ))}
      </div>

      {/* Two-column: period board + cockpit. */}
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl bg-muted/70"
            />
          ))}
        </div>
        <div className="h-72 animate-pulse rounded-2xl bg-muted/60" />
      </div>
    </div>
  );
}
