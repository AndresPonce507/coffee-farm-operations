"use client";

import { useState, useTransition } from "react";
import { Check, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { TERMS } from "./labels";

/**
 * RehireButton — the one-tap "welcome back" island.
 *
 * A returning-partner affordance: many of Janson's crew come back season after
 * season, so re-hiring is a dignity moment, not a fresh-hire form. One tap fires
 * the rehire server action inside a `useTransition`; on success the button
 * settles into a calm "Welcome back" confirmation rather than snapping back.
 *
 * It depends on the route's action only by SHAPE — `action: (fd: FormData) =>
 * Promise<unknown>` — so this island never hard-imports the route's action file
 * and stays trivially render-testable. workerId / crewId / season ride in as
 * hidden FormData fields.
 *
 * Glass discipline: the only motion is the Button's GPU transform (hover/active
 * scale), already neutralised by the global prefers-reduced-motion rule. The
 * confirmed state is conveyed by an icon + text, never colour alone.
 */
export interface RehireButtonProps {
  workerId: string;
  crewId: string;
  /** The season being re-hired into, e.g. "2026-2027". */
  season: string;
  /** The rehire server action — accepted by shape so we don't import the route. */
  action?: (fd: FormData) => Promise<unknown>;
  /** When true the worker isn't rehire-eligible — the button is inert. */
  disabled?: boolean;
  className?: string;
}

/**
 * A resolved-action value that DIDN'T succeed. The action is accepted by shape
 * (`Promise<unknown>`) so we never import the route, but at runtime it resolves
 * to the crew action-state envelope: `{ status: "success" | "error" | …, message? }`.
 * Anything that isn't an explicit `status: "success"` is treated as a FAILURE —
 * an absent/missing result is a failure too, so we never paint "Welcome back"
 * over an action that didn't actually rehire.
 */
function succeeded(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    "status" in result &&
    (result as { status?: unknown }).status === "success"
  );
}

/** The human-readable error message off a non-success result, if it carries one. */
function errorMessageOf(result: unknown): string | null {
  if (typeof result === "object" && result !== null && "message" in result) {
    const m = (result as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  return null;
}

export function RehireButton({
  workerId,
  crewId,
  season,
  action,
  disabled = false,
  className,
}: RehireButtonProps) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    if (disabled || done || pending) return;
    const fd = new FormData();
    fd.set("workerId", workerId);
    fd.set("crewId", crewId);
    fd.set("season", season);
    setError(null);
    startTransition(async () => {
      try {
        const result = await action?.(fd);
        if (succeeded(result)) {
          setDone(true);
        } else {
          // The action RESOLVED but didn't rehire (validation/RPC error). Never
          // paint "Welcome back" over a failure — keep the button actionable for
          // a retry and surface the route's error message.
          setDone(false);
          setError(errorMessageOf(result) ?? "No se pudo recontratar. Intentá de nuevo.");
        }
      } catch {
        // A thrown action (network/unexpected). Same posture as a resolved error:
        // leave the button actionable and surface a message. (No throw across
        // the transition boundary.)
        setDone(false);
        setError("No se pudo recontratar. Intentá de nuevo.");
      }
    });
  }

  if (done) {
    return (
      <Button
        type="button"
        variant="outline"
        disabled
        aria-live="polite"
        className={cn("text-forest", className)}
      >
        <Check className="h-4 w-4" aria-hidden="true" />
        Welcome back
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-stretch gap-1">
      <Button
        type="button"
        variant="primary"
        onClick={onClick}
        disabled={disabled || pending}
        aria-label={`Rehire for ${season}`}
        title={`${TERMS.rehire.es} · ${TERMS.rehire.ng}`}
        className={className}
      >
        <UserPlus className="h-4 w-4" aria-hidden="true" />
        {pending ? "Rehiring…" : "Rehire"}
      </Button>
      {error && (
        <p role="alert" className="text-xs font-medium text-cherry">
          {error}
        </p>
      )}
    </div>
  );
}
