"use client";

import { useState, useTransition } from "react";
import { Check, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";

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
 * text, never colour alone; a single ALWAYS-MOUNTED `aria-live` region announces
 * the result (a live region that only mounts on success is never announced by AT).
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

/**
 * An owner-initiated mark-sent that returned `{ status: "error" }` (the route
 * surfaced a failure WITHOUT throwing) must NOT count as a send. We inspect the
 * shape defensively because the prop is accepted by SHAPE (`Promise<unknown>`).
 */
function markSentFailed(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    "status" in result &&
    (result as { status?: unknown }).status === "error"
  );
}

export function DispatchShareButton({
  card,
  languages = [],
  deliver,
  markSentAction,
  className,
}: DispatchShareButtonProps) {
  const t = useTranslations("dispatch");
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(card.status === "sent" || card.status === "acknowledged");
  const [error, setError] = useState<string | null>(null);
  // The accessible status line — always-mounted (see below) so AT actually
  // announces the transition into "Compartido".
  const [statusMsg, setStatusMsg] = useState("");

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
        let actionResult: unknown;
        try {
          actionResult = await markSentAction(fd);
        } catch {
          // the action THREW — the send was not recorded. Keep the button
          // un-sent and actionable so the manager can retry; never lie "sent".
          setError(t("share.markSentError"));
          return;
        }
        if (markSentFailed(actionResult)) {
          // the action returned an error state — same: do NOT mark sent.
          setError(t("share.markSentError"));
          return;
        }
      }
      // confirmed sent: write the live-region message, THEN flip the visual state.
      setStatusMsg(t("share.sharedAnnouncement"));
      setSent(true);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {/* ONE always-mounted live region: it exists before the transition, so AT
          announces the message we write into it (a freshly-mounted aria-live
          node is never announced). */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {statusMsg}
      </span>
      {sent ? (
        <Button
          type="button"
          variant="outline"
          disabled
          className={cn("text-forest", className)}
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          {t("share.shared")}
        </Button>
      ) : (
        <Button
          type="button"
          variant="primary"
          onClick={onClick}
          disabled={pending}
          aria-label={t("share.shareLabel", { crewName: card.crewName })}
          title={t("share.shareTitle")}
          className={className}
        >
          <Share2 className="h-4 w-4" aria-hidden="true" />
          {pending ? t("share.sharing") : t("share.share")}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-xs text-cherry">
          {error}
        </p>
      )}
    </div>
  );
}
