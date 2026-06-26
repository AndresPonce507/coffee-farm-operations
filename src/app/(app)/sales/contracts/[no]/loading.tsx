/**
 * /sales/contracts/[no] — instant route-loading skeleton.
 *
 * Mirrors the workspace shape — back link, header, status spine, a 4-up summary, then
 * the line editor — so the layout never shifts. Pure server component: glassy
 * animate-pulse placeholders the global reduced-motion rule neutralizes.
 */
import { useTranslations } from "next-intl";

export default function WorkspaceLoading() {
  const t = useTranslations("sales");
  return (
    <div className="space-y-6" aria-busy="true" aria-label={t("workspace.loading")}>
      <div className="h-4 w-32 animate-pulse rounded bg-line" />

      <div className="animate-rise relative mb-2 pb-4">
        <div className="space-y-2.5">
          <div className="h-3 w-24 animate-pulse rounded bg-line" />
          <div className="h-8 w-40 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-64 max-w-full animate-pulse rounded bg-line" />
        </div>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      <div className="glass-card rounded-2xl p-5">
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="h-6 w-6 animate-pulse rounded-full bg-muted" />
              <div className="h-3 w-14 animate-pulse rounded bg-line" />
            </div>
          ))}
        </div>
      </div>

      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2 p-4">
            <div className="h-3 w-16 animate-pulse rounded bg-line" />
            <div className="h-6 w-20 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>

      <div className="glass-card space-y-3 rounded-2xl p-5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-line" />
        ))}
      </div>
    </div>
  );
}
