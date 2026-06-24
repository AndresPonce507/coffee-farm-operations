"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { bookCostEntry } from "@/app/(app)/costing/actions";
import type {
  AllocationRule,
  BookCostEntryInput,
  CostDriver,
  CostTargetKind,
} from "@/app/(app)/costing/actions";

const FIELD =
  "h-10 w-full rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100 disabled:opacity-50 disabled:pointer-events-none";
const LABEL = "text-xs font-medium text-muted-fg";

// `value`s are the wire contract (kept verbatim); `labelKey` resolves the
// user-visible option text through the `costing` dictionary at render time.
const DRIVERS: { value: CostDriver; labelKey: string }[] = [
  { value: "worker-day", labelKey: "entryForm.driverWorkerDay" },
  { value: "task", labelKey: "entryForm.driverTask" },
  { value: "processing-batch", labelKey: "entryForm.driverProcessingBatch" },
];

const RULES: { value: AllocationRule; labelKey: string }[] = [
  { value: "direct-labor", labelKey: "entryForm.ruleDirectLabor" },
  { value: "processing", labelKey: "entryForm.ruleProcessing" },
  { value: "agronomy", labelKey: "entryForm.ruleAgronomy" },
  { value: "overhead", labelKey: "entryForm.ruleOverhead" },
];

const KINDS: { value: CostTargetKind; labelKey: string }[] = [
  { value: "lot", labelKey: "entryForm.kindLot" },
  { value: "plot", labelKey: "entryForm.kindPlot" },
  { value: "farm", labelKey: "entryForm.kindFarm" },
];

type BookAction = (
  input: BookCostEntryInput,
) => Promise<{ ok: true } | { ok: false; error: string }>;

/**
 * CostEntryForm — the S7 WRITE affordance: book a cost onto the append-only
 * `cost_entry` ledger from /costing. A controlled form so the `target_code`
 * input can toggle with `target_kind` (a farm row carries no target, mirroring
 * the DB CHECK). On submit it calls the `bookCostEntry` Server Action with a
 * typed object, shows inline validation + the action's error, and resets/closes
 * on success. Glass-lite styling matches the harvest form.
 *
 * `lots` are lot codes (lots.code) and `plots` carry {id,name} — the two
 * target_code namespaces; for a lot target the code IS the lot code, for a plot
 * target the code is the plot id.
 */
export function CostEntryForm({
  lots,
  plots,
  action,
  onDone,
}: {
  lots: string[];
  plots: { id: string; name: string }[];
  action: BookAction;
  onDone: () => void;
}) {
  const t = useTranslations("costing");
  const [driver, setDriver] = useState<CostDriver>("worker-day");
  const [allocationRule, setAllocationRule] =
    useState<AllocationRule>("direct-labor");
  const [targetKind, setTargetKind] = useState<CostTargetKind>("lot");
  const [targetCode, setTargetCode] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isFarm = targetKind === "farm";

  function reset() {
    setDriver("worker-day");
    setAllocationRule("direct-labor");
    setTargetKind("lot");
    setTargetCode("");
    setAmount("");
    setMemo("");
    setError(null);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const amountUsd = Number(amount.trim());
    // Cheap client-side guards mirroring the action's contract — keep the user
    // out of a doomed round-trip. The action re-validates server-side (SSOT).
    if (!amount.trim() || !Number.isFinite(amountUsd)) {
      setError(t("entryForm.errorInvalidAmount"));
      return;
    }
    if (amountUsd < 0) {
      setError(t("entryForm.errorNegativeAmount"));
      return;
    }
    if (!isFarm && !targetCode.trim()) {
      setError(
        targetKind === "plot"
          ? t("entryForm.errorChooseTargetPlot")
          : t("entryForm.errorChooseTargetLot"),
      );
      return;
    }

    const input: BookCostEntryInput = {
      driver,
      allocationRule,
      targetKind,
      targetCode: isFarm ? "" : targetCode,
      amountUsd,
      memo,
    };

    startTransition(async () => {
      const result = await action(input);
      if (result.ok) {
        reset();
        onDone();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="driver">
            {t("entryForm.driver")}
          </label>
          <select
            id="driver"
            name="driver"
            value={driver}
            onChange={(e) => setDriver(e.target.value as CostDriver)}
            className={FIELD}
          >
            {DRIVERS.map((d) => (
              <option key={d.value} value={d.value}>
                {t(d.labelKey)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="allocationRule">
            {t("entryForm.allocationRule")}
          </label>
          <select
            id="allocationRule"
            name="allocationRule"
            value={allocationRule}
            onChange={(e) =>
              setAllocationRule(e.target.value as AllocationRule)
            }
            className={FIELD}
          >
            {RULES.map((r) => (
              <option key={r.value} value={r.value}>
                {t(r.labelKey)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="targetKind">
            {t("entryForm.target")}
          </label>
          <select
            id="targetKind"
            name="targetKind"
            value={targetKind}
            onChange={(e) => {
              setTargetKind(e.target.value as CostTargetKind);
              setTargetCode(""); // a kind switch invalidates the prior code
            }}
            className={FIELD}
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {t(k.labelKey)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="targetCode">
            {t("entryForm.targetCode")}
          </label>
          <select
            id="targetCode"
            name="targetCode"
            value={targetCode}
            onChange={(e) => setTargetCode(e.target.value)}
            disabled={isFarm}
            aria-disabled={isFarm}
            className={FIELD}
          >
            <option value="" disabled>
              {isFarm
                ? t("entryForm.wholeFarmNoTarget")
                : t("entryForm.choose")}
            </option>
            {!isFarm &&
              targetKind === "lot" &&
              lots.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            {!isFarm &&
              targetKind === "plot" &&
              plots.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label className={LABEL} htmlFor="amountUsd">
          {t("entryForm.amountUsd")}
        </label>
        <input
          id="amountUsd"
          name="amountUsd"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={FIELD}
        />
      </div>

      <div className="space-y-1">
        <label className={LABEL} htmlFor="memo">
          {t("entryForm.memo")}
        </label>
        <input
          id="memo"
          name="memo"
          type="text"
          placeholder={t("entryForm.memoPlaceholder")}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          className={FIELD}
        />
      </div>

      {error && (
        <p role="alert" className="text-xs font-medium text-cherry">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("entryForm.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("entryForm.booking") : t("entryForm.bookCost")}
        </Button>
      </div>
    </form>
  );
}

/**
 * BookCostButton — the page-level affordance that opens the CostEntryForm in a
 * glass Dialog (mirrors the harvests `AddHarvestButton`). The action is bound to
 * the `bookCostEntry` Server Action here so the page stays a Server Component
 * that only passes the lot/plot target lists down.
 */
export function BookCostButton({
  lots,
  plots,
}: {
  lots: string[];
  plots: { id: string; name: string }[];
}) {
  const t = useTranslations("costing");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        {t("entryForm.bookACost")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("entryForm.bookACost")}
      >
        <CostEntryForm
          lots={lots}
          plots={plots}
          action={bookCostEntry}
          onDone={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}
