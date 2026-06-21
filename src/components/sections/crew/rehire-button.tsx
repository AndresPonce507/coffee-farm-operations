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

  function onClick() {
    if (disabled || done || pending) return;
    const fd = new FormData();
    fd.set("workerId", workerId);
    fd.set("crewId", crewId);
    fd.set("season", season);
    startTransition(async () => {
      try {
        await action?.(fd);
        setDone(true);
      } catch {
        // Leave the button actionable so the tap can be retried; the route
        // surfaces the error. (No throw across the transition boundary.)
        setDone(false);
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
  );
}
