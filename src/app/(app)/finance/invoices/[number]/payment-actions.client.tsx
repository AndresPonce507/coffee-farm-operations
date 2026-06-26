"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Ban, CreditCard } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD, LABEL } from "@/components/ui/form-field";
import { usd } from "@/lib/utils";
import { settleArPaymentAction, voidArDocAction } from "../../actions";

/**
 * The money-shaped action island on the invoice detail (P3-S17, rail §7).
 *
 * "Record payment" is NEVER auto: it opens a glass confirm sheet showing the
 * outstanding balance, the human sets the amount + method, and only an explicit
 * confirm posts via settle_ar_payment (the S16 overpayment cap + status-recompute
 * triggers fire server-side). "Void" posts a reversing revenue row through
 * void_ar_doc (it never deletes, and the DB blocks voiding a doc with payments). The
 * idempotency_key is client-minted so a double-tap collapses to one write.
 */

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `fin_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

const METHODS = ["wire", "ach", "card", "cash", "yappy", "check"] as const;

export function PaymentActions({
  arDocId,
  docNumber,
  currency,
  balanceUsd,
  canPay,
  canVoid,
}: {
  arDocId: number;
  docNumber: string;
  currency: string;
  balanceUsd: number;
  canPay: boolean;
  canVoid: boolean;
}) {
  const t = useTranslations("finance");
  const router = useRouter();

  const [payOpen, setPayOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [amount, setAmount] = useState<string>(
    balanceUsd > 0 ? String(balanceUsd) : "",
  );
  const [method, setMethod] = useState<string>("wire");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmPayment() {
    setError(null);
    setPending(true);
    const result = await settleArPaymentAction({
      arDocId,
      method,
      amountDoc: Number(amount),
      currency,
      idempotencyKey: newKey(),
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPayOpen(false);
    router.refresh();
  }

  async function confirmVoid() {
    setError(null);
    setPending(true);
    const result = await voidArDocAction({
      arDocId,
      reason,
      idempotencyKey: newKey(),
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setVoidOpen(false);
    router.refresh();
  }

  if (!canPay && !canVoid) return null;

  return (
    <section className="glass-card rounded-2xl p-5">
      <h2 className="font-display text-base font-semibold text-ink">{docNumber}</h2>
      <div className="mt-3 flex flex-col gap-2">
        {canPay && (
          <Button onClick={() => setPayOpen(true)}>
            <CreditCard className="h-4 w-4" aria-hidden />
            {t("invoice.actions.recordPayment")}
          </Button>
        )}
        {canVoid && (
          <Button variant="outline" onClick={() => setVoidOpen(true)}>
            <Ban className="h-4 w-4" aria-hidden />
            {t("invoice.actions.void")}
          </Button>
        )}
      </div>

      {/* Record payment — the confirm-gated money-shaped write */}
      <Dialog open={payOpen} onClose={() => setPayOpen(false)} title={t("pay.title")}>
        <div className="space-y-3">
          <p className="text-sm text-muted-fg">{t("pay.description")}</p>
          <p className="rounded-lg bg-paper/70 px-3 py-2 text-sm font-medium tabular-nums text-ink">
            {t("pay.balanceLine", { balance: usd(balanceUsd) })}
          </p>
          <label className="space-y-1">
            <span className={LABEL}>{t("pay.amount", { currency })}</span>
            <input
              className={FIELD}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className={LABEL}>{t("pay.method")}</span>
            <select
              className={FIELD}
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {t(`method.${m}` as "method.wire")}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p className="rounded-lg bg-cherry-100 px-3 py-2 text-sm text-cherry">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setPayOpen(false)} disabled={pending}>
              {t("pay.cancel")}
            </Button>
            <Button onClick={confirmPayment} disabled={pending || Number(amount) <= 0}>
              {t("pay.confirm")}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Void — reversing, never deleting */}
      <Dialog open={voidOpen} onClose={() => setVoidOpen(false)} title={t("void.title")}>
        <div className="space-y-3">
          <p className="text-sm text-muted-fg">{t("void.description")}</p>
          <label className="space-y-1">
            <span className={LABEL}>{t("void.reason")}</span>
            <input
              className={FIELD}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {error && (
            <p className="rounded-lg bg-cherry-100 px-3 py-2 text-sm text-cherry">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setVoidOpen(false)} disabled={pending}>
              {t("void.cancel")}
            </Button>
            <Button onClick={confirmVoid} disabled={pending || !reason.trim()}>
              {t("void.confirm")}
            </Button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}
