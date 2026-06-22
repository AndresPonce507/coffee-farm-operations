/**
 * /crew/[id] — instant dossier-loading skeleton (P7).
 *
 * Rendered by Next.js the moment the segment starts loading, then swapped for the
 * real dossier once page.tsx resolves. Mirrors the <DossierShell> shape (back-link
 * + eyebrow/title block + four section placeholders: roster, plots, dispatch,
 * productivity) so the layout never shifts under the user. Pure server component:
 * no data imports, no client JS, no props. Glassy animate-pulse placeholders float
 * over the global LivingBackground; animate-rise respects prefers-reduced-motion.
 */
export default function CrewDossierLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Cargando cuadrilla">
      {/* Back link */}
      <div className="h-5 w-40 animate-pulse rounded-lg bg-line" />

      {/* Header — eyebrow + title + subtitle, hairline divider. */}
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

      {/* Four section placeholders. */}
      {Array.from({ length: 4 }).map((_, s) => (
        <div key={s} className="space-y-3">
          <div className="h-5 w-40 animate-pulse rounded bg-muted" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((__, i) => (
              <div
                key={i}
                className="glass-card flex items-center gap-3 rounded-2xl p-3.5"
              >
                <div className="h-9 w-9 animate-pulse rounded-xl bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-28 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-20 animate-pulse rounded bg-line" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
