/**
 * /mill/[runId]/balance — instant route-loading skeleton.
 *
 * Rendered the moment the segment starts loading, swapped for the real workspace
 * once page.tsx resolves. Mirrors that page's shape — header, a 4-up summary strip,
 * then the gauge + machine-chain rail on the left and the recorder island on the
 * right — so the layout never shifts under the operator. Pure Server Component: no
 * data, no client JS. Glassy animate-pulse placeholders the global reduced-motion
 * rule neutralizes.
 */
import { useTranslations } from "next-intl";

export default function MillBalanceLoading() {
  const t = useTranslations("millBalance");
  return (
    <div className="space-y-6" aria-busy="true" aria-label={t("loading.workspace")}>
      {/* header */}
      <div className="animate-rise relative mb-2 pb-4">
        <div className="space-y-2.5">
          <div className="h-3 w-20 animate-pulse rounded bg-line" />
          <div className="h-8 w-40 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-72 max-w-full animate-pulse rounded bg-line" />
        </div>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      {/* summary strip */}
      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2.5 p-4">
            <div className="h-9 w-9 animate-pulse rounded-xl bg-muted" />
            <div className="h-3 w-20 animate-pulse rounded bg-line" />
            <div className="h-7 w-16 animate-pulse rounded bg-muted" />
            <div className="h-3 w-24 animate-pulse rounded bg-line" />
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          {/* gauge */}
          <div className="glass-card space-y-4 rounded-2xl p-5">
            <div className="h-4 w-28 animate-pulse rounded bg-muted" />
            <div className="h-5 w-full animate-pulse rounded-full bg-line" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-4 animate-pulse rounded bg-line" />
              ))}
            </div>
          </div>
          {/* machine-chain rail */}
          <div className="glass-card rounded-2xl p-5">
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
            <div className="mt-4 flex gap-3 overflow-hidden">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-28 min-w-[10.5rem] animate-pulse rounded-xl bg-line"
                />
              ))}
            </div>
          </div>
        </div>
        {/* recorder island */}
        <div className="glass-card space-y-3 rounded-2xl p-5">
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          <div className="h-10 animate-pulse rounded-xl bg-line" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-10 animate-pulse rounded-xl bg-line" />
            <div className="h-10 animate-pulse rounded-xl bg-line" />
          </div>
          <div className="h-10 w-28 animate-pulse rounded-xl bg-muted" />
        </div>
      </div>
    </div>
  );
}
