/**
 * /crm/[id] — instant contact-sheet loading skeleton.
 *
 * Mirrors the sheet's shape — back link, header with fact strip, then the two-rail
 * timeline + actions layout — so the layout never shifts. Pure server component.
 */
import { useTranslations } from "next-intl";

export default function ContactSheetLoading() {
  const t = useTranslations("crm");
  return (
    <div className="space-y-6" aria-busy="true" aria-label={t("loading.sheet")}>
      <div className="h-5 w-28 animate-pulse rounded bg-line" />

      <div className="animate-rise relative mb-2 pb-4">
        <div className="h-3 w-16 animate-pulse rounded bg-line" />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <div className="h-8 w-48 animate-pulse rounded-lg bg-muted" />
          <div className="h-6 w-20 animate-pulse rounded-full bg-muted" />
          <div className="h-6 w-24 animate-pulse rounded-full bg-muted" />
        </div>
        <div className="mt-3 flex gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-3 w-24 animate-pulse rounded bg-line" />
          ))}
        </div>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <div className="glass-card space-y-4 rounded-2xl p-5">
            <div className="h-4 w-40 animate-pulse rounded bg-muted" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-32 animate-pulse rounded bg-line" />
                  <div className="h-3 w-48 animate-pulse rounded bg-line" />
                </div>
              </div>
            ))}
          </div>
          <div className="glass-card space-y-3 rounded-2xl p-5">
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
            <div className="h-12 animate-pulse rounded-xl bg-line" />
          </div>
        </div>
        <div className="glass-card space-y-4 rounded-2xl p-5">
          <div className="h-4 w-28 animate-pulse rounded bg-muted" />
          <div className="h-11 animate-pulse rounded-xl bg-line" />
          <div className="h-11 animate-pulse rounded-xl bg-line" />
          <div className="h-10 animate-pulse rounded-xl bg-muted" />
        </div>
      </div>
    </div>
  );
}
