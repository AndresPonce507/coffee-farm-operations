/**
 * Route-level loading skeleton for the Coffee Farm Operations dashboard ("/").
 *
 * Mirrors the dashboard layout (page.tsx): a season hero band, the four headline
 * KPIs, then a 12-column grid whose left rail (2 cols) leads with the yield-trend
 * chart and pairs plot-health with the processing pipeline, while the right rail
 * stacks variety mix, weather, and recent activity.
 *
 * Pure server component — no data imports, no client JS. Glass-card blocks with
 * animate-pulse + muted bars give an instant, on-brand shimmer over the global
 * LivingBackground while the real route streams in.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-rise">
      {/* Season hero band */}
      <div className="glass-card rounded-2xl p-6 sm:p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-3">
            <div className="h-4 w-32 animate-pulse rounded-full bg-line" />
            <div className="h-8 w-64 animate-pulse rounded-lg bg-muted" />
            <div className="h-4 w-48 animate-pulse rounded-full bg-line" />
          </div>
          <div className="flex gap-3">
            <div className="h-16 w-24 animate-pulse rounded-xl bg-muted" />
            <div className="h-16 w-24 animate-pulse rounded-xl bg-muted" />
          </div>
        </div>
      </div>

      {/* 4-up KPI row */}
      <div className="grid grid-cols-1 gap-6 perf-contain sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass-card rounded-2xl p-5">
            <div className="flex items-center justify-between">
              <div className="h-4 w-24 animate-pulse rounded-full bg-line" />
              <div className="h-9 w-9 animate-pulse rounded-xl bg-muted" />
            </div>
            <div className="mt-4 h-7 w-28 animate-pulse rounded-lg bg-muted" />
            <div className="mt-3 h-3 w-20 animate-pulse rounded-full bg-line" />
          </div>
        ))}
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left rail — spans two of the three columns */}
        <div className="space-y-6 lg:col-span-2">
          {/* Yield trend chart */}
          <div className="glass-card rounded-2xl p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <div className="h-5 w-40 animate-pulse rounded-lg bg-muted" />
                <div className="h-3 w-28 animate-pulse rounded-full bg-line" />
              </div>
              <div className="h-8 w-28 animate-pulse rounded-full bg-line" />
            </div>
            <div className="mt-6 h-56 animate-pulse rounded-xl bg-muted" />
          </div>

          {/* Plot health + processing pipeline */}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="glass-card rounded-2xl p-6">
                <div className="h-5 w-32 animate-pulse rounded-lg bg-muted" />
                <div className="mt-5 space-y-4">
                  {Array.from({ length: 4 }).map((__, j) => (
                    <div key={j} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="h-3 w-20 animate-pulse rounded-full bg-line" />
                        <div className="h-3 w-10 animate-pulse rounded-full bg-line" />
                      </div>
                      <div className="h-2.5 w-full animate-pulse rounded-full bg-muted" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right rail — single column */}
        <div className="space-y-6">
          {/* Variety mix */}
          <div className="glass-card rounded-2xl p-6">
            <div className="h-5 w-32 animate-pulse rounded-lg bg-muted" />
            <div className="mt-6 flex items-center justify-center">
              <div className="h-36 w-36 animate-pulse rounded-full bg-muted" />
            </div>
            <div className="mt-6 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="h-3 w-24 animate-pulse rounded-full bg-line" />
                  <div className="h-3 w-12 animate-pulse rounded-full bg-line" />
                </div>
              ))}
            </div>
          </div>

          {/* Weather strip */}
          <div className="glass-card rounded-2xl p-6">
            <div className="h-5 w-28 animate-pulse rounded-lg bg-muted" />
            <div className="mt-5 grid grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2 rounded-xl border border-white/60 bg-white/55 p-3">
                  <div className="mx-auto h-3 w-8 animate-pulse rounded-full bg-line" />
                  <div className="mx-auto h-8 w-8 animate-pulse rounded-full bg-muted" />
                  <div className="mx-auto h-3 w-6 animate-pulse rounded-full bg-line" />
                </div>
              ))}
            </div>
          </div>

          {/* Activity feed */}
          <div className="glass-card rounded-2xl p-6">
            <div className="h-5 w-32 animate-pulse rounded-lg bg-muted" />
            <div className="mt-5 space-y-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-full animate-pulse rounded-full bg-line" />
                    <div className="h-3 w-2/3 animate-pulse rounded-full bg-line" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
