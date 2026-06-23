"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

import { EntityLink } from "@/components/ui/entity-link";
import { entityHref } from "@/lib/dossier/entity-href";
import { cn } from "@/lib/utils";

/**
 * RippleProof — the walking-skeleton "esto también se actualizó" panel (slice-01,
 * facet-01 §2). After a successful capture it NAMES the real downstream consumers
 * that the single weigh-in just moved — the Dashboard "today" headline and the
 * minted lot dossier — and links each as a real navigable `<a href>`, showing the
 * captured Δ kg. It makes "enter once, it shows up everywhere" *visible* so the
 * owner trusts the cockpit agrees with itself (PRINCIPLE Rules 1 + 3: no dead UI,
 * every entity reaches its dossier).
 *
 * It RENDERS the propagation contract — it does not re-fetch it. Everything it shows
 * is derived client-side from the capture result (`lotCode`) + the `lastDeltaKg` the
 * island already holds: no new getter, no new RPC, no new view.
 *
 * Offline degradation (facet-01 §4 AC #2): a queued capture's lot code is unknown
 * until the outbox drains server-side, so the panel names a generic "Tu lote" and
 * links the live `/harvests` tab — where the captured intake already appears as a
 * harvests row — until sync confirms the lot code. (The bare `/lots` index is not a
 * real route yet; PRINCIPLE Rule 1 forbids pointing a link at a 404, so the offline
 * fallback targets the real downstream consumer the weigh-in actually moved.) The
 * picker's tally still climbed; nothing was lost.
 *
 * Glass discipline: a no-blur "glass-lite" content card (real blur is reserved for
 * floating chrome), GPU-only transforms, a `motion-safe` rise that respects
 * `prefers-reduced-motion`, AA-legible ink on the cream background, big touch targets
 * for glove use, es-PA-first copy.
 */

/** One downstream consumer the capture moved — label, route, and the propagated Δ. */
export interface RippleConsumer {
  /** es-PA label, e.g. "Tablero · hoy", "Lote JC-712". */
  label: string;
  /** A real `(app)/` route, e.g. "/", "/lots/JC-712". */
  href: string;
  /** The propagated delta as shown, e.g. "+18.4 kg". */
  delta: string;
  /**
   * When this consumer is the minted lot dossier, its code — so the row renders via the
   * SSOT `<EntityLink kind="lot">` (canonical focus ring + reachability) instead of a raw
   * `<Link>`. Absent for non-dossier consumers (Dashboard, offline `/harvests`).
   */
  lotCode?: string;
}

export interface RippleProofProps {
  /** The lot the last capture bound to (from WeighInResult.lotCode); null offline. */
  lotCode: string | null;
  /** The kg just captured; null before the first capture (idle). */
  lastDeltaKg: number | null;
  className?: string;
}

/** Format a captured kg as the panel's signed "+NN.N kg" delta token. */
function fmtDelta(kg: number): string {
  return `+${kg.toFixed(1)} kg`;
}

/**
 * Derive the consumer list purely from the capture result. Online (lot code known):
 * Dashboard + the minted lot dossier (its href resolved through the `entityHref` SSOT,
 * carrying `lotCode` so the row renders as an `<EntityLink>`). Offline (no lot code yet):
 * Dashboard + a generic "Tu lote" pointing at the live `/harvests` tab until sync confirms
 * the code.
 */
function deriveConsumers(lotCode: string | null, deltaKg: number): RippleConsumer[] {
  const delta = fmtDelta(deltaKg);
  const dashboard: RippleConsumer = { label: "Tablero · hoy", href: "/", delta };
  const lot: RippleConsumer = lotCode
    ? { label: `Lote ${lotCode}`, href: entityHref.lot(lotCode), delta, lotCode }
    : { label: "Tu lote · se confirma al sincronizar", href: "/harvests", delta };
  return [dashboard, lot];
}

export function RippleProof({ lotCode, lastDeltaKg, className }: RippleProofProps) {
  // Idle: no capture yet → nothing to prove. Render empty (no dead UI, no links).
  if (lastDeltaKg == null) return null;

  const consumers = deriveConsumers(lotCode, lastDeltaKg);

  return (
    <section
      aria-labelledby="ripple-proof-h"
      className={cn(
        "glass-card rounded-2xl px-4 py-3.5 ring-1 ring-forest-100 motion-safe:animate-rise",
        className,
      )}
    >
      <h2
        id="ripple-proof-h"
        className="flex items-center gap-1.5 text-sm font-semibold text-forest"
      >
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        Tu peso se reflejó en…
      </h2>
      <p className="mt-0.5 text-[11px] text-muted-fg">
        Sin volver a escribir nada — toca para ver el dato ya actualizado.
      </p>

      <ul className="mt-2.5 space-y-1.5">
        {consumers.map((c) => {
          // Shared row interior: the label (visible entity name) + the propagated Δ.
          const row = (
            <>
              <span className="flex items-center gap-2">
                <ArrowRight
                  className="h-4 w-4 text-forest transition-transform motion-safe:group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
                {c.label}
              </span>
              <span className="font-display font-bold tabular-nums text-forest">
                {c.delta}
              </span>
            </>
          );
          // Common visual shell (no focus-visible:ring here — EntityLink supplies its
          // canonical FOCUS_RING; the plain <Link> branch adds its own ring below).
          const rowClass =
            "group flex min-h-[44px] items-center justify-between gap-3 rounded-xl border border-line bg-white/55 px-3.5 py-2 text-sm font-medium text-ink transition hover:bg-white/80";
          return (
            <li key={c.href + c.label}>
              {c.lotCode ? (
                // The minted lot dossier → SSOT EntityLink (canonical ring + reachability).
                // The visible "Lote <code>" label already names the entity, so we DROP the
                // `name` prop: the visible text becomes the accessible name (WCAG 2.5.3).
                <EntityLink kind="lot" id={c.lotCode} className={rowClass}>
                  {row}
                </EntityLink>
              ) : (
                // Non-dossier consumers (Dashboard "/", offline "/harvests") stay plain
                // links with an explicit es-PA aria-label and their own focus ring.
                <Link
                  href={c.href}
                  aria-label={`${c.label} ${c.delta}`}
                  className={cn(
                    rowClass,
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-100",
                  )}
                >
                  {row}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
