"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeftRight, PackagePlus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD, LABEL } from "@/components/ui/form-field";
import { num } from "@/lib/utils";
import {
  createProductAction,
  createSkuAction,
  recordFgMovementAction,
} from "./actions";
import {
  BAG_SIZES,
  FG_OUTBOUND_REASONS,
  FG_REASONS,
  PACK_FORMATS,
  type FgReason,
} from "./constants";
import type { CatalogProduct, LotPick } from "./data";

/**
 * Catalog manager — the write affordances for /shop (the board stays a Server
 * Component). Three glass dialogs, each a thin form over a SECURITY DEFINER RPC:
 * mint a product, mint a lot-linked SKU (the lot picker surfaces live ATP straight
 * off green_lots_atp, so a bag is only ever backed by inventory the farm holds), and
 * record a finished-goods movement (a sale is signed negative and the DB trigger
 * refuses a below-zero result — the money-shaped path, driven by an explicit human
 * submit, never untrusted inbound). On success each refreshes the route so the board
 * re-derives from the same write.
 */

export interface SkuPick {
  skuId: number;
  label: string;
  availableUnits: number;
}

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `c_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

export function CatalogManager({
  products,
  lots,
  skus,
}: {
  products: CatalogProduct[];
  lots: LotPick[];
  skus: SkuPick[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NewProductButton />
      <NewSkuButton products={products} lots={lots} />
      <RecordMovementButton skus={skus} />
    </div>
  );
}

/* ───────────────────────────── New product ─────────────────────────────── */

function NewProductButton() {
  const t = useTranslations("shop");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [variety, setVariety] = useState("");
  const [process, setProcess] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function reset() {
    setSlug("");
    setName("");
    setVariety("");
    setProcess("");
    setNotes("");
    setError(null);
    setDone(false);
  }

  async function onSubmit() {
    setError(null);
    setPending(true);
    const result = await createProductAction({
      slug,
      name,
      variety: variety.trim() === "" ? null : variety.trim(),
      process: process.trim() === "" ? null : process.trim(),
      tastingNotes: notes.trim() === "" ? null : notes.trim(),
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
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden />
        {t("manage.newProduct")}
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title={t("product.title")}>
        {done ? (
          <div className="space-y-4">
            <p className="text-sm font-medium text-forest">{t("product.created")}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("product.cancel")}
              </Button>
              <Button type="button" onClick={reset}>
                {t("product.another")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <label className={LABEL} htmlFor="np-slug">
                {t("product.slugLabel")}
              </label>
              <input
                id="np-slug"
                type="text"
                className={FIELD}
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
              <p className="text-xs text-muted-fg">{t("product.slugHint")}</p>
            </div>
            <div className="space-y-1">
              <label className={LABEL} htmlFor="np-name">
                {t("product.nameLabel")}
              </label>
              <input
                id="np-name"
                type="text"
                className={FIELD}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className={LABEL} htmlFor="np-variety">
                  {t("product.varietyLabel")}
                </label>
                <input
                  id="np-variety"
                  type="text"
                  className={FIELD}
                  value={variety}
                  onChange={(e) => setVariety(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className={LABEL} htmlFor="np-process">
                  {t("product.processLabel")}
                </label>
                <input
                  id="np-process"
                  type="text"
                  className={FIELD}
                  value={process}
                  onChange={(e) => setProcess(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className={LABEL} htmlFor="np-notes">
                {t("product.notesLabel")}
              </label>
              <input
                id="np-notes"
                type="text"
                className={FIELD}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
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
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("product.cancel")}
              </Button>
              <Button type="button" disabled={pending} onClick={onSubmit}>
                {pending ? t("product.saving") : t("product.submit")}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

/* ─────────────────────────────── New SKU ───────────────────────────────── */

function NewSkuButton({
  products,
  lots,
}: {
  products: CatalogProduct[];
  lots: LotPick[];
}) {
  const t = useTranslations("shop");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState<number>(products[0]?.id ?? 0);
  const [lotCode, setLotCode] = useState<string>(lots[0]?.greenLotCode ?? "");
  const [packFormat, setPackFormat] = useState<string>(PACK_FORMATS[0]);
  const [bagSize, setBagSize] = useState<string>(BAG_SIZES[0]);
  const [priceStr, setPriceStr] = useState("");
  const [gtin, setGtin] = useState("");
  const [reserveClub, setReserveClub] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const canCompose = products.length > 0 && lots.length > 0;

  function reset() {
    setPriceStr("");
    setGtin("");
    setReserveClub(false);
    setError(null);
    setDone(false);
  }

  async function onSubmit() {
    setError(null);
    setPending(true);
    const dollars = priceStr.trim() === "" ? 0 : Number(priceStr);
    const result = await createSkuAction({
      productId,
      greenLotCode: lotCode,
      roastSkuId: null,
      packFormat,
      bagSize,
      priceUsdCents: Math.round((Number.isFinite(dollars) ? dollars : 0) * 100),
      gtin: gtin.trim() === "" ? null : gtin.trim(),
      stripePriceId: null,
      isReserveClub: reserveClub,
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
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <PackagePlus className="h-4 w-4" aria-hidden />
        {t("manage.newSku")}
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title={t("sku.title")}>
        {products.length === 0 ? (
          <p className="text-sm text-muted-fg">{t("sku.noProducts")}</p>
        ) : lots.length === 0 ? (
          <p className="text-sm text-muted-fg">{t("sku.noLots")}</p>
        ) : done ? (
          <div className="space-y-4">
            <p className="text-sm font-medium text-forest">{t("sku.created")}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("sku.cancel")}
              </Button>
              <Button type="button" onClick={reset}>
                {t("sku.another")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* product */}
            <div className="space-y-1">
              <label className={LABEL} htmlFor="sku-product">
                {t("sku.productLabel")}
              </label>
              <select
                id="sku-product"
                className={FIELD}
                value={productId}
                onChange={(e) => setProductId(Number(e.target.value))}
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* lot picker — ATP straight off green_lots_atp */}
            <div className="space-y-1">
              <label className={LABEL} htmlFor="sku-lot">
                {t("sku.lotLabel")}
              </label>
              <select
                id="sku-lot"
                className={FIELD}
                value={lotCode}
                onChange={(e) => setLotCode(e.target.value)}
              >
                {lots.map((l) => (
                  <option key={l.greenLotCode} value={l.greenLotCode}>
                    {l.greenLotCode}
                    {" · "}
                    {l.atpKg != null && l.atpKg > 0
                      ? t("sku.lotAtp", { kg: num(Math.round(l.atpKg)) })
                      : t("sku.lotNoAtp")}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-fg">{t("sku.lotHint")}</p>
            </div>

            {/* pack + bag */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className={LABEL} htmlFor="sku-pack">
                  {t("sku.packLabel")}
                </label>
                <select
                  id="sku-pack"
                  className={FIELD}
                  value={packFormat}
                  onChange={(e) => setPackFormat(e.target.value)}
                >
                  {PACK_FORMATS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className={LABEL} htmlFor="sku-bag">
                  {t("sku.bagLabel")}
                </label>
                <select
                  id="sku-bag"
                  className={FIELD}
                  value={bagSize}
                  onChange={(e) => setBagSize(e.target.value)}
                >
                  {BAG_SIZES.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* price + gtin */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className={LABEL} htmlFor="sku-price">
                  {t("sku.priceLabel")}
                </label>
                <input
                  id="sku-price"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  className={FIELD}
                  value={priceStr}
                  onChange={(e) => setPriceStr(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className={LABEL} htmlFor="sku-gtin">
                  {t("sku.gtinLabel")}
                </label>
                <input
                  id="sku-gtin"
                  type="text"
                  className={FIELD}
                  value={gtin}
                  onChange={(e) => setGtin(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-fg">{t("sku.gtinHint")}</p>

            {/* reserve club */}
            <label className="flex items-center gap-2 text-sm text-ink" htmlFor="sku-reserve">
              <input
                id="sku-reserve"
                type="checkbox"
                className="h-4 w-4 rounded border-line text-forest accent-forest"
                checked={reserveClub}
                onChange={(e) => setReserveClub(e.target.checked)}
              />
              {t("sku.reserveLabel")}
            </label>

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
                {t("sku.cancel")}
              </Button>
              <Button
                type="button"
                disabled={pending || !canCompose}
                onClick={onSubmit}
              >
                {pending ? t("sku.saving") : t("sku.submit")}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

/* ───────────────────────── Record finished-goods movement ──────────────── */

function RecordMovementButton({ skus }: { skus: SkuPick[] }) {
  const t = useTranslations("shop");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [skuId, setSkuId] = useState<number>(skus[0]?.skuId ?? 0);
  const [reason, setReason] = useState<FgReason>("roast-in");
  const [unitsStr, setUnitsStr] = useState("");
  const [direction, setDirection] = useState<"add" | "remove">("add");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function reset() {
    setUnitsStr("");
    setError(null);
    setDone(false);
  }

  function signedQty(): number {
    const units = Math.max(0, Math.trunc(Number(unitsStr) || 0));
    if (reason === "adjust") return direction === "remove" ? -units : units;
    if (FG_OUTBOUND_REASONS.includes(reason)) return -units;
    return units;
  }

  async function onSubmit() {
    setError(null);
    setPending(true);
    const result = await recordFgMovementAction({
      skuId,
      qtyUnits: signedQty(),
      reason,
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
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <ArrowLeftRight className="h-4 w-4" aria-hidden />
        {t("manage.recordMovement")}
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title={t("movement.title")}>
        {skus.length === 0 ? (
          <p className="text-sm text-muted-fg">{t("movement.noSkus")}</p>
        ) : done ? (
          <div className="space-y-4">
            <p className="text-sm font-medium text-forest">{t("movement.recorded")}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("movement.cancel")}
              </Button>
              <Button type="button" onClick={reset}>
                {t("movement.another")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <label className={LABEL} htmlFor="mv-sku">
                {t("movement.skuLabel")}
              </label>
              <select
                id="mv-sku"
                className={FIELD}
                value={skuId}
                onChange={(e) => setSkuId(Number(e.target.value))}
              >
                {skus.map((s) => (
                  <option key={s.skuId} value={s.skuId}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className={LABEL} htmlFor="mv-reason">
                {t("movement.reasonLabel")}
              </label>
              <select
                id="mv-reason"
                className={FIELD}
                value={reason}
                onChange={(e) => setReason(e.target.value as FgReason)}
              >
                {FG_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`movement.reason.${r}`)}
                  </option>
                ))}
              </select>
            </div>

            {reason === "adjust" && (
              <div className="space-y-1">
                <label className={LABEL} htmlFor="mv-direction">
                  {t("movement.directionLabel")}
                </label>
                <select
                  id="mv-direction"
                  className={FIELD}
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as "add" | "remove")}
                >
                  <option value="add">{t("movement.directionAdd")}</option>
                  <option value="remove">{t("movement.directionRemove")}</option>
                </select>
              </div>
            )}

            <div className="space-y-1">
              <label className={LABEL} htmlFor="mv-units">
                {t("movement.unitsLabel")}
              </label>
              <input
                id="mv-units"
                type="number"
                min={1}
                step="1"
                inputMode="numeric"
                className={FIELD}
                value={unitsStr}
                onChange={(e) => setUnitsStr(e.target.value)}
              />
              <p className="text-xs text-muted-fg">{t("movement.unitsHint")}</p>
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
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("movement.cancel")}
              </Button>
              <Button type="button" disabled={pending} onClick={onSubmit}>
                {pending ? t("movement.saving") : t("movement.submit")}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
