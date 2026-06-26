/**
 * /finance/invoices — instant board skeleton. Mirrors the header + the grid of AR
 * cards. Pure server component, reduced-motion-safe animate-pulse placeholders.
 */
import { useTranslations } from "next-intl";

export default function InvoicesLoading() {
  const t = useTranslations("finance");
  return (
    <div className="space-y-6" aria-busy="true" aria-label={t("loading.invoices")}>
      <div className="animate-rise relative mb-6 pb-4">
        <div className="space-y-2.5">
          <div className="h-8 w-36 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-80 max-w-full animate-pulse rounded bg-line" />
        </div>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="glass-card space-y-4 rounded-2xl p-5">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                <div className="h-3 w-28 animate-pulse rounded bg-line" />
              </div>
              <div className="h-6 w-20 animate-pulse rounded-full bg-muted" />
            </div>
            <div className="h-8 w-32 animate-pulse rounded-lg bg-muted" />
            <div className="grid grid-cols-2 gap-3">
              <div className="h-12 animate-pulse rounded-xl bg-line" />
              <div className="h-12 animate-pulse rounded-xl bg-line" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
