import { Search, Bell, CloudSun } from "lucide-react";
import { initials } from "@/lib/utils";

/**
 * Slim top bar: contextual search, season chip, weather glance, notifications, user.
 * Server component — purely presentational.
 */
export function Topbar() {
  const user = "Miguel Janson";
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-white/50 bg-white/55 px-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.7)] backdrop-blur-xl backdrop-saturate-150 md:px-8">
      <div className="relative hidden max-w-sm flex-1 items-center md:flex">
        <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-fg" />
        <input
          type="search"
          placeholder="Search plots, lots, workers…"
          className="h-9 w-full rounded-xl border border-line bg-card pl-9 pr-3 text-sm text-ink placeholder:text-muted-fg/70 outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100"
        />
      </div>

      <div className="ml-auto flex items-center gap-2 md:gap-3">
        <span className="hidden items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-xs font-medium text-coffee sm:inline-flex">
          Harvest season · 2026
        </span>

        <div className="hidden items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-xs font-medium text-ink lg:inline-flex">
          <CloudSun className="h-4 w-4 text-honey" />
          22° · Volcán
        </div>

        <button
          aria-label="Notifications"
          className="relative grid h-9 w-9 place-items-center rounded-xl border border-line bg-card text-muted-fg transition hover:text-ink"
        >
          <Bell className="h-[18px] w-[18px]" />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-cherry" />
        </button>

        <div className="flex items-center gap-2.5 rounded-xl border border-line bg-card py-1 pl-1 pr-3">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-forest text-[11px] font-semibold text-paper">
            {initials(user)}
          </div>
          <div className="hidden leading-tight sm:block">
            <div className="text-xs font-semibold text-ink">{user}</div>
            <div className="text-[10px] text-muted-fg">Farm Manager</div>
          </div>
        </div>
      </div>
    </header>
  );
}
