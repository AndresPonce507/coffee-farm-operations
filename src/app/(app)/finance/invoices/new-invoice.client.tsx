"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD, LABEL } from "@/components/ui/form-field";
import { usd } from "@/lib/utils";
import { issueArDocAction } from "../actions";

/**
 * The "New invoice" issue composer — the ONE interactive island on the AR board.
 *
 * A human fills the kind, currency, buyer + (for a commercial invoice) the contract
 * and Incoterm, plus a single green-lot line, then issues. issue_ar_doc commits the
 * line's kg as a lot_shipments row in the same txn, so the EXISTING prevent_oversell
 * rejects an invoice that would double-sell a scarce lot — the DB guard message comes
 * back verbatim and renders here. Issuing is the human click (rail §7); the
 * idempotency_key is client-minted so an exactly-once retry collapses to one doc.
 */

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `inv_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

const KINDS = ["proforma", "commercial_invoice", "credit_note", "dtc_receipt"] as const;
const TARGETS = ["qbo", "xero", "dgi_pac"] as const;

export function NewInvoice() {
  const t = useTranslations("finance");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string>("commercial_invoice");
  const [currency, setCurrency] = useState("USD");
  const [buyer, setBuyer] = useState("");
  const [contract, setContract] = useState("");
  const [incoterm, setIncoterm] = useState("FOB");
  const [target, setTarget] = useState<string>("qbo");
  const [lot, setLot] = useState("");
  const [description, setDescription] = useState("");
  const [kg, setKg] = useState("");
  const [unitPrice, setUnitPrice] = useState("");

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kgNum = Number(kg);
  const unitNum = Number(unitPrice);
  const amount = useMemo(() => {
    if (Number.isFinite(kgNum) && kgNum > 0 && Number.isFinite(unitNum)) {
      return kgNum * unitNum;
    }
    return Number.isFinite(unitNum) ? unitNum : 0;
  }, [kgNum, unitNum]);

  async function submit() {
    setError(null);
    setPending(true);
    const result = await issueArDocAction({
      kind,
      currency,
      lines: [
        {
          greenLotCode: lot.trim() || null,
          description: description.trim() || t("invoices.new"),
          kg: Number.isFinite(kgNum) && kgNum > 0 ? kgNum : null,
          unitPriceDoc: Number.isFinite(unitNum) ? unitNum : 0,
          amountDoc: amount,
          sourceKind: "green_sale",
        },
      ],
      buyerRef: buyer,
      contractRef: contract.trim() || null,
      incoterm: incoterm.trim() || null,
      targets: [target],
      idempotencyKey: newKey(),
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden />
        {t("invoices.new")}
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title={t("invoices.new")}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className={LABEL}>{t("invoice.eyebrow")}</span>
              <select
                className={FIELD}
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`kind.${k}` as "kind.commercial_invoice")}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={LABEL}>{t("pay.method")}</span>
              <select
                className={FIELD}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                {TARGETS.map((tg) => (
                  <option key={tg} value={tg}>
                    {t(`sync.target.${tg}` as "sync.target.qbo")}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className={LABEL}>{t("invoice.summary.buyer", { buyer: "" })}</span>
              <input
                className={FIELD}
                value={buyer}
                onChange={(e) => setBuyer(e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className={LABEL}>{t("pay.amount", { currency: "" })}</span>
              <input
                className={FIELD}
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
            </label>
          </div>

          {kind === "commercial_invoice" && (
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className={LABEL}>
                  {t("invoice.summary.contract", { contract: "" })}
                </span>
                <input
                  className={FIELD}
                  value={contract}
                  onChange={(e) => setContract(e.target.value)}
                />
              </label>
              <label className="space-y-1">
                <span className={LABEL}>
                  {t("invoice.summary.incoterm", { incoterm: "" })}
                </span>
                <input
                  className={FIELD}
                  value={incoterm}
                  onChange={(e) => setIncoterm(e.target.value)}
                />
              </label>
            </div>
          )}

          <div className="rounded-xl border border-line bg-paper/60 p-3">
            <p className={LABEL}>{t("invoice.lines.title")}</p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className={LABEL}>{t("invoice.lines.lot", { lot: "" })}</span>
                <input
                  className={FIELD}
                  value={lot}
                  onChange={(e) => setLot(e.target.value.toUpperCase())}
                  placeholder="JC-901"
                />
              </label>
              <label className="space-y-1">
                <span className={LABEL}>{t("invoice.lines.provenance")}</span>
                <input
                  className={FIELD}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <label className="space-y-1">
                <span className={LABEL}>kg</span>
                <input
                  className={FIELD}
                  inputMode="decimal"
                  value={kg}
                  onChange={(e) => setKg(e.target.value)}
                />
              </label>
              <label className="space-y-1">
                <span className={LABEL}>{t("invoice.margin.revenuePerKg")}</span>
                <input
                  className={FIELD}
                  inputMode="decimal"
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                />
              </label>
            </div>
            <p className="mt-2 text-right text-sm font-medium tabular-nums text-forest">
              {usd(amount, amount < 100 ? 2 : 0)}
            </p>
          </div>

          {error && (
            <p className="rounded-lg bg-cherry-100 px-3 py-2 text-sm text-cherry">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {t("pay.cancel")}
            </Button>
            <Button onClick={submit} disabled={pending || amount <= 0}>
              {t("invoices.new")}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
