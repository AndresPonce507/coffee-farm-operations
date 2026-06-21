"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Plus } from "lucide-react";

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

const DRIVERS: { value: CostDriver; label: string }[] = [
  { value: "worker-day", label: "Worker-day" },
  { value: "task", label: "Task" },
  { value: "processing-batch", label: "Processing batch" },
];

const RULES: { value: AllocationRule; label: string }[] = [
  { value: "direct-labor", label: "Direct labor → lot" },
  { value: "processing", label: "Processing → lot" },
  { value: "agronomy", label: "Agronomy → plot" },
  { value: "overhead", label: "Overhead → farm" },
];

const KINDS: { value: CostTargetKind; label: string }[] = [
  { value: "lot", label: "Lot" },
  { value: "plot", label: "Plot" },
  { value: "farm", label: "Farm (whole)" },
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
      setError("Enter a valid amount.");
      return;
    }
    if (amountUsd < 0) {
      setError("Amount must be at least 0 — corrections post as a reversal.");
      return;
    }
    if (!isFarm && !targetCode.trim()) {
      setError(`Choose a ${targetKind} for this cost.`);
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
            Driver
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
                {d.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="allocationRule">
            Allocation rule
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
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="targetKind">
            Target
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
                {k.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="targetCode">
            Target code
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
              {isFarm ? "Whole farm — no target" : "Choose…"}
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
          Amount (USD)
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
          Memo
        </label>
        <input
          id="memo"
          name="memo"
          type="text"
          placeholder="Optional note"
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
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Booking…" : "Book cost"}
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
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Book a cost
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Book a cost">
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
