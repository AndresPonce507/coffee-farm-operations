import Link from "next/link";
import { Bell, CloudSun } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getSupabase } from "@/lib/supabase/server";
import { MobileNav } from "./mobile-nav";
import { CommandPalette } from "./command-palette";
import { SyncStatus } from "./sync-status-island";
import { LanguageToggle } from "./language-toggle";
import { SignOutButton } from "@/components/auth/sign-out-button";

/**
 * Slim top bar: the ⌘K command palette, season chip, weather glance,
 * notifications, the signed-in owner, and sign-out. Async Server Component —
 * reads the session.
 */
export async function Topbar() {
  const t = await getTranslations("layout");
  const {
    data: { user },
  } = await (await getSupabase()).auth.getUser();
  const email = user?.email ?? "";
  const avatar = (email[0] ?? "?").toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-white/50 bg-white/55 px-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.7)] backdrop-blur-xl backdrop-saturate-150 md:px-8">
      <MobileNav />

      {/* The ⌘K launcher — quick-nav to any route + jump to a lot by code (S9). */}
      <CommandPalette />

      <div className="ml-auto flex items-center gap-2 md:gap-3">
        {/* Offline sync status — the always-visible chrome that tells a picker
            in a dead zone their capture is safe (P2-S0). Client island. */}
        <SyncStatus />

        <span className="hidden items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-xs font-medium text-coffee sm:inline-flex">
          {t("harvestSeason")}
        </span>

        <div className="hidden items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-xs font-medium text-ink lg:inline-flex">
          <CloudSun className="h-4 w-4 text-honey" />
          22° · Volcán
        </div>

        {/* Recent activity — the estate's "what just happened" feed lives on the
            dashboard. A real navigation (no fake unread dot, no inert button). */}
        <Link
          href="/"
          aria-label={t("viewRecentActivity")}
          className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-card text-muted-fg outline-none transition hover:text-ink focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        >
          <Bell className="h-[18px] w-[18px]" />
        </Link>

        <div className="flex items-center gap-2.5 rounded-xl border border-line bg-card py-1 pl-1 pr-3">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-forest text-[11px] font-semibold text-paper">
            {avatar}
          </div>
          <div className="hidden leading-tight sm:block">
            <div className="max-w-[160px] truncate text-xs font-semibold text-ink">
              {email}
            </div>
            <div className="text-[10px] text-muted-fg">{t("ownerRole")}</div>
          </div>
        </div>

        <LanguageToggle />

        <SignOutButton />
      </div>
    </header>
  );
}
