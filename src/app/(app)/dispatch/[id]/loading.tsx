/**
 * /dispatch/[id] — instant route-loading skeleton.
 *
 * Rendered the moment the dispatch-run dossier segment starts loading, then
 * swapped for the real page. Mirrors the dossier shape — back-link, eyebrow +
 * title, then four glass section placeholders (run / assignments / ack /
 * lifecycle) — so the layout never shifts under the user. Pure Server Component:
 * no data, no client JS. Glassy animate-pulse placeholders float over the global
 * LivingBackground; reduced-motion is inherited from globals.css.
 */
export default function DispatchDossierLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Cargando despacho">
      {/* Back-link placeholder. */}
      <div className="h-5 w-40 animate-pulse rounded bg-line" />

      {/* Header — eyebrow + title + subtitle, hairline divider. */}
      <div className="animate-rise relative mb-2 pb-4">
        <div className="h-3 w-20 animate-pulse rounded bg-line" />
        <div className="mt-2 space-y-2.5">
          <div className="h-8 w-48 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-72 animate-pulse rounded bg-line" />
        </div>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      {/* Four section placeholders mirroring the real stack. */}
      <div className="space-y-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-3">
            <div className="h-5 w-32 animate-pulse rounded bg-muted" />
            <div className="glass-card space-y-3 rounded-2xl p-5">
              <div className="h-5 w-40 animate-pulse rounded bg-muted" />
              <div className="h-4 w-full animate-pulse rounded bg-line" />
              <div className="h-4 w-2/3 animate-pulse rounded bg-line" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
