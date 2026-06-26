/**
 * /p/[slug] — instant glass skeleton for the public provenance microsite.
 *
 * Rendered the moment the segment starts loading, swapped for the real story once
 * the resolver returns. Mirrors the page shape (forest hero, cup-score dial, story
 * cards) so the layout never shifts. Pure server component; animate-pulse the global
 * reduced-motion rule neutralizes. aria-busy/label keep it announced to AT.
 */
import { useTranslations } from "next-intl";

export default function ProvenanceLoading() {
  const t = useTranslations("provenance");
  return (
    <main
      className="min-h-screen bg-paper"
      aria-busy="true"
      aria-label={t("public.eyebrow")}
    >
      {/* Hero band */}
      <div className="glass-forest px-5 py-14 md:px-8 md:py-20">
        <div className="mx-auto w-full max-w-3xl space-y-3">
          <div className="h-3 w-40 animate-pulse rounded bg-paper/20" />
          <div className="h-10 w-72 max-w-full animate-pulse rounded-lg bg-paper/25" />
          <div className="h-4 w-56 animate-pulse rounded bg-paper/15" />
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl space-y-8 px-5 py-10 md:px-8 md:py-12">
        {/* Quality strip */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[auto_1fr]">
          <div className="glass-card h-44 w-full animate-pulse rounded-2xl sm:w-44" />
          <div className="glass-card h-44 animate-pulse rounded-2xl" />
        </div>
        {/* Banner + sections */}
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass-card space-y-3 rounded-2xl p-5">
            <div className="h-5 w-40 animate-pulse rounded bg-muted" />
            <div className="h-4 w-full animate-pulse rounded bg-line" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-line" />
          </div>
        ))}
      </div>
    </main>
  );
}
