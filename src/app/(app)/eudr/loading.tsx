/**
 * EUDR — instant route-loading skeleton.
 *
 * Rendered by Next.js the moment the "/eudr" segment starts loading, then
 * swapped for the real page once `page.tsx` resolves. Mirrors that page's shape
 * — header, a 3-up summary strip, then a grid of per-lot dossier cards — so the
 * layout never shifts under the user.
 *
 * Pure server component: no data imports, no client JS, no props. Glassy
 * `animate-pulse` placeholders float over the global LivingBackground.
 */
export default function EudrLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading EUDR">
      {/* Header — mirrors PageHeader (title + subtitle, hairline divider). */}
      <div className="animate-rise relative mb-6 pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2.5">
            <div className="h-8 w-32 animate-pulse rounded-lg bg-muted" />
            <div className="h-4 w-80 animate-pulse rounded bg-line" />
          </div>
        </div>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      {/* Summary strip — 3 KPI tiles in a divided glass card. */}
      <div className="glass-card grid grid-cols-1 gap-px overflow-hidden rounded-2xl sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2.5 p-4">
            <div className="h-9 w-9 animate-pulse rounded-xl bg-muted" />
            <div className="h-3 w-24 animate-pulse rounded bg-line" />
            <div className="h-7 w-20 animate-pulse rounded bg-muted" />
            <div className="h-3 w-28 animate-pulse rounded bg-line" />
          </div>
        ))}
      </div>

      {/* Per-lot dossier cards — a responsive grid of glass placeholders. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="glass-card space-y-3 rounded-2xl p-5">
            <div className="flex items-center justify-between">
              <div className="h-4 w-20 animate-pulse rounded bg-muted" />
              <div className="h-6 w-28 animate-pulse rounded-full bg-muted" />
            </div>
            <div className="h-3 w-32 animate-pulse rounded bg-line" />
          </div>
        ))}
      </div>
    </div>
  );
}
