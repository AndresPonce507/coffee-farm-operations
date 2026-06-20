/**
 * /harvests — instant glass skeleton.
 *
 * Server component rendered by the App Router while HarvestsPage and its
 * sections resolve. Mirrors the page layout (header → KPI summary →
 * 2/3 trend + 1/3 leaderboard → traceability log) with translucent
 * glass-card blocks and muted pulsing bars, so the route paints a
 * stable, on-brand frame the instant it is navigated to. No data, no
 * client JS — pure markup over the global LivingBackground.
 */
export default function HarvestsLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-card rounded-2xl p-6">
        <div className="h-7 w-44 animate-pulse rounded-lg bg-muted" />
        <div className="mt-3 h-4 w-72 max-w-full animate-pulse rounded-md bg-line" />
      </div>

      {/* KPI / summary row */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass-card rounded-2xl p-6">
            <div className="h-4 w-24 animate-pulse rounded-md bg-line" />
            <div className="mt-4 h-8 w-28 animate-pulse rounded-lg bg-muted" />
            <div className="mt-3 h-3 w-20 animate-pulse rounded bg-line" />
          </div>
        ))}
      </div>

      {/* 2/3 trend chart + 1/3 leaderboard */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="glass-card rounded-2xl p-6 lg:col-span-2">
          <div className="h-5 w-40 animate-pulse rounded-md bg-muted" />
          <div className="mt-2 h-3 w-56 max-w-full animate-pulse rounded bg-line" />
          <div className="mt-6 flex h-56 items-end gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="flex-1 animate-pulse rounded-t-lg bg-muted"
                style={{ height: `${35 + ((i * 37) % 60)}%` }}
              />
            ))}
          </div>
        </div>

        <div className="glass-card rounded-2xl p-6">
          <div className="h-5 w-32 animate-pulse rounded-md bg-muted" />
          <div className="mt-2 h-3 w-44 max-w-full animate-pulse rounded bg-line" />
          <div className="mt-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-xl border border-white/60 bg-white/55 p-3"
              >
                <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
                <div className="min-w-0 flex-1">
                  <div className="h-4 w-28 max-w-full animate-pulse rounded bg-muted" />
                  <div className="mt-2 h-3 w-20 animate-pulse rounded bg-line" />
                </div>
                <div className="h-4 w-12 shrink-0 animate-pulse rounded bg-line" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Traceability log table */}
      <div className="glass-card rounded-2xl p-6">
        <div className="h-5 w-36 animate-pulse rounded-md bg-muted" />
        <div className="mt-2 h-3 w-52 max-w-full animate-pulse rounded bg-line" />

        {/* Header row */}
        <div className="mt-6 hidden gap-4 border-b border-line/70 pb-3 sm:grid sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-3 w-full max-w-[80px] animate-pulse rounded bg-line" />
          ))}
        </div>

        {/* Body rows */}
        <div className="mt-2 space-y-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="grid grid-cols-2 gap-4 border-b border-line/40 py-3 sm:grid-cols-5"
            >
              {Array.from({ length: 5 }).map((_, j) => (
                <div
                  key={j}
                  className="h-4 animate-pulse rounded bg-muted"
                  style={{ width: `${60 + ((i + j) * 13) % 35}%` }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
