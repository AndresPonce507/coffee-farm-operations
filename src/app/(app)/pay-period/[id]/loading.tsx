/**
 * Instant route-level skeleton for "/pay-period/[id]" (the pay-period dossier).
 *
 * Server component, zero JS, no data imports — Next.js shows this immediately
 * while the dossier streams in. Mirrors the DossierShell chrome (back-link +
 * eyebrow/title block) and the four stacked sections (resumen · líneas · ajuste
 * al mínimo · pagos) with glass-card blocks and gentle animate-pulse bars, so
 * navigation feels instant over the LivingBackground rather than flashing empty.
 * Reduced-motion inherited.
 */
export default function PayPeriodDossierLoading() {
  return (
    <div className="space-y-6 animate-rise" aria-busy="true" aria-hidden="true">
      {/* Back-link + title block */}
      <div className="h-4 w-40 rounded-md bg-line" />
      <div className="space-y-3 pb-4">
        <div className="h-3 w-28 rounded bg-line" />
        <div className="h-7 w-64 rounded-lg bg-muted" />
        <div className="h-4 w-48 rounded-md bg-line" />
      </div>

      {/* Four section placeholders */}
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="space-y-3">
          <div className="h-5 w-44 rounded-md bg-muted" />
          <div className="glass-card rounded-2xl p-5">
            <div className="animate-pulse space-y-4">
              <div className="h-4 w-2/3 rounded-md bg-line" />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="space-y-2">
                    <div className="h-3 w-16 rounded bg-line" />
                    <div className="h-5 w-20 rounded bg-muted" />
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
