/**
 * Processing — instant route-loading skeleton.
 *
 * Rendered by Next.js the moment the "/processing" segment starts loading, then
 * swapped for the real page once `page.tsx` resolves. It mirrors that page's
 * shape — header, a 4-up summary strip, the horizontal stage kanban, then the
 * full batch ledger — so the layout never shifts under the user.
 *
 * Pure server component: no data imports, no client JS, no props. Just glassy
 * `animate-pulse` placeholders floating over the global LivingBackground, sized
 * to match what lands. The muted/line bars stand in for text and numbers.
 */
export default function ProcessingLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading processing">
      {/* Header — mirrors PageHeader (title + subtitle, hairline divider). */}
      <div className="animate-rise relative mb-6 pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2.5">
            <div className="h-8 w-44 animate-pulse rounded-lg bg-muted" />
            <div className="h-4 w-64 animate-pulse rounded bg-line" />
          </div>
        </div>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      {/* Summary strip — 4 KPI tiles in a divided glass card. */}
      <div className="glass-card animate-rise overflow-hidden rounded-2xl">
        <div className="grid grid-cols-2 divide-y divide-white/50 lg:grid-cols-4 lg:divide-x lg:divide-y-0">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-3 p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="h-3.5 w-24 animate-pulse rounded bg-line" />
                <div className="h-9 w-9 animate-pulse rounded-xl bg-muted" />
              </div>
              <div className="h-7 w-20 animate-pulse rounded-lg bg-muted" />
              <div className="h-3 w-28 animate-pulse rounded bg-line" />
            </div>
          ))}
        </div>
      </div>

      {/* Stage pipeline — horizontal kanban: section title + 6 columns. */}
      <div className="animate-rise">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <div className="space-y-2">
            <div className="h-6 w-52 animate-pulse rounded-lg bg-muted" />
            <div className="h-4 w-72 animate-pulse rounded bg-line" />
          </div>
          <div className="hidden h-3.5 w-28 animate-pulse rounded bg-line sm:block" />
        </div>

        <div className="-mx-1 overflow-x-auto px-1 pb-2">
          <div className="flex min-w-max gap-3">
            {Array.from({ length: 6 }).map((_, col) => (
              <div
                key={col}
                className="glass-card flex min-w-[230px] flex-1 flex-col rounded-2xl p-3"
              >
                {/* Column header — dot + title + count, with a tinted rail. */}
                <div className="px-1 pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 animate-pulse rounded-full bg-muted" />
                      <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                    </div>
                    <div className="h-5 w-7 animate-pulse rounded-full bg-line" />
                  </div>
                  <div className="mt-1.5 ml-4 h-3 w-28 animate-pulse rounded bg-line" />
                  <div className="mt-2 h-0.5 w-full animate-pulse rounded-full bg-line" />
                </div>

                {/* Two placeholder batch tiles per column. */}
                <div className="flex flex-col gap-2.5">
                  {Array.from({ length: 2 }).map((__, tile) => (
                    <div
                      key={tile}
                      className="space-y-3 rounded-xl border border-white/60 bg-white/55 p-3.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="h-4 w-20 animate-pulse rounded bg-muted" />
                        <div className="h-3 w-12 animate-pulse rounded bg-line" />
                      </div>
                      <div className="flex gap-1.5">
                        <div className="h-5 w-16 animate-pulse rounded-full bg-line" />
                        <div className="h-5 w-14 animate-pulse rounded-full bg-line" />
                      </div>
                      <div className="flex items-end justify-between gap-2">
                        <div className="h-6 w-16 animate-pulse rounded bg-muted" />
                        <div className="h-4 w-12 animate-pulse rounded bg-line" />
                      </div>
                      <div className="h-1.5 w-full animate-pulse rounded-full bg-line" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Batch ledger — glass card with a header and a row block. */}
      <div className="glass-card animate-rise overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between gap-3 p-5">
          <div className="space-y-2">
            <div className="h-5 w-32 animate-pulse rounded-lg bg-muted" />
            <div className="h-3.5 w-64 animate-pulse rounded bg-line" />
          </div>
          <div className="h-6 w-20 animate-pulse rounded-full bg-line" />
        </div>

        <div className="px-5 pb-5 pt-1">
          {/* Header row. */}
          <div className="flex items-center gap-4 border-b border-line/70 pb-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-3.5 flex-1 animate-pulse rounded bg-line"
              />
            ))}
          </div>

          {/* Body rows. */}
          <div className="divide-y divide-line/50">
            {Array.from({ length: 8 }).map((_, row) => (
              <div key={row} className="flex items-center gap-4 py-3.5">
                {Array.from({ length: 6 }).map((__, cell) => (
                  <div
                    key={cell}
                    className="h-4 flex-1 animate-pulse rounded bg-muted"
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
