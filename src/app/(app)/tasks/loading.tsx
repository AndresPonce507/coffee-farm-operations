/**
 * /tasks loading skeleton — instant glass placeholder shown by the App Router
 * while the Tasks route resolves. Mirrors the page's structure: page header,
 * a four-tile summary card, the four-column kanban board, and the task table.
 *
 * Server component. No data imports, no client JS — just glass-card surfaces
 * with muted bars that pulse, so the layout feels alive the moment you land.
 */
export default function TasksLoading() {
  return (
    <div className="space-y-6">
      {/* Header — title + subtitle on the left, "New task" action on the right */}
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2.5">
          <div className="h-7 w-32 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-56 animate-pulse rounded bg-line" />
        </div>
        <div className="h-9 w-28 animate-pulse rounded-xl bg-muted" />
      </div>

      {/* Summary — one card divided into four KPI tiles */}
      <div className="glass-card overflow-hidden rounded-2xl">
        <div className="grid grid-cols-1 divide-y divide-white/60 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex items-start justify-between gap-3 p-5"
            >
              <div className="space-y-2.5">
                <div className="h-3.5 w-20 animate-pulse rounded bg-line" />
                <div className="h-7 w-12 animate-pulse rounded-lg bg-muted" />
                <div className="h-3 w-24 animate-pulse rounded bg-line" />
              </div>
              <div className="h-9 w-9 shrink-0 animate-pulse rounded-xl bg-muted" />
            </div>
          ))}
        </div>
      </div>

      {/* Kanban board — four status columns of stacked task tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, col) => (
          <div
            key={col}
            className="glass-card flex flex-col rounded-2xl p-3"
          >
            <div className="mb-3 flex items-center justify-between px-1">
              <div className="h-4 w-20 animate-pulse rounded bg-muted" />
              <div className="h-6 w-6 animate-pulse rounded-full bg-line" />
            </div>

            <div className="flex flex-col gap-2.5">
              {Array.from({ length: 3 }).map((_, card) => (
                <div
                  key={card}
                  className="rounded-2xl border border-white/60 bg-white/55 p-3.5"
                >
                  <div className="mb-2.5 flex items-start justify-between gap-2">
                    <div className="h-5 w-24 animate-pulse rounded-full bg-line" />
                    <div className="mt-1.5 h-2 w-2 animate-pulse rounded-full bg-muted" />
                  </div>
                  <div className="h-4 w-11/12 animate-pulse rounded bg-muted" />
                  <div className="mt-1.5 h-3 w-2/3 animate-pulse rounded bg-line" />
                  <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-white/60 pt-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="h-6 w-6 shrink-0 animate-pulse rounded-full bg-muted" />
                      <div className="h-3 w-16 animate-pulse rounded bg-line" />
                    </div>
                    <div className="h-3 w-10 animate-pulse rounded bg-line" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Task table — header block + rows */}
      <div className="glass-card overflow-hidden rounded-2xl">
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="space-y-2">
            <div className="h-5 w-36 animate-pulse rounded bg-muted" />
            <div className="h-3.5 w-52 animate-pulse rounded bg-line" />
          </div>
        </div>
        <div className="px-5 py-5">
          {/* Column header row */}
          <div className="flex items-center gap-4 border-b border-line pb-3">
            {[40, 24, 20, 28, 24, 20].map((w, i) => (
              <div
                key={i}
                className="h-3 animate-pulse rounded bg-line"
                style={{ width: `${w * 4}px` }}
              />
            ))}
          </div>
          {/* Body rows */}
          <div className="divide-y divide-line">
            {Array.from({ length: 6 }).map((_, row) => (
              <div key={row} className="flex items-center gap-4 py-3.5">
                <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                <div className="h-5 w-20 animate-pulse rounded-full bg-line" />
                <div className="h-5 w-16 animate-pulse rounded-full bg-line" />
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 animate-pulse rounded-full bg-muted" />
                  <div className="h-3 w-16 animate-pulse rounded bg-line" />
                </div>
                <div className="h-3 w-20 animate-pulse rounded bg-line" />
                <div className="ml-auto h-5 w-16 animate-pulse rounded-full bg-line" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
