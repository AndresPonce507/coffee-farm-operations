"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { num, usd } from "@/lib/utils";
import { fixLineAction } from "./actions";

/**
 * Fix-line island — the ONE interactive control per fixation card (the cockpit stays a
 * Server Component). Fixing locks the "C" leg at today's mark: a money-shaped,
 * irreversible action, so it is gated behind a human-confirmed glass dialog (rail
 * §7/§9). The button is disabled until a live "C" mark exists for the line's month
 * (the same gate the RPC enforces with no_data_found). Nothing here is driven by
 * untrusted inbound.
 */

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `f_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

const perKg = (v: number) => usd(v, v < 100 ? 2 : 0);

export function FixLine({
  contractLineId,
  greenLotCode,
  kg,
  impliedUnitPrice,
  ready,
}: {
  contractLineId: number;
  greenLotCode: string;
  kg: number;
  impliedUnitPrice: number | null;
  ready: boolean;
}) {
  const t = useTranslations("sales");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onFix() {
    setError(null);
    setPending(true);
    const result = await fixLineAction({
      contractLineId,
      idempotencyKey: newKey(),
    });
    setPending(false);
    if (result.ok) {
      setDone(true);
      setOpen(false);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  if (done) {
    return (
      <span className="text-sm font-medium text-forest">
        {t("fixation.fix.fixed")}
      </span>
    );
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        disabled={!ready}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Lock className="h-3.5 w-3.5" aria-hidden />
        {t("fixation.card.fix")}
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title={t("fixation.fix.title")}>
        <div className="space-y-4">
          <p className="text-sm text-ink">
            {impliedUnitPrice == null
              ? t("fixation.fix.bodyUnknown", {
                  kg: num(Math.round(kg)),
                  lot: greenLotCode,
                })
              : t("fixation.fix.body", {
                  kg: num(Math.round(kg)),
                  lot: greenLotCode,
                  price: perKg(impliedUnitPrice),
                })}
          </p>
          <p className="text-xs text-muted-fg">{t("fixation.fix.irreversible")}</p>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
            >
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("fixation.fix.cancel")}
            </Button>
            <Button type="button" disabled={pending} onClick={onFix}>
              {pending ? t("fixation.fix.fixing") : t("fixation.fix.confirm")}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
