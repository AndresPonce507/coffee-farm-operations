"use client";

import { useRef, useState, type ReactNode } from "react";

/** Minimal escape for a lot code embedded in an attribute selector string. */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

/**
 * <LotGraphInteractive> — the THIN client island (~1.5KB) for the S6 genealogy
 * graph. It WRAPS the server-rendered SVG (passed as `children`) and adds, with
 * GPU-only transform/opacity:
 *   • pan/zoom — drag to pan, wheel/pinch buttons to zoom (a CSS transform on a
 *     wrapper, never a re-layout);
 *   • neighbor highlight — tapping a node or ribbon dims everything NOT in that
 *     element's 1-hop neighborhood (the node itself plus its directly-incident
 *     edges), via a `data-trace` attribute the CSS keys on. This is a 1-hop
 *     emphasis, NOT a transitive ancestor/descendant lineage trace — the
 *     `data-lineage` token list on each element is just its own code (nodes) or
 *     its `parent child` pair (edges). It is a non-load-bearing JS enhancement;
 *     the operable lineage is the server-rendered role="tree".
 *
 * Crucially it is NOT required for the graph to render: the server already
 * printed the full SVG + the role="tree" fallback. With JS off this component's
 * markup is just a static wrapper around that SVG. With `prefers-reduced-motion`
 * the browser's reduced-motion rules already neutralize the transitions.
 */
export function LotGraphInteractive({
  children,
  ariaLabel,
}: {
  children: ReactNode;
  viewBox?: string;
  ariaLabel?: string;
}) {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [trace, setTrace] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(
    null,
  );

  const onPointerDown = (e: React.PointerEvent) => {
    // Lineage trace on a node/ribbon (data-lineage carries the code(s)).
    const el = (e.target as Element).closest("[data-lineage]");
    if (el) setTrace(el.getAttribute("data-lineage"));
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      px: pan.x,
      py: pan.y,
    };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  const zoom = (delta: number) =>
    setScale((s) => Math.min(2.5, Math.max(0.5, +(s + delta).toFixed(2))));

  const reset = () => {
    setScale(1);
    setPan({ x: 0, y: 0 });
    setTrace(null);
  };

  return (
    <div className="relative">
      {/* Neighbor-highlight dimming — scoped to this island (no globals.css
          fork). When a node/ribbon is active, everything whose data-lineage
          token list doesn't contain the traced code fades; the active element
          plus its directly-incident edges (1-hop neighborhood) stay
          full-opacity. NOT a transitive lineage trace — see the header. */}
      {trace && (
        <style>{`[data-trace] [data-lineage]{transition:opacity .18s ease}[data-trace] [data-lineage]:not([data-lineage~="${cssEscape(
          trace,
        )}"]){opacity:.18}`}</style>
      )}
      <div
        role="group"
        aria-label={ariaLabel ? `${ariaLabel} (pan and zoom)` : "Pan and zoom"}
        className="touch-none cursor-grab overflow-hidden active:cursor-grabbing"
        data-trace={trace ?? undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setTrace(null)}
        onPointerCancel={onPointerUp}
      >
        <div
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})`,
            transformOrigin: "0 0",
            transition: drag.current ? "none" : "transform 0.18s ease-out",
            willChange: "transform",
          }}
        >
          {children}
        </div>
      </div>

      {/* zoom chrome — small, opaque-chip controls (AA) */}
      <div className="absolute right-3 top-3 flex flex-col gap-1.5">
        <ZoomBtn label="Zoom in" onClick={() => zoom(0.25)}>
          +
        </ZoomBtn>
        <ZoomBtn label="Zoom out" onClick={() => zoom(-0.25)}>
          −
        </ZoomBtn>
        <ZoomBtn label="Reset view" onClick={reset}>
          ⤢
        </ZoomBtn>
      </div>
    </div>
  );
}

function ZoomBtn({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="text-ink border-line grid h-9 w-9 place-items-center rounded-xl border bg-white/90 text-base font-semibold shadow-sm transition hover:bg-white active:scale-95"
    >
      {children}
    </button>
  );
}
