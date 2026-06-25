"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard,
  Sprout,
  Map,
  Coffee,
  Scale,
  Users,
  FlaskConical,
  Beaker,
  Wind,
  ListChecks,
  Boxes,
  Coins,
  ShieldCheck,
  HeartHandshake,
  Award,
  CalendarRange,
  Send,
  Satellite,
  Bug,
  Banknote,
  TrendingUp,
  Anchor,
  Megaphone,
  FileSignature,
  Lock,
  TestTube2,
  Gavel,
  Ship,
} from "lucide-react";
import { JansonLogo } from "./logo";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * NAV — the single source of truth for the app's primary navigation, shared by
 * the desktop Sidebar, the MobileNav drawer, and the ⌘K CommandPalette. Each
 * entry carries a stable `key` that resolves to a localized label via the
 * `layout.nav.<key>` dictionary (consumers call `useTranslations("layout")`),
 * so a route is reachable everywhere at once and its copy switches per locale.
 */
export const NAV = [
  { href: "/", key: "dashboard", icon: LayoutDashboard },
  { href: "/plots", key: "plots", icon: Sprout },
  { href: "/map", key: "map", icon: Map },
  { href: "/weigh", key: "weigh", icon: Scale },
  { href: "/harvests", key: "harvests", icon: Coffee },
  { href: "/plan", key: "plan", icon: CalendarRange },
  { href: "/dispatch", key: "dispatch", icon: Send },
  { href: "/processing", key: "processing", icon: FlaskConical },
  { href: "/ferment", key: "ferment", icon: Beaker },
  { href: "/drying", key: "drying", icon: Wind },
  { href: "/inventory", key: "inventory", icon: Boxes },
  { href: "/qc", key: "qc", icon: Award },
  { href: "/pricing", key: "pricing", icon: TrendingUp },
  { href: "/hedge", key: "hedge", icon: Anchor },
  // P3 Wave 1 commerce cluster — offer board, contracts, fixation, samples, auctions, export
  { href: "/sales/offers", key: "offers", icon: Megaphone },
  { href: "/sales/contracts", key: "contracts", icon: FileSignature },
  { href: "/sales/fixation", key: "fixation", icon: Lock },
  { href: "/sales/samples", key: "samples", icon: TestTube2 },
  { href: "/sales/auctions", key: "auctions", icon: Gavel },
  { href: "/sales/shipments", key: "shipments", icon: Ship },
  { href: "/satellite", key: "satellite", icon: Satellite },
  { href: "/scouting", key: "scouting", icon: Bug },
  { href: "/costing", key: "costing", icon: Coins },
  { href: "/eudr", key: "eudr", icon: ShieldCheck },
  { href: "/workers", key: "workers", icon: Users },
  { href: "/crew", key: "crew", icon: HeartHandshake },
  { href: "/payroll", key: "payroll", icon: Banknote },
  { href: "/tasks", key: "tasks", icon: ListChecks },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations("layout");

  return (
    <aside className="glass-forest sticky top-0 hidden h-screen w-64 shrink-0 flex-col text-paper md:flex">
      <div className="px-5 pb-6 pt-6 text-paper">
        <Link href="/" className="block transition-opacity hover:opacity-90">
          <JansonLogo />
        </Link>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {NAV.map(({ href, key, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-paper/12 text-paper"
                  : "text-paper/65 hover:bg-paper/8 hover:text-paper"
              )}
            >
              <Icon
                className={cn(
                  "h-[18px] w-[18px] transition-colors",
                  active ? "text-honey" : "text-paper/55 group-hover:text-paper/80"
                )}
              />
              {t(`nav.${key}`)}
              {active && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-honey" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-paper/12 px-5 py-4">
        <p className="font-display text-xs font-medium text-paper/80">
          {BRAND.location}
        </p>
        <p className="mt-0.5 text-[11px] text-paper/45">
          {BRAND.altitudeRange} · Est. {BRAND.established}
        </p>
      </div>
    </aside>
  );
}
