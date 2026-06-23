/**
 * /plots/[id] — instant glass skeleton shown while the dossier streams in
 * (facet-02 P7). Server component (no hooks, no handlers, no data imports).
 * Mirrors the DossierShell chrome: back-link + eyebrow/title header over the
 * forest hairline divider, then a stack of glass-card section placeholders.
 * Pure animate-pulse over muted bars — zero client JS, reduced-motion inherited.
 */
export default function PlotDossierLoading() {
  return (
    <div className="animate-pulse space-y-6" aria-hidden="true">
      {/* Back-link */}
      <div className="h-5 w-32 rounded-lg bg-line" />

      {/* Header — eyebrow + title over the hairline divider */}
      <div className="relative mb-2 pb-4">
        <div className="h-3 w-12 rounded bg-line" />
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <div className="h-7 w-48 rounded-lg bg-muted" />
            <div className="h-4 w-64 max-w-full rounded bg-line" />
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent" />
      </div>

      {/* Section stack — heading + glass-card body, repeated */}
      <div className="space-y-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <section key={i} className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-5 w-40 rounded-md bg-muted" />
              <div className="h-5 w-8 rounded-full bg-line" />
            </div>
            <div className="glass-card rounded-2xl p-5">
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                {Array.from({ length: 6 }).map((__, j) => (
                  <div key={j} className="space-y-1.5">
                    <div className="h-2.5 w-16 rounded bg-line" />
                    <div className="h-4 w-24 rounded bg-muted" />
                  </div>
                ))}
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
