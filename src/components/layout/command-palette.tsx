"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft, Hash } from "lucide-react";

import { NAV } from "./sidebar";
import { cn } from "@/lib/utils";

/** A resolved palette result — a nav destination or a jump-to-lot action. */
interface Result {
  kind: "nav" | "lot";
  href: string;
  label: string;
  Icon: typeof Search;
}

/**
 * Derive a green-lot code from free text: any run of ≥3 digits becomes JC-NNN
 * (so "701", "jc-701", "lot 701" all resolve to JC-701). Returns null otherwise.
 */
function lotCodeFrom(query: string): string | null {
  const digits = query.replace(/\D/g, "");
  return digits.length >= 3 ? `JC-${digits}` : null;
}

/**
 * CommandPalette (S9) — the keyboard spine of the app. ⌘K / Ctrl-K (or the
 * topbar trigger) opens a fuzzy launcher over EVERY route — including the ones
 * that have no sidebar entry, most importantly a lot's traceability page
 * (/lots/[code]), which until S9 was reachable by direct URL only. Type a lot
 * number to jump straight to its lineage + EUDR dossier.
 *
 * The one client island in the shell: a global key listener + a modal launcher
 * with arrow/enter/escape navigation. It reads the SAME NAV source of truth the
 * sidebar/mobile-nav render, so a new route is reachable everywhere at once.
 * No backdrop-blur on a huge surface; a plain scrim keeps it buttery on mobile.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const navHits: Result[] = NAV.filter((n) =>
      q === "" ? true : n.label.toLowerCase().includes(q),
    ).map((n) => ({ kind: "nav", href: n.href, label: n.label, Icon: n.icon }));

    const code = lotCodeFrom(query);
    const lotHit: Result[] = code
      ? [
          {
            kind: "lot",
            href: `/lots/${code}`,
            label: `Go to lot ${code}`,
            Icon: Hash,
          },
        ]
      : [];
    return [...lotHit, ...navHits];
  }, [query]);

  // Clamp the active row whenever the result set shrinks.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(results.length - 1, 0)));
  }, [results.length]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  const go = useCallback(
    (r: Result | undefined) => {
      if (!r) return;
      close();
      router.push(r.href);
    },
    [router, close],
  );

  // Global ⌘K / Ctrl-K toggle (works from anywhere in the shell).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus the input when the launcher opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  return (
    <>
      {/* Trigger — styled like a search field, lives where the topbar search was. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="command-palette-trigger"
        aria-label="Open command palette"
        aria-keyshortcuts="Meta+K Control+K"
        className="relative hidden h-9 max-w-sm flex-1 items-center gap-2 rounded-xl border border-line bg-card pl-9 pr-2 text-sm text-muted-fg/80 outline-none transition hover:border-forest-300 focus:border-forest-300 focus:ring-2 focus:ring-forest-100 md:flex"
      >
        <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-fg" />
        <span className="truncate">Search plots, lots, workers…</span>
        <kbd className="ml-auto hidden rounded border border-line bg-muted px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted-fg lg:inline">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-[12vh]"
          onClick={close}
          data-testid="command-palette-scrim"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            data-testid="command-palette"
            onClick={(e) => e.stopPropagation()}
            className="animate-rise w-full max-w-lg overflow-hidden rounded-2xl border border-white/60 bg-white/90 shadow-2xl backdrop-blur-xl"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                close();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(results[active]);
              }
            }}
          >
            <div className="flex items-center gap-2 border-b border-line px-4">
              <Search className="h-4 w-4 shrink-0 text-muted-fg" aria-hidden />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                aria-label="Search routes and lots"
                placeholder="Jump to a page, or type a lot number…"
                className="h-12 w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted-fg/70"
              />
            </div>

            <ul role="listbox" aria-label="Results" className="max-h-80 overflow-y-auto p-2">
              {results.length === 0 ? (
                <li
                  data-testid="command-palette-empty"
                  className="px-3 py-6 text-center text-sm text-muted-fg"
                >
                  No matches — type a lot number like 701 to open its dossier.
                </li>
              ) : (
                results.map((r, i) => (
                  <li key={`${r.kind}-${r.href}`} role="option" aria-selected={i === active}>
                    <button
                      type="button"
                      data-testid={`command-result-${r.href}`}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(r)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                        i === active
                          ? "bg-forest-100 text-forest"
                          : "text-ink hover:bg-muted",
                      )}
                    >
                      <r.Icon
                        className={cn(
                          "h-[18px] w-[18px] shrink-0",
                          i === active ? "text-forest" : "text-muted-fg",
                        )}
                        aria-hidden
                      />
                      <span className="truncate">{r.label}</span>
                      {i === active && (
                        <CornerDownLeft className="ml-auto h-3.5 w-3.5 text-forest/70" aria-hidden />
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
