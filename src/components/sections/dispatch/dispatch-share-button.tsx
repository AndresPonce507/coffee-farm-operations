"use client";

import { useState, useTransition } from "react";
import { Check, Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { resolveAdapter, defaultDispatchChannel } from "@/lib/integration/dispatch/resolve";
import type { DispatchDeliveryInput, DispatchDeliveryResult } from "@/lib/integration/dispatch/port";
import { cn } from "@/lib/utils";
import type { DispatchCard } from "@/lib/types";

import { renderDispatchCardText, renderDispatchCardTitle } from "./dispatch-card-text";

/**
 * DispatchShareButton — the one-tap "share the morning card" island.
 *
 * The $0 outbound leg: it renders the bilingual card to plain text and hands it to
 * the web-share adapter (the device's native share sheet → WhatsApp, or the
 * clipboard fallback) — NO paid API. ONLY on a successful share does it fire the
 * OWNER-INITIATED `markSentAction`, so a dispatch is never falsely marked "sent"
 * when the share itself failed (the manager just retries). Generation never reaches
 * this button — sending is always a deliberate human tap (owner-initiated outbound;
 * nothing auto-sends).
 *
 * Ports-and-adapters by shape: `deliver` and `markSentAction` are injected props
 * (defaulting to the real web-share adapter + accepting the route's action by
 * SHAPE), so this island is trivially render-testable without a browser or a server.
 *
 * Glass discipline: the only motion is the Button's GPU transform (already
 * neutralised by prefers-reduced-motion); the shared state is conveyed by an icon +
 * text, never colour alone; `aria-live` announces the result.
 */
export interface DispatchShareButtonProps {
  card: DispatchCard;
  /** The crew's languages — drives the bilingual share text. */
  languages?: string[];
  /** The delivery function (defaults to the $0 web-share adapter). Injected for tests. */
  deliver?: (input: DispatchDeliveryInput) => Promise<DispatchDeliveryResult>;
  /** The owner-initiated mark-sent server action, accepted by shape. */
  markSentAction?: (fd: FormData) => Promise<unknown>;
  className?: string;
}

export function DispatchShareButton({
  card,
  languages = [],
  deliver,
  markSentAction,
  className,
}: DispatchShareButtonProps) {
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(card.status === "sent" || card.status === "acknowledged");
  const [error, setError] = useState<string | null>(null);

  const share =
    deliver ?? ((input: DispatchDeliveryInput) => resolveAdapter(defaultDispatchChannel).deliver(input));

  function onClick() {
    if (pending) return;
    setError(null);
    const text = renderDispatchCardText(card, { languages });
    const title = renderDispatchCardTitle(card);

    startTransition(async () => {
      const result = await share({ runId: card.id, title, text });
      if (!result.ok) {
        // share failed (no native share + no clipboard, or the sheet was dismissed) —
        // do NOT mark sent. Surface the reason so the manager can retry.
        setError(result.reason);
        return;
      }
      // owner-initiated outbound: record the send only AFTER a real share succeeded.
      if (markSentAction) {
        const fd = new FormData();
        fd.set("runId", String(card.id));
        fd.set("channel", defaultDispatchChannel);
        try {
          await markSentAction(fd);
        } catch {
          // the route surfaces the error; keep the button actionable for a retry.
        }
      }
      setSent(true);
    });
  }

  if (sent) {
    return (
      <Button
        type="button"
        variant="outline"
        disabled
        aria-live="polite"
        className={cn("text-forest", className)}
      >
        <Check className="h-4 w-4" aria-hidden="true" />
        Shared
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="primary"
        onClick={onClick}
        disabled={pending}
        aria-label={`Share dispatch for ${card.crewName}`}
        title="Compartir · share"
        className={className}
      >
        <Share2 className="h-4 w-4" aria-hidden="true" />
        {pending ? "Sharing…" : "Share"}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-cherry">
          {error}
        </p>
      )}
    </div>
  );
}
