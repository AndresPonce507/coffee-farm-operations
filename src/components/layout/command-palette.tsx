"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Search,
  CornerDownLeft,
  Hash,
  Sprout,
  Users,
  HeartHandshake,
  Send,
  Banknote,
  Beaker,
  Award,
} from "lucide-react";

import { NAV } from "./sidebar";
import { entityHref } from "@/lib/dossier/entity-href";
import { cn } from "@/lib/utils";

/** A resolved palette result — a nav destination or an entity jump action. */
interface Result {
  kind:
    | "nav"
    | "lot"
    | "plot"
    | "worker"
    | "crew"
    | "dispatch"
    | "pay-period"
    | "batch"
    | "cup";
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
 * Phase 5 orphan-wire (US-05) — the typed-shape recognizers that turn a raw query
 * into candidate ENTITY destinations, every URL resolved through the `entityHref`
 * SSOT (never hand-built here). Each recognizer mirrors the lot-code contract: it
 * proposes a destination from the input's shape, and the destination route's own
 * `notFound()` is the authority (a bad id routes, then 404s — the palette only
 * shows "no matches" when NO recognizer fires). This is what makes the 5 new
 * dossiers + the 3 existing orphan dossiers reachable from anywhere via ⌘K.
 *
 * Recognizers are intentionally prefix/keyword-anchored so a plain number stays a
 * lot (the dominant use-case) and the other kinds need a light cue:
 *   - `w-03` / `worker 3`        → /workers/<id>
 *   - `p-tizingal-alto` / `plot …` → /plots/<id>
 *   - `crew-norte` / `crew …`    → /crew/<id>
 *   - `disp 42` / `dispatch 42`  → /dispatch/<id>  (numeric run)
 *   - `pp 2026-w12` / `pay …`    → /pay-period/<id>
 *   - `batch fb-118` / `ferment …` → /ferment/<id>
 *   - a green-lot code (JC-NNN)  → ALSO offers /qc/cup/<code>
 */
function entityResultsFrom(raw: string): Result[] {
  const q = raw.trim();
  if (q === "") return [];
  const out: Result[] = [];

  // worker — `w-03`, `w 03`, `worker 3`, `trabajador 3`
  const worker = q.match(/^(?:w[-\s]?|trabajador\s+|worker\s+)0*([0-9]{1,3})$/i);
  if (worker) {
    const id = `w-${worker[1].padStart(2, "0")}`;
    out.push({
      kind: "worker",
      href: entityHref.worker(id),
      label: `Abrir trabajador ${id}`,
      Icon: Users,
    });
  }

  // crew — `crew-norte`, `crew norte`, `cuadrilla norte`
  const crew = q.match(/^(?:crew|cuadrilla)[-\s]+([a-z0-9-]+)$/i);
  if (crew) {
    const id = `crew-${crew[1].replace(/^crew-/i, "")}`;
    out.push({
      kind: "crew",
      href: entityHref.crew(id),
      label: `Abrir cuadrilla ${id}`,
      Icon: HeartHandshake,
    });
  }

  // plot — `p-tizingal-alto`, `plot tizingal-alto`, `lote tizingal-alto`
  const plot = q.match(/^(?:p-|plot\s+|lote\s+|parcela\s+)([a-z][a-z0-9-]+)$/i);
  if (plot) {
    const slug = plot[1].toLowerCase();
    const id = slug.startsWith("p-") ? slug : `p-${slug}`;
    out.push({
      kind: "plot",
      href: entityHref.plot(id),
      label: `Abrir lote ${id}`,
      Icon: Sprout,
    });
  }

  // dispatch run — `disp 42`, `dispatch 42`, `despacho 42`, `#42`
  const disp = q.match(/^(?:disp(?:atch)?|despacho|#)\s*([0-9]{1,9})$/i);
  if (disp) {
    const id = disp[1];
    out.push({
      kind: "dispatch",
      href: entityHref.dispatch(id),
      label: `Abrir despacho ${id}`,
      Icon: Send,
    });
  }

  // pay period — `pp 2026-w12`, `pay 2026-w12`, `nomina 2026-w12`
  const pay = q.match(/^(?:pp|pay|n[oó]mina)[-\s]+([a-z0-9-]+)$/i);
  if (pay) {
    const id = pay[1].toLowerCase();
    out.push({
      kind: "pay-period",
      href: entityHref["pay-period"](id),
      label: `Abrir periodo de pago ${id}`,
      Icon: Banknote,
    });
  }

  // ferment batch — `batch fb-118`, `ferment fb-118`, `lote-ferm fb-118`
  const batch = q.match(/^(?:batch|ferment|fermento|tanda)[-\s]+([a-z0-9-]+)$/i);
  if (batch) {
    const id = batch[1].toLowerCase();
    out.push({
      kind: "batch",
      href: entityHref.batch(id),
      label: `Abrir tanda ${id}`,
      Icon: Beaker,
    });
  }

  // green-lot CUP score — any lot code ALSO offers its cup scoresheet (a green
  // lot's QC dossier lives at /qc/cup/<code>). Complements, never replaces, the
  // lot. Cup is NOT one of the 7 entity dossiers, so it is intentionally absent
  // from the `entityHref` SSOT; its route is the QC scoresheet path, built here.
  const code = lotCodeFrom(q);
  if (code) {
    out.push({
      kind: "cup",
      href: `/qc/cup/${code}`,
      label: `Ver taza de ${code}`,
      Icon: Award,
    });
  }

  return out;
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
  // Portal target only exists on the client. Gate the overlay portal on mount so
  // SSR renders nothing for it (the launcher is only ever opened client-side).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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
    // Phase 5 orphan-wire: the lot jump leads, then the other entity-kind jumps
    // (worker/plot/crew/dispatch/pay-period/batch + the cup-of-this-lot drill),
    // then the nav routes. Every entity href comes from the entityHref SSOT.
    const entityHits = entityResultsFrom(query);
    return [...lotHit, ...entityHits, ...navHits];
  }, [query]);

  // Stable per-row ids so the input's aria-activedescendant can point at the
  // highlighted option (ARIA combobox pattern). Keyed by kind+href like the
  // <li> keys, so the id of a given result is stable across renders.
  const LISTBOX_ID = "command-palette-listbox";
  const optionId = (r: Result) => `command-option-${r.kind}-${r.href}`;
  const activeId =
    results.length > 0 && results[active]
      ? optionId(results[active])
      : undefined;

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

      {open &&
        mounted &&
        // Portal the overlay to <body> so it escapes every page stacking context.
        // The page shell + cards carry lingering `transform`s (from `animate-rise`,
        // whose end state translateY(0) is still a transform → still a stacking
        // context), which would otherwise trap this z-50 layer *below* sibling
        // cards and let page content render through the palette. (Fixes the
        // "renders behind the page" bug.)
        createPortal(
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
                <Search
                  className="h-4 w-4 shrink-0 text-muted-fg"
                  aria-hidden
                />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  // ARIA combobox pattern: the input owns the listbox below, and
                  // announces its expanded state + the currently-highlighted
                  // option so screen readers track arrow navigation.
                  role="combobox"
                  aria-label="Search routes and lots"
                  aria-controls={LISTBOX_ID}
                  aria-expanded={results.length > 0}
                  aria-autocomplete="list"
                  aria-activedescendant={activeId}
                  placeholder="Jump to a page, or type a lot number…"
                  className="h-12 w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted-fg/70"
                />
              </div>

              <ul
                id={LISTBOX_ID}
                role="listbox"
                aria-label="Results"
                className="max-h-80 overflow-y-auto p-2"
              >
                {results.length === 0 ? (
                  <li
                    data-testid="command-palette-empty"
                    className="px-3 py-6 text-center text-sm text-muted-fg"
                  >
                    Sin resultados — prueba un lote (701), un trabajador (w-03) o
                    un lote/parcela (p-tizingal-alto).
                  </li>
                ) : (
                  results.map((r, i) => (
                    <li
                      key={`${r.kind}-${r.href}`}
                      id={optionId(r)}
                      role="option"
                      aria-selected={i === active}
                    >
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
                          <CornerDownLeft
                            className="ml-auto h-3.5 w-3.5 text-forest/70"
                            aria-hidden
                          />
                        )}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
