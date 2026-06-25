"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Lock, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type {
  FixationExposureRow,
  LockFixationAction,
} from "@/app/(app)/hedge/types";

/** Client-minted idempotency key (jsdom/older runtimes lack crypto.randomUUID). */
function mintKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `fix-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * LockFixationButton — the one-tap, human-confirmed write affordance on each open
 * commodity reservation in the cockpit.
 *
 * Locking the "C" leg is a MONEY-SHAPED, IRREVERSIBLE instrument (rail #7: such
 * writes are human-confirmed, never auto; rail #9: online-first, NOT routed through
 * the offline outbox). So the button only ARMS a glass confirm dialog that spells
 * out the irreversibility and the exact "C" mark being locked; the actual
 * `lock_fixation` RPC fires only on the explicit second click.
 *
 * The action is RECEIVED as a prop (the Server Component page binds the real
 * `lockFixationAction`), so this island never imports the server-action module —
 * keeping the cockpit's render/smoke test free of the parallel-built command port.
 *
 * On success the affordance animates floating → locked: the live button is swapped
 * for a settled "C leg locked" chip via `animate-rise` (GPU transform/opacity, and
 * already neutralised by the global `prefers-reduced-motion` rule).
 */
export function LockFixationButton({
  row,
  action,
}: {
  row: FixationExposureRow;
  action: LockFixationAction;
}) {
  const t = useTranslations("hedge");
  const [open, setOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // No live "C" mark for the month ⇒ nothing to lock against. The DB raises
  // `no_data_found`; this is the UI courtesy that keeps the user out of a doomed
  // round-trip (the floor/exposure is "unknown", never fabricated).
  const hasMark = row.currentCPrice != null;
  // No quote id yet (the read-port seam, see types.ts) ⇒ the lock has nothing to
  // key on, so it is disabled rather than firing `lock_fixation` with a wrong id.
  const hasQuoteId = row.priceQuoteId != null;
  const canLock = hasMark && hasQuoteId;

  function confirm() {
    if (row.priceQuoteId == null) return; // narrow + guard the seam
    setError(null);
    const priceQuoteId = row.priceQuoteId;
    startTransition(async () => {
      const result = await action({
        priceQuoteId,
        idempotencyKey: mintKey(),
      });
      if (result.ok) {
        setOpen(false);
        setLocked(true);
      } else {
        setError(result.error);
      }
    });
  }

  if (locked) {
    return (
      <span
        className="animate-rise inline-flex items-center gap-1.5 rounded-xl bg-forest-100 px-3 py-1.5 text-xs font-semibold text-forest"
        aria-live="polite"
      >
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        {t("lock.locked")}
      </span>
    );
  }

  return (
    <>
      <Button
        variant="primary"
        size="sm"
        onClick={() => setOpen(true)}
        className="w-full sm:w-auto"
      >
        <Lock className="h-3.5 w-3.5" aria-hidden />
        {t("lock.button")}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("lock.dialogTitle")}
      >
        <div className="space-y-4">
          {/* The irreversibility warning — opaque chip so it clears WCAG-AA over glass. */}
          <p className="flex items-start gap-2 rounded-xl bg-cherry-100/80 px-3 py-2.5 text-sm font-medium text-cherry">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {t("lock.warning")}
          </p>

          <p className="text-sm text-muted-fg">
            {t("lock.detail", {
              lot: row.greenLotCode,
              kg: row.kg.toLocaleString("en-US"),
              month: row.iceCContractMonth,
            })}
          </p>

          {hasMark ? (
            <p className="rounded-xl bg-paper/80 px-3 py-2 font-display text-sm font-semibold tabular-nums text-ink">
              {t("lock.atC", {
                price: (row.currentCPrice as number).toFixed(2),
              })}
            </p>
          ) : (
            <p role="alert" className="text-sm font-medium text-honey-700">
              {t("lock.noMark")}
            </p>
          )}

          {!hasQuoteId && (
            <p role="alert" className="text-sm font-medium text-honey-700">
              {t("lock.pendingId")}
            </p>
          )}

          {error && (
            <p role="alert" className="text-sm font-medium text-cherry">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              {t("lock.cancel")}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={pending || !canLock}
              onClick={confirm}
            >
              {pending ? t("lock.locking") : t("lock.confirm")}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
