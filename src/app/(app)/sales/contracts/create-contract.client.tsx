"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FilePlus2, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD, LABEL } from "@/components/ui/form-field";
import {
  createBuyerAction,
  createContractAction,
} from "./actions";
import type { Buyer, BuyerType, PricingBasis } from "./data";

/**
 * Create-contract island — the ONE interactive control on /sales/contracts (the board
 * stays a Server Component). A single glass dialog with two modes: create a contract
 * (buyer + Incoterm 2020 + standard + pricing basis), or add a buyer first when none
 * exist yet. Every field maps 1:1 to the DB CHECK constraints, so the form can only
 * ever submit a shape the database accepts. A human submits; nothing is driven by
 * untrusted inbound (rail §7).
 */

const INCOTERMS = [
  "EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP", "FAS", "FOB", "CFR", "CIF",
] as const;
const STANDARDS = ["GCA", "ECF", "custom"] as const;
const BASES: PricingBasis[] = ["fixed", "differential", "auction"];
const TYPES: BuyerType[] = ["roaster", "importer", "agent"];

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `c_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

type Mode = "contract" | "buyer";

export function CreateContract({ buyers }: { buyers: Buyer[] }) {
  const t = useTranslations("sales");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(buyers.length === 0 ? "buyer" : "contract");

  // contract fields
  const [buyerId, setBuyerId] = useState<string>(
    buyers[0]?.id != null ? String(buyers[0].id) : "",
  );
  const [incoterm, setIncoterm] = useState<string>("FOB");
  const [namedPlace, setNamedPlace] = useState<string>("");
  const [standard, setStandard] = useState<(typeof STANDARDS)[number]>("GCA");
  const [basis, setBasis] = useState<PricingBasis>("fixed");
  const [currency, setCurrency] = useState<string>("USD");

  // buyer fields
  const [bName, setBName] = useState<string>("");
  const [bCountry, setBCountry] = useState<string>("");
  const [bType, setBType] = useState<BuyerType>("roaster");
  const [bIncoterm, setBIncoterm] = useState<string>("FOB");
  const [bCurrency, setBCurrency] = useState<string>("USD");

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setError(null);
  }

  async function onCreateContract() {
    setError(null);
    setPending(true);
    const result = await createContractAction({
      buyerId: Number(buyerId),
      incoterm,
      incotermNamedPlace: namedPlace,
      contractStandard: standard,
      pricingBasis: basis,
      currency,
      idempotencyKey: newKey(),
    });
    setPending(false);
    if (result.ok) {
      close();
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  async function onCreateBuyer() {
    setError(null);
    setPending(true);
    const result = await createBuyerAction({
      name: bName,
      countryCode: bCountry,
      buyerType: bType,
      defaultIncoterm: bIncoterm,
      defaultCurrency: bCurrency,
      idempotencyKey: newKey(),
    });
    setPending(false);
    if (result.ok) {
      setBName("");
      setBCountry("");
      setMode("contract");
      setBuyerId(String(result.buyerId));
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <FilePlus2 className="h-4 w-4" aria-hidden />
        {t("contracts.create.open")}
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title={
          mode === "buyer"
            ? t("contracts.newBuyer.title")
            : t("contracts.create.title")
        }
      >
        {mode === "buyer" ? (
          <div className="space-y-4">
            <div className="space-y-1">
              <label className={LABEL} htmlFor="cb-name">
                {t("contracts.newBuyer.nameLabel")}
              </label>
              <input
                id="cb-name"
                type="text"
                className={FIELD}
                placeholder={t("contracts.newBuyer.namePlaceholder")}
                value={bName}
                onChange={(e) => setBName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className={LABEL} htmlFor="cb-country">
                  {t("contracts.newBuyer.countryLabel")}
                </label>
                <input
                  id="cb-country"
                  type="text"
                  className={FIELD}
                  placeholder={t("contracts.newBuyer.countryPlaceholder")}
                  value={bCountry}
                  onChange={(e) => setBCountry(e.target.value.toUpperCase())}
                />
              </div>
              <div className="space-y-1">
                <label className={LABEL} htmlFor="cb-type">
                  {t("contracts.newBuyer.typeLabel")}
                </label>
                <select
                  id="cb-type"
                  className={FIELD}
                  value={bType}
                  onChange={(e) => setBType(e.target.value as BuyerType)}
                >
                  {TYPES.map((ty) => (
                    <option key={ty} value={ty}>
                      {t(`contracts.newBuyer.type.${ty}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className={LABEL} htmlFor="cb-incoterm">
                  {t("contracts.newBuyer.incotermLabel")}
                </label>
                <select
                  id="cb-incoterm"
                  className={FIELD}
                  value={bIncoterm}
                  onChange={(e) => setBIncoterm(e.target.value)}
                >
                  {INCOTERMS.map((ic) => (
                    <option key={ic} value={ic}>
                      {ic}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className={LABEL} htmlFor="cb-currency">
                  {t("contracts.newBuyer.currencyLabel")}
                </label>
                <input
                  id="cb-currency"
                  type="text"
                  className={FIELD}
                  value={bCurrency}
                  onChange={(e) => setBCurrency(e.target.value.toUpperCase())}
                />
              </div>
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
              >
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              {buyers.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setMode("contract");
                    setError(null);
                  }}
                >
                  {t("contracts.newBuyer.cancel")}
                </Button>
              )}
              <Button type="button" disabled={pending} onClick={onCreateBuyer}>
                {pending
                  ? t("contracts.newBuyer.saving")
                  : t("contracts.newBuyer.submit")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* buyer picker + add-buyer affordance */}
            <div className="space-y-1">
              <label className={LABEL} htmlFor="cc-buyer">
                {t("contracts.create.buyerLabel")}
              </label>
              <div className="flex gap-2">
                <select
                  id="cc-buyer"
                  className={FIELD}
                  value={buyerId}
                  onChange={(e) => setBuyerId(e.target.value)}
                >
                  {buyers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.countryCode ? ` · ${b.countryCode}` : ""}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setMode("buyer");
                    setError(null);
                  }}
                >
                  <UserPlus className="h-4 w-4" aria-hidden />
                  <span className="sr-only">{t("contracts.newBuyer.open")}</span>
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className={LABEL} htmlFor="cc-incoterm">
                  {t("contracts.create.incotermLabel")}
                </label>
                <select
                  id="cc-incoterm"
                  className={FIELD}
                  value={incoterm}
                  onChange={(e) => setIncoterm(e.target.value)}
                >
                  {INCOTERMS.map((ic) => (
                    <option key={ic} value={ic}>
                      {ic}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className={LABEL} htmlFor="cc-place">
                  {t("contracts.create.namedPlaceLabel")}
                </label>
                <input
                  id="cc-place"
                  type="text"
                  className={FIELD}
                  placeholder={t("contracts.create.namedPlacePlaceholder")}
                  value={namedPlace}
                  onChange={(e) => setNamedPlace(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className={LABEL} htmlFor="cc-standard">
                  {t("contracts.create.standardLabel")}
                </label>
                <select
                  id="cc-standard"
                  className={FIELD}
                  value={standard}
                  onChange={(e) =>
                    setStandard(e.target.value as (typeof STANDARDS)[number])
                  }
                >
                  {STANDARDS.map((s) => (
                    <option key={s} value={s}>
                      {s === "custom" ? "Custom" : s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className={LABEL} htmlFor="cc-basis">
                  {t("contracts.create.basisLabel")}
                </label>
                <select
                  id="cc-basis"
                  className={FIELD}
                  value={basis}
                  onChange={(e) => setBasis(e.target.value as PricingBasis)}
                >
                  {BASES.map((b) => (
                    <option key={b} value={b}>
                      {t(`contracts.basis.${b}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className={LABEL} htmlFor="cc-currency">
                {t("contracts.create.currencyLabel")}
              </label>
              <input
                id="cc-currency"
                type="text"
                className={FIELD}
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
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

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={close}>
                {t("contracts.create.cancel")}
              </Button>
              <Button
                type="button"
                disabled={pending || buyers.length === 0}
                onClick={onCreateContract}
              >
                {pending
                  ? t("contracts.create.creating")
                  : t("contracts.create.submit")}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
