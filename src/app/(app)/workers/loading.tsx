/**
 * Instant route-level skeleton for "/workers".
 *
 * Server component, zero JS, no data imports — Next.js shows this immediately
 * while the real page streams in. It mirrors the page layout (header +
 * summary row + attendance/crew grid + roster table) with glass-card blocks
 * and gentle animate-pulse bars so the shell feels alive over the
 * LivingBackground rather than flashing empty.
 */
export default function WorkersLoading() {
  return (
    <div className="space-y-6 animate-rise" aria-busy="true" aria-hidden="true">
      {/* Header */}
      <div className="glass-card rounded-2xl p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-7 w-40 rounded-lg bg-muted" />
          <div className="h-4 w-64 rounded-md bg-line" />
        </div>
      </div>

      {/* Summary / KPI row */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass-card rounded-2xl p-5">
            <div className="animate-pulse space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-line" />
                <div className="h-3.5 w-24 rounded-md bg-line" />
              </div>
              <div className="h-8 w-20 rounded-lg bg-muted" />
              <div className="h-3 w-28 rounded-md bg-line" />
            </div>
          </div>
        ))}
      </div>

      {/* Attendance donut + crew board */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Attendance / donut card */}
        <div className="glass-card rounded-2xl p-6">
          <div className="animate-pulse space-y-5">
            <div className="h-4 w-32 rounded-md bg-muted" />
            <div className="flex items-center justify-center py-2">
              <div className="h-40 w-40 rounded-full bg-line" />
            </div>
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-line" />
                    <div className="h-3 w-24 rounded-md bg-line" />
                  </div>
                  <div className="h-3 w-10 rounded-md bg-muted" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Crew board */}
        <div className="lg:col-span-2">
          <div className="glass-card rounded-2xl p-6">
            <div className="animate-pulse space-y-5">
              <div className="h-4 w-28 rounded-md bg-muted" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-white/60 bg-white/55 p-4"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-line" />
                        <div className="h-3.5 w-24 rounded-md bg-muted" />
                      </div>
                      <div className="h-3 w-full rounded-md bg-line" />
                      <div className="h-3 w-2/3 rounded-md bg-line" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Roster table */}
      <div className="glass-card rounded-2xl p-6">
        <div className="animate-pulse space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div className="h-4 w-36 rounded-md bg-muted" />
            <div className="h-8 w-28 rounded-lg bg-line" />
          </div>

          {/* Column headings */}
          <div className="hidden grid-cols-12 gap-4 sm:grid">
            <div className="col-span-4 h-3 rounded-md bg-line" />
            <div className="col-span-3 h-3 rounded-md bg-line" />
            <div className="col-span-3 h-3 rounded-md bg-line" />
            <div className="col-span-2 h-3 rounded-md bg-line" />
          </div>

          {/* Rows */}
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="grid grid-cols-12 items-center gap-4 rounded-xl border border-white/60 bg-white/55 p-4"
              >
                <div className="col-span-4 flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-line" />
                  <div className="h-3.5 w-28 rounded-md bg-muted" />
                </div>
                <div className="col-span-3 h-3 rounded-md bg-line" />
                <div className="col-span-3 h-3 rounded-md bg-line" />
                <div className="col-span-2 h-6 w-16 rounded-full bg-line" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
