import { cn } from "@/lib/utils";

/**
 * EmptyState — a centered placeholder for sections with no data yet.
 * Server component: no hooks, no event handlers.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn("py-12 text-center", className)}>
      {Icon ? (
        <div
          aria-hidden="true"
          className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-fg"
        >
          <Icon className="h-6 w-6" />
        </div>
      ) : null}
      <p className="mt-4 font-display font-semibold text-ink">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-fg">
          {description}
        </p>
      ) : null}
    </div>
  );
}
