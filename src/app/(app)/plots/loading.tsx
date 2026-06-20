/**
 * /plots — instant glass skeleton shown by Next.js while the route streams in.
 * Server component (no hooks, no handlers, no data imports). Mirrors the real
 * page: header bar + summary strip + filter toolbar + 3-col card grid + table.
 * Pure animate-pulse over muted bars inside glass-card surfaces — zero client JS.
 */
export default function PlotsLoading() {
  return (
    <div className="animate-pulse space-y-6" aria-hidden="true">
      {/* Header bar — title + subtitle over the hairline divider */}
      <div className="relative mb-6 pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <div className="h-7 w-32 rounded-lg bg-muted" />
            <div className="h-4 w-72 max-w-full rounded bg-line" />
          </div>
          <div className="h-9 w-28 rounded-xl bg-line" />
        </div>
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent" />
      </div>

      {/* Summary strip — one glass card, a 4-tile divided row */}
      <div className="glass-card overflow-hidden rounded-2xl">
        <div className="grid grid-cols-2 divide-x divide-y divide-white/60 md:grid-cols-4 md:divide-y-0">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 p-5">
              <div className="h-10 w-10 shrink-0 rounded-xl bg-line" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3 w-20 rounded bg-line" />
                <div className="h-6 w-16 rounded-md bg-muted" />
                <div className="h-3 w-14 rounded bg-line" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Explorer */}
      <section className="space-y-5">
        {/* Filter toolbar — variety chips + segmented view toggle */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {[16, 20, 18, 22, 16].map((w, i) => (
              <div
                key={i}
                className="h-8 rounded-full border border-white/60 bg-white/55"
                style={{ width: `${w * 4}px` }}
              />
            ))}
          </div>
          <div className="h-9 w-36 self-start rounded-xl border border-white/60 bg-white/55 sm:self-auto" />
        </div>

        {/* Result count line */}
        <div className="h-4 w-40 rounded bg-line" />

        {/* 3-col card grid */}
        <div className="perf-contain grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="glass-card flex flex-col overflow-hidden rounded-2xl"
            >
              {/* Header band */}
              <div className="space-y-3 border-b border-white/50 bg-forest-100/50 px-5 pt-5 pb-4">
                <div className="h-3 w-24 rounded bg-line" />
                <div className="h-5 w-40 max-w-full rounded-md bg-muted" />
                <div className="flex items-center gap-1.5">
                  <div className="h-5 w-16 rounded-full bg-line" />
                  <div className="h-5 w-20 rounded-full bg-line" />
                </div>
              </div>

              {/* Body — fact grid + progress */}
              <div className="flex flex-1 flex-col gap-4 p-5">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  {Array.from({ length: 4 }).map((__, j) => (
                    <div key={j} className="space-y-1.5">
                      <div className="h-2.5 w-14 rounded bg-line" />
                      <div className="h-4 w-20 rounded bg-muted" />
                    </div>
                  ))}
                </div>
                <div className="mt-auto space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="h-3 w-28 rounded bg-line" />
                    <div className="h-3 w-10 rounded bg-line" />
                  </div>
                  <div className="h-2 w-full rounded-full bg-line" />
                  <div className="h-3 w-32 rounded bg-line" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Table block — card with header + rows of cells */}
      <div className="glass-card overflow-hidden rounded-2xl">
        <div className="px-5 pt-5 pb-4">
          <div className="h-5 w-28 rounded-md bg-muted" />
        </div>
        <div className="px-5 pt-2 pb-5">
          {/* Header row */}
          <div className="hidden gap-4 border-b border-white/50 pb-3 sm:grid sm:grid-cols-9">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="h-3 rounded bg-line" />
            ))}
          </div>
          {/* Body rows */}
          <div className="divide-y divide-white/50">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="grid grid-cols-3 gap-4 py-4 sm:grid-cols-9 sm:items-center"
              >
                <div className="space-y-1.5">
                  <div className="h-4 w-24 rounded bg-muted" />
                  <div className="h-3 w-16 rounded bg-line" />
                </div>
                <div className="h-5 w-16 rounded-full bg-line" />
                <div className="hidden h-4 rounded bg-line sm:block" />
                <div className="hidden h-4 rounded bg-line sm:block" />
                <div className="hidden h-4 rounded bg-line sm:block" />
                <div className="hidden h-4 rounded bg-line sm:block" />
                <div className="hidden h-4 rounded bg-line sm:block" />
                <div className="h-5 w-20 rounded-full bg-line" />
                <div className="space-y-1.5">
                  <div className="ml-auto h-4 w-16 rounded bg-muted" />
                  <div className="ml-auto h-3 w-20 rounded bg-line" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
