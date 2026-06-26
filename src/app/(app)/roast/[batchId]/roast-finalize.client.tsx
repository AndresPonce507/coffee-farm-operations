"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileUp, Flame, Tag } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD, LABEL } from "@/components/ui/form-field";
import { num } from "@/lib/utils";
import {
  finalizeRoastBatchAction,
  importRoastAlogAction,
  linkRoastSkuAction,
} from "../actions";

/**
 * RoastFinalize — the interactive island on /roast/[batchId] (the page stays a Server
 * Component). Three human-driven flows (rail §7 — no untrusted inbound):
 *   • Import .alog — records an Artisan capture as evidence (moves no inventory).
 *   • Finalize    — mints the roasted lot + posts roast cost to COGS; the mass/cost-
 *     shaped, irreversible write sits behind a confirm. Open batches only.
 *   • Link SKU    — links a bag SKU once the batch is finalized.
 * Each writes through a single SECURITY DEFINER RPC; on success the page re-reads via
 * router.refresh(). NULLs are honest — an un-priced SKU forwards null, never 0.
 */

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `rf_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

function numOrNull(s: string): number | null {
  const v = s.trim();
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function RoastFinalize({
  batchId,
  status,
  greenInKg,
}: {
  batchId: number;
  status: string;
  greenInKg: number;
}) {
  const t = useTranslations("roast");
  const isFinalized = status === "finalized";

  const [importOpen, setImportOpen] = useState(false);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  return (
    <aside className="glass-card h-fit space-y-3 rounded-2xl p-5">
      <h2 className="font-display text-base font-semibold text-ink">
        {t("detail.eyebrow")}
      </h2>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => setImportOpen(true)}
      >
        <FileUp className="h-4 w-4" aria-hidden />
        {t("finalize.importOpen")}
      </Button>

      {!isFinalized && (
        <Button
          type="button"
          className="w-full"
          onClick={() => setFinalizeOpen(true)}
        >
          <Flame className="h-4 w-4" aria-hidden />
          {t("finalize.finalizeOpen")}
        </Button>
      )}

      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={!isFinalized}
        onClick={() => setLinkOpen(true)}
      >
        <Tag className="h-4 w-4" aria-hidden />
        {t("finalize.linkOpen")}
      </Button>
      {!isFinalized && (
        <p className="text-[0.6875rem] text-muted-fg">
          {t("finalize.notFinalized")}
        </p>
      )}

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        batchId={batchId}
      />
      <FinalizeDialog
        open={finalizeOpen}
        onClose={() => setFinalizeOpen(false)}
        batchId={batchId}
        greenInKg={greenInKg}
      />
      <LinkDialog
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        batchId={batchId}
      />
    </aside>
  );
}

function ImportDialog({
  open,
  onClose,
  batchId,
}: {
  open: boolean;
  onClose: () => void;
  batchId: number;
}) {
  const t = useTranslations("roast");
  const router = useRouter();
  const [payloadStr, setPayloadStr] = useState("");
  const [filename, setFilename] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit() {
    setError(null);
    let payload: unknown;
    try {
      payload = JSON.parse(payloadStr);
    } catch {
      setError(t("finalize.invalidJson"));
      return;
    }
    setPending(true);
    const result = await importRoastAlogAction({
      batchId,
      sourceFilename: filename.trim() === "" ? null : filename.trim(),
      payload,
      idempotencyKey: newKey(),
    });
    setPending(false);
    if (result.ok) {
      setDone(true);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("finalize.importTitle")}>
      {done ? (
        <p className="text-sm font-medium text-forest">{t("finalize.imported")}</p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1">
            <label className={LABEL} htmlFor="ri-payload">
              {t("finalize.payloadLabel")}
            </label>
            <textarea
              id="ri-payload"
              rows={5}
              className={`${FIELD} font-mono text-xs`}
              value={payloadStr}
              onChange={(e) => setPayloadStr(e.target.value)}
            />
            <p className="text-[0.6875rem] text-muted-fg">
              {t("finalize.payloadHint")}
            </p>
          </div>
          <div className="space-y-1">
            <label className={LABEL} htmlFor="ri-file">
              {t("finalize.filenameLabel")}
            </label>
            <input
              id="ri-file"
              type="text"
              className={FIELD}
              placeholder={t("finalize.filenamePlaceholder")}
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
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
            <Button type="button" variant="outline" onClick={onClose}>
              {t("lock.cancel")}
            </Button>
            <Button
              type="button"
              disabled={pending || payloadStr.trim() === ""}
              onClick={onSubmit}
            >
              {pending ? t("finalize.importing") : t("finalize.importSubmit")}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function FinalizeDialog({
  open,
  onClose,
  batchId,
  greenInKg,
}: {
  open: boolean;
  onClose: () => void;
  batchId: number;
  greenInKg: number;
}) {
  const t = useTranslations("roast");
  const router = useRouter();
  const [kgStr, setKgStr] = useState("");
  const [costStr, setCostStr] = useState("");
  const [location, setLocation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mintedCode, setMintedCode] = useState<string | null>(null);

  const kg = numOrNull(kgStr);
  const shrinkagePreview =
    kg != null && kg > 0 && greenInKg > 0
      ? Math.round(((greenInKg - kg) / greenInKg) * 100)
      : null;

  const canSubmit = !pending && kg != null && kg >= 0;

  async function onSubmit() {
    if (!canSubmit || kg == null) return;
    setError(null);
    setPending(true);
    const result = await finalizeRoastBatchAction({
      batchId,
      roastedKgOut: kg,
      roastCostUsd: costStr.trim() === "" ? 0 : Number(costStr),
      location: location.trim() === "" ? null : location.trim(),
      idempotencyKey: newKey(),
    });
    setPending(false);
    if (result.ok) {
      setMintedCode(result.roastedLotCode);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("finalize.finalizeTitle")}>
      {mintedCode ? (
        <p className="text-sm font-medium text-forest">
          {t("finalize.finalized", { lot: mintedCode })}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1">
            <label className={LABEL} htmlFor="rfz-kg">
              {t("finalize.roastedKg")}
            </label>
            <input
              id="rfz-kg"
              type="number"
              min={0}
              step="0.1"
              inputMode="decimal"
              className={FIELD}
              value={kgStr}
              onChange={(e) => setKgStr(e.target.value)}
            />
            <p className="text-[0.6875rem] tabular-nums text-muted-fg">
              {t("finalize.greenInLine", { kg: num(greenInKg) })}
              {shrinkagePreview != null && (
                <>
                  {" · "}
                  {t("finalize.shrinkagePreview", { pct: num(shrinkagePreview) })}
                </>
              )}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className={LABEL} htmlFor="rfz-cost">
                {t("finalize.cost")}
              </label>
              <input
                id="rfz-cost"
                type="number"
                min={0}
                step="1"
                inputMode="decimal"
                className={FIELD}
                value={costStr}
                onChange={(e) => setCostStr(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className={LABEL} htmlFor="rfz-loc">
                {t("finalize.location")}
              </label>
              <input
                id="rfz-loc"
                type="text"
                className={FIELD}
                placeholder={t("finalize.locationPlaceholder")}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
          </div>

          <p className="text-xs text-muted-fg">{t("finalize.irreversible")}</p>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
            >
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("lock.cancel")}
            </Button>
            <Button type="button" disabled={!canSubmit} onClick={onSubmit}>
              {pending ? t("finalize.finalizing") : t("finalize.confirm")}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function LinkDialog({
  open,
  onClose,
  batchId,
}: {
  open: boolean;
  onClose: () => void;
  batchId: number;
}) {
  const t = useTranslations("roast");
  const router = useRouter();
  const [skuCode, setSkuCode] = useState("");
  const [bagStr, setBagStr] = useState("");
  const [priceStr, setPriceStr] = useState("");
  const [gtin, setGtin] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const bag = numOrNull(bagStr);
  const canSubmit = !pending && skuCode.trim() !== "" && bag != null && bag > 0;

  async function onSubmit() {
    if (!canSubmit || bag == null) return;
    setError(null);
    setPending(true);
    const result = await linkRoastSkuAction({
      batchId,
      skuCode: skuCode.trim(),
      bagSizeG: bag,
      priceUsd: numOrNull(priceStr),
      gtin: gtin.trim() === "" ? null : gtin.trim(),
      idempotencyKey: newKey(),
    });
    setPending(false);
    if (result.ok) {
      setDone(true);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("finalize.linkTitle")}>
      {done ? (
        <p className="text-sm font-medium text-forest">{t("finalize.linked")}</p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1">
            <label className={LABEL} htmlFor="rl-sku">
              {t("finalize.skuCode")}
            </label>
            <input
              id="rl-sku"
              type="text"
              className={FIELD}
              placeholder={t("finalize.skuCodePlaceholder")}
              value={skuCode}
              onChange={(e) => setSkuCode(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className={LABEL} htmlFor="rl-bag">
                {t("finalize.bagSize")}
              </label>
              <input
                id="rl-bag"
                type="number"
                min={0}
                step="1"
                inputMode="numeric"
                className={FIELD}
                value={bagStr}
                onChange={(e) => setBagStr(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className={LABEL} htmlFor="rl-price">
                {t("finalize.price")}
              </label>
              <input
                id="rl-price"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                className={FIELD}
                value={priceStr}
                onChange={(e) => setPriceStr(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className={LABEL} htmlFor="rl-gtin">
              {t("finalize.gtin")}
            </label>
            <input
              id="rl-gtin"
              type="text"
              className={FIELD}
              value={gtin}
              onChange={(e) => setGtin(e.target.value)}
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
            <Button type="button" variant="outline" onClick={onClose}>
              {t("lock.cancel")}
            </Button>
            <Button type="button" disabled={!canSubmit} onClick={onSubmit}>
              {pending ? t("finalize.linking") : t("finalize.linkSubmit")}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
