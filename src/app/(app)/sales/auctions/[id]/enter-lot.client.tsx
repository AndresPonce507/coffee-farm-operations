"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD, LABEL } from "@/components/ui/form-field";
import { num } from "@/lib/utils";
import { enterAuctionLotAction } from "../actions";
import type { AvailableLot } from "../data";

/**
 * EnterLot — the lot-entry island. Entering a lot inserts a lot_reservations row
 * (buyer='AUCTION:<name>'), so the EXISTING prevent_oversell trigger guards it: an
 * auction-committed lot can't be double-sold. That commits green inventory, so it's a
 * money-shaped, HUMAN-CONFIRMED write (rail §7): the confirm dialog shows the ATP drop
 * before you commit, and the next buyer sees the lower number the moment it lands.
 */

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `e_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

export function EnterLot({
  auctionId,
  auctionName,
  availableLots,
}: {
  auctionId: number;
  auctionName: string;
  availableLots: AvailableLot[];
}) {
  const t = useTranslations("auctions");
  const router = useRouter();

  const [selected, setSelected] = useState<string>(
    availableLots[0]?.greenLotCode ?? "",
  );
  const lot = availableLots.find((l) => l.greenLotCode === selected) ?? null;
  const atp = lot?.atpKg ?? 0;

  const [kgValue, setKgValue] = useState<number>(
    Math.max(1, Math.min(atp > 0 ? atp : 1, 30)),
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);

  const canEnter =
    !pending &&
    lot != null &&
    kgValue > 0 &&
    atp >= kgValue;

  async function onConfirm() {
    if (!lot) return;
    setError(null);
    setPending(true);
    const result = await enterAuctionLotAction({
      auctionId,
      greenLotCode: lot.greenLotCode,
      kg: kgValue,
      idempotencyKey: newKey(),
    });
    setPending(false);
    if (result.ok) {
      setEntered(true);
      setConfirmOpen(false);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="glass-card rounded-2xl p-5">
      <h2 className="font-display text-base font-semibold text-ink">
        {t("enter.heading")}
      </h2>
      <p className="mt-1 text-sm text-muted-fg">{t("enter.subheading")}</p>

      {availableLots.length === 0 ? (
        <p className="mt-4 rounded-xl bg-paper/70 px-3 py-3 text-sm text-muted-fg">
          {t("enter.noLots")}
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {/* lot picker */}
          <div className="space-y-1">
            <label className={LABEL} htmlFor="el-lot">
              {t("enter.lotLabel")}
            </label>
            <select
              id="el-lot"
              className={FIELD}
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                const next = availableLots.find(
                  (l) => l.greenLotCode === e.target.value,
                );
                if (next) {
                  setKgValue(Math.max(1, Math.min(next.atpKg, 30)));
                }
              }}
            >
              {availableLots.map((l) => (
                <option key={l.greenLotCode} value={l.greenLotCode}>
                  {t("enter.lotOption", {
                    lot: l.greenLotCode,
                    variety: l.variety ?? l.scaGrade ?? "—",
                    score: l.cuppingScore == null ? "—" : num(l.cuppingScore, 1),
                  })}
                </option>
              ))}
            </select>
            {lot && (
              <p className="text-xs tabular-nums text-muted-fg">
                {t("enter.atpHint", { kg: num(Math.round(atp)) })}
              </p>
            )}
          </div>

          {/* kg */}
          <div className="space-y-1">
            <label className={LABEL} htmlFor="el-kg">
              {t("enter.kgLabel")}
            </label>
            <input
              id="el-kg"
              type="number"
              min={1}
              max={atp > 0 ? atp : undefined}
              step="1"
              inputMode="decimal"
              className={FIELD}
              value={Number.isFinite(kgValue) ? kgValue : ""}
              onChange={(e) => setKgValue(Number(e.target.value))}
            />
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
            >
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            {entered ? (
              <span className="text-sm font-medium text-forest">
                {t("enter.entered")}
              </span>
            ) : (
              <Button
                type="button"
                disabled={!canEnter}
                onClick={() => {
                  setError(null);
                  setConfirmOpen(true);
                }}
              >
                {t("enter.submit")}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* money-shaped confirm — shows the ATP drop live */}
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t("enter.confirmTitle")}
      >
        <div className="space-y-4">
          <p className="text-sm text-ink">
            {t("enter.confirmBody", {
              kg: num(kgValue),
              lot: lot?.greenLotCode ?? "—",
              auction: auctionName,
            })}
          </p>

          <div className="flex items-center justify-between rounded-xl bg-paper/70 px-3 py-3 text-sm">
            <div>
              <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
                {t("enter.atpBefore")}
              </p>
              <p className="font-display text-lg font-bold tabular-nums text-ink">
                {num(Math.round(atp))}
              </p>
            </div>
            <span aria-hidden className="text-muted-fg">
              →
            </span>
            <div className="text-right">
              <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
                {t("enter.atpAfter")}
              </p>
              <p className="font-display text-lg font-bold tabular-nums text-forest">
                {num(Math.max(0, Math.round(atp - kgValue)))}
              </p>
              <p className="text-[0.625rem] text-muted-fg">{t("enter.atpUnit")}</p>
            </div>
          </div>

          <p className="text-xs text-muted-fg">{t("enter.irreversible")}</p>

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
              onClick={() => setConfirmOpen(false)}
            >
              {t("enter.cancel")}
            </Button>
            <Button type="button" disabled={pending || !canEnter} onClick={onConfirm}>
              {pending ? t("enter.entering") : t("enter.confirm")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
