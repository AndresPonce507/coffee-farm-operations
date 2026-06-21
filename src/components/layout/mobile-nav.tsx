"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { JansonLogo } from "./logo";
import { NAV } from "./sidebar";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * Mobile navigation (< md): a hamburger + current-page label in the top bar that
 * opens a glass-forest slide-in drawer mirroring the desktop Sidebar. The desktop
 * Sidebar is `hidden md:flex`; this is `md:hidden`, so the two never overlap.
 * Client component — owns its own open state, scroll lock, focus, and Escape close.
 */
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Portal target only exists on the client. Gate the overlay portal on mount so
  // SSR renders nothing for it; the off-canvas drawer is a client-only surface
  // (its slide transition + open state only matter after hydration).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);
  const current = NAV.find((item) => isActive(item.href));

  // Close on navigation.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // While open: lock body scroll, close on Escape, focus the close button.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeWithFocus();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const closeWithFocus = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <>
      {/* Trigger + current-page label — only below md */}
      <div className="flex items-center gap-2.5 md:hidden">
        <button
          ref={triggerRef}
          type="button"
          aria-label="Open navigation menu"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls="mobile-nav-drawer"
          onClick={() => setOpen(true)}
          className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-card text-ink transition hover:text-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-300"
        >
          <Menu className="h-[18px] w-[18px]" />
        </button>
        {current && (
          <span className="font-display text-sm font-semibold text-ink">
            {current.label}
          </span>
        )}
      </div>

      {/* Overlay + drawer — portaled to <body> so it escapes every page stacking
          context. The page shell + cards carry lingering `transform`s (from
          `animate-rise`, whose end state translateY(0) is still a transform →
          still a stacking context), which would otherwise trap this z-50 layer
          *below* sibling cards and let page content render through the drawer.
          (Fixes the "renders behind the page" bug.) */}
      {mounted &&
        createPortal(
          <div
            className={cn(
              "fixed inset-0 z-50 md:hidden",
              open ? "pointer-events-auto" : "pointer-events-none",
            )}
            aria-hidden={!open}
          >
            {/* Backdrop */}
            <button
              type="button"
              tabIndex={-1}
              aria-label="Close navigation menu"
              onClick={closeWithFocus}
              className={cn(
                "absolute inset-0 h-full w-full cursor-default bg-ink/40 backdrop-blur-sm transition-opacity duration-300",
                open ? "opacity-100" : "opacity-0",
              )}
            />

            {/* Panel */}
            <div
              id="mobile-nav-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Main navigation"
              className={cn(
                "glass-forest absolute left-0 top-0 flex h-full w-[82%] max-w-xs flex-col text-paper shadow-2xl",
                "transition-transform duration-300 ease-out will-change-transform",
                open ? "translate-x-0" : "-translate-x-full",
              )}
            >
              <div className="flex items-center justify-between px-5 pb-6 pt-6">
                <Link
                  href="/"
                  className="block transition-opacity hover:opacity-90"
                >
                  <JansonLogo />
                </Link>
                <button
                  ref={closeRef}
                  type="button"
                  aria-label="Close navigation menu"
                  onClick={closeWithFocus}
                  className="grid h-9 w-9 place-items-center rounded-xl text-paper/70 transition hover:bg-paper/10 hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper/40"
                >
                  <X className="h-[18px] w-[18px]" />
                </button>
              </div>

              <nav className="flex-1 space-y-1 overflow-y-auto px-3">
                {NAV.map(({ href, label, icon: Icon }) => {
                  const active = isActive(href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors",
                        active
                          ? "bg-paper/12 text-paper"
                          : "text-paper/65 hover:bg-paper/8 hover:text-paper",
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-[18px] w-[18px] transition-colors",
                          active
                            ? "text-honey"
                            : "text-paper/55 group-hover:text-paper/80",
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
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
