/**
 * /qc/cup/[lot] — instant glass skeleton while the cupping dossier streams in.
 * Server component (no hooks, no handlers, no data imports). Mirrors the
 * retrofitted <DossierShell>: back-link + eyebrow/title header over the hairline
 * divider + the 2-column cup-and-cause section (scoresheet + cause panel).
 * Pure animate-pulse over muted bars — zero client JS, reduced-motion safe.
 */
export default function CuppingLoading() {
  return (
    <div className="animate-pulse space-y-6" aria-hidden="true">
      {/* Back link */}
      <div className="h-5 w-48 rounded-lg bg-line" />

      {/* Header — eyebrow + title over the hairline divider */}
      <div className="relative mb-2 pb-4">
        <div className="h-3 w-20 rounded bg-line" />
        <div className="mt-2 space-y-2">
          <div className="h-7 w-48 rounded-lg bg-muted" />
          <div className="h-4 w-72 max-w-full rounded bg-line" />
        </div>
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent" />
      </div>

      {/* Cup-and-cause section — heading + 2-column grid */}
      <section className="space-y-3">
        <div className="h-5 w-40 rounded-md bg-muted" />
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-6">
            <div className="glass-card h-96 rounded-2xl" />
            <div className="glass-card h-44 rounded-2xl" />
          </div>
          <div className="glass-card h-[28rem] rounded-2xl" />
        </div>
      </section>
    </div>
  );
}
