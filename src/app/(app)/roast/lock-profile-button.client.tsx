"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { lockRoastProfileAction } from "./actions";

/**
 * LockProfileButton — the one-way "lock golden" affordance on a DRAFT profile card.
 *
 * Locking a draft is irreversible (a golden curve is versioned, never edited — the
 * only onward move is to retire it), so it sits behind a human confirm dialog
 * (rail §7 — the irreversible write is human-gated). On success the board re-reads
 * via router.refresh(); the DB is the real wall (lock_roast_profile is the single
 * write door). No green inventory moves, so nothing ripples.
 */

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `rl_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

export function LockProfileButton({
  profileId,
  name,
  version,
}: {
  profileId: number;
  name: string;
  version: number;
}) {
  const t = useTranslations("roast");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    setError(null);
    setPending(true);
    const result = await lockRoastProfileAction({
      profileId,
      idempotencyKey: newKey(),
    });
    setPending(false);
    if (result.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <Lock className="h-3.5 w-3.5" aria-hidden />
        {t("lock.action")}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("lock.confirmTitle")}
      >
        <div className="space-y-4">
          <p className="text-sm text-ink">
            {t("lock.confirmBody", { name, version })}
          </p>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
            >
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              {t("lock.cancel")}
            </Button>
            <Button type="button" disabled={pending} onClick={onConfirm}>
              {pending ? t("lock.locking") : t("lock.confirm")}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
