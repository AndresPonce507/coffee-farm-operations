"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Sprout,
  Map,
  Coffee,
  Users,
  FlaskConical,
  Wind,
  ListChecks,
  Boxes,
  Coins,
  ShieldCheck,
} from "lucide-react";
import { JansonLogo } from "./logo";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

export const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/plots", label: "Plots", icon: Sprout },
  { href: "/map", label: "Map", icon: Map },
  { href: "/harvests", label: "Harvests", icon: Coffee },
  { href: "/processing", label: "Processing", icon: FlaskConical },
  { href: "/drying", label: "Drying", icon: Wind },
  { href: "/inventory", label: "Inventory", icon: Boxes },
  { href: "/costing", label: "Costing", icon: Coins },
  { href: "/eudr", label: "EUDR", icon: ShieldCheck },
  { href: "/workers", label: "Workers", icon: Users },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="glass-forest sticky top-0 hidden h-screen w-64 shrink-0 flex-col text-paper md:flex">
      <div className="px-5 pb-6 pt-6 text-paper">
        <Link href="/" className="block transition-opacity hover:opacity-90">
          <JansonLogo />
        </Link>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {NAV.map(({ href, label, icon: Icon }) => {
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
              {label}
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
