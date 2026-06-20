/**
 * PageHeader — section/page title block with optional subtitle and right-aligned actions.
 * Server component (no hooks, no handlers). Stacks on mobile, splits left/right on sm+.
 */
export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="animate-rise relative mb-6 pb-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
            {title}
          </h1>
          {subtitle && <p className="mt-1 text-sm text-muted-fg">{subtitle}</p>}
        </div>
        {children && (
          <div className="flex items-center gap-2">{children}</div>
        )}
      </div>
      {/* Hairline gradient divider — forest fades to transparent, floats over the aurora */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
      />
    </div>
  );
}
