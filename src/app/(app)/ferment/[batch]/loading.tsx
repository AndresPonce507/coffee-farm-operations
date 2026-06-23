/**
 * /ferment/[batch] — instant glass skeleton while the batch dossier streams in.
 * Server component (no hooks, no handlers, no data imports). Mirrors the
 * retrofitted <DossierShell>: back-link + eyebrow/title header over the hairline
 * divider + the tracker section (curve card + log-reading control).
 * Pure animate-pulse over muted bars — zero client JS, reduced-motion safe.
 */
export default function FermentBatchLoading() {
  return (
    <div className="animate-pulse space-y-6" aria-hidden="true">
      {/* Back link */}
      <div className="h-5 w-44 rounded-lg bg-line" />

      {/* Header — eyebrow + title over the hairline divider */}
      <div className="relative mb-2 pb-4">
        <div className="h-3 w-32 rounded bg-line" />
        <div className="mt-2 space-y-2">
          <div className="h-7 w-40 rounded-lg bg-muted" />
          <div className="h-4 w-80 max-w-full rounded bg-line" />
        </div>
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent" />
      </div>

      {/* Tracker section — heading + a tall curve card */}
      <section className="space-y-3">
        <div className="h-5 w-56 rounded-md bg-muted" />
        <div className="glass-card h-80 rounded-2xl" />
        <div className="glass-card h-24 rounded-2xl" />
      </section>
    </div>
  );
}
