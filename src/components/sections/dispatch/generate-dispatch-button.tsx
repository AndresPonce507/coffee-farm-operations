"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * GenerateDispatchButton — drafts (or re-drafts) a crew's morning dispatch.
 *
 * One tap reads the S8 ripeness model + S1 crews and writes a DRAFT run + its
 * per-plot assignments via the generate action. Re-generating supersedes the prior
 * plan (append-only, history preserved). It NEVER sends — sending is the separate,
 * deliberate share tap (owner-initiated outbound). The action is accepted by SHAPE
 * (`(fd: FormData) => Promise<unknown>`) so this island is render-testable without a
 * server. The crew/date/season + a default readiness threshold ride in as FormData.
 *
 * Glass discipline: the only motion is the Button's GPU transform (prefers-reduced-
 * motion neutralised); pending state via an icon swap + text, never colour alone.
 */
export interface GenerateDispatchButtonProps {
  crewId: string;
  crewName: string;
  /** The morning this dispatch is for (ISO yyyy-mm-dd). */
  dispatchDate: string;
  season: string;
  /** Plots at/above this readiness [0,1] are dispatched. Defaults to 0.5. */
  readinessThreshold?: number;
  /** The generate server action, accepted by shape so the route isn't hard-imported. */
  action?: (fd: FormData) => Promise<unknown>;
  /** When true the crew already has an active dispatch — label becomes "Re-draft". */
  alreadyDrafted?: boolean;
  className?: string;
}

export function GenerateDispatchButton({
  crewId,
  crewName,
  dispatchDate,
  season,
  readinessThreshold = 0.5,
  action,
  alreadyDrafted = false,
  className,
}: GenerateDispatchButtonProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    if (pending) return;
    setError(null);
    const fd = new FormData();
    fd.set("crewId", crewId);
    fd.set("dispatchDate", dispatchDate);
    fd.set("season", season);
    fd.set("readinessThreshold", String(readinessThreshold));
    startTransition(async () => {
      try {
        await action?.(fd);
      } catch {
        setError("Could not draft the dispatch. Try again.");
      }
    });
  }

  const Icon = alreadyDrafted ? RefreshCw : Sparkles;
  const label = alreadyDrafted ? "Re-draft" : "Generate dispatch";

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant={alreadyDrafted ? "outline" : "primary"}
        onClick={onClick}
        disabled={pending}
        aria-label={`${label} for ${crewName}`}
        className={cn(className)}
      >
        <Icon className={cn("h-4 w-4", pending && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
        {pending ? "Drafting…" : label}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-cherry">
          {error}
        </p>
      )}
    </div>
  );
}
