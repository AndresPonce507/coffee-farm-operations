/**
 * /finance/invoices/[number] — instant invoice skeleton. Mirrors the header, the
 * 3-up totals strip, and the two-column line-items / payments layout. Pure server
 * component, reduced-motion-safe.
 */
import { useTranslations } from "next-intl";

export default function InvoiceLoading() {
  const t = useTranslations("finance");
  return (
    <div className="space-y-6" aria-busy="true" aria-label={t("loading.invoice")}>
      <div className="h-4 w-28 animate-pulse rounded bg-line" />

      <div className="animate-rise relative mb-2 pb-4">
        <div className="h-3 w-28 animate-pulse rounded bg-line" />
        <div className="mt-2 h-8 w-40 animate-pulse rounded-lg bg-muted" />
        <div className="mt-2 h-3 w-72 max-w-full animate-pulse rounded bg-line" />
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      <div className="glass-card grid grid-cols-3 gap-px overflow-hidden rounded-2xl">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2 p-4">
            <div className="h-3 w-16 animate-pulse rounded bg-line" />
            <div className="h-7 w-24 animate-pulse rounded-lg bg-muted" />
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="glass-card space-y-4 rounded-2xl p-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-line" />
          ))}
        </div>
        <div className="glass-card space-y-4 rounded-2xl p-5">
          <div className="h-10 animate-pulse rounded-xl bg-muted" />
          <div className="h-10 animate-pulse rounded-xl bg-line" />
        </div>
      </div>
    </div>
  );
}
