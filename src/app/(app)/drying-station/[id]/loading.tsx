/**
 * /drying-station/[id] — instant dossier-loading skeleton (P7). Mirrors the
 * <DossierShell> shape (back-link + eyebrow/title block + three section placeholders:
 * capacity, lots, weather) so the layout never shifts. Pure server component.
 */
import { useTranslations } from "next-intl";

export default function DryingStationDossierLoading() {
  const t = useTranslations("common");
  return (
    <div className="space-y-6" aria-busy="true" aria-label={t("loading.dryingStationDetail")}>
      {/* Back link */}
      <div className="h-5 w-40 animate-pulse rounded-lg bg-line" />

      {/* Header — eyebrow + title + subtitle. */}
      <div className="animate-rise relative mb-2 pb-4">
        <div className="h-3 w-20 animate-pulse rounded bg-line" />
        <div className="mt-2 space-y-2.5">
          <div className="h-8 w-48 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-64 animate-pulse rounded bg-line" />
        </div>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      {/* Capacity card */}
      <div className="glass-card h-44 animate-pulse rounded-2xl bg-muted/40" />

      {/* Lots grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass-card h-24 animate-pulse rounded-2xl bg-muted/40" />
        ))}
      </div>
    </div>
  );
}
