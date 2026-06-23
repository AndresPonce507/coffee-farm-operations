/**
 * Instant route-level skeleton for "/workers/[id]" (the worker dossier).
 *
 * Server component, zero JS, no data imports — Next.js shows this immediately
 * while the dossier streams in. Mirrors the DossierShell chrome (back-link +
 * eyebrow/title block) and the five stacked sections with glass-card blocks and
 * gentle animate-pulse bars, so navigation feels instant over the
 * LivingBackground rather than flashing empty. Reduced-motion inherited.
 */
export default function WorkerDossierLoading() {
  return (
    <div className="space-y-6 animate-rise" aria-busy="true" aria-hidden="true">
      {/* Back-link + title block */}
      <div className="h-4 w-44 rounded-md bg-line" />
      <div className="space-y-3 pb-4">
        <div className="h-3 w-24 rounded bg-line" />
        <div className="h-7 w-56 rounded-lg bg-muted" />
        <div className="h-4 w-40 rounded-md bg-line" />
      </div>

      {/* Five section placeholders */}
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="space-y-3">
          <div className="h-5 w-40 rounded-md bg-muted" />
          <div className="glass-card rounded-2xl p-5">
            <div className="animate-pulse space-y-4">
              <div className="h-4 w-2/3 rounded-md bg-line" />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="space-y-2">
                    <div className="h-3 w-16 rounded bg-line" />
                    <div className="h-4 w-20 rounded bg-muted" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
