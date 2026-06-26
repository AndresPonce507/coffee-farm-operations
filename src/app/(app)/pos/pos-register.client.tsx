"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CheckCircle2,
  Minus,
  Plus,
  Receipt,
  ShoppingCart,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FIELD, LABEL } from "@/components/ui/form-field";
import { usd } from "@/lib/utils";
import { recordPosSaleAction, type RecordPosSaleInput } from "./actions";
import type { PosTerminal, SellableSku } from "./data";

/**
 * The POS register island — the ONE interactive surface on /pos (the page stays a
 * Server Component). A barista picks a till, taps big-touch bag tiles to build the
 * sale, sees a live ITBMS-inclusive total PREVIEW (the till is authoritative — the
 * server recomputes it), and taps "Charge" (the human confirmation; rail §7 — no
 * untrusted inbound fires this). The client never sends a total.
 *
 * Offline-resilient (rail §9): the (device_id, device_seq) coordinate + a client-minted
 * idempotency key are persisted in localStorage. When the wifi is down the sale is
 * queued durably and replayed through the SAME Server Action on reconnect; exactly-once
 * is the DB's job (the key dedupes), so a double-sync never double-charges.
 *
 * Glove-friendly: 90% Ngäbe-Buglé staff, Spanish-first. Tiles are large touch targets;
 * a sold-out SKU is disabled (a UI mirror of the fail-closed finished_goods guard — the
 * data layer is the real wall).
 */

const DEVICE_ID_KEY = "pos.device_id";
const DEVICE_SEQ_KEY = "pos.device_seq";
const OUTBOX_KEY = "pos.outbox";
const ITBMS_RATE = 0.07; // Panama statutory sales tax — mirrors create_order.

/** USD from integer cents (the schema's money unit), always 2 decimals. */
function centsUsd(cents: number): string {
  return usd(cents / 100, 2);
}

function safeLocal(): Storage | null {
  try {
    const ls = typeof window === "undefined" ? null : window.localStorage;
    // Feature-detect a *functional* Storage: SSR has none, and some test/embedded
    // environments expose a partial stub. A real browser persists the offline queue.
    if (ls && typeof ls.getItem === "function" && typeof ls.setItem === "function") {
      return ls;
    }
    return null;
  } catch {
    return null;
  }
}

function mintKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `pos_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

/** Stable per-install device id (the offline causal anchor), minted + persisted once. */
function deviceId(): string {
  const ls = safeLocal();
  if (!ls) return mintKey();
  let v = ls.getItem(DEVICE_ID_KEY);
  if (!v) {
    v = mintKey();
    ls.setItem(DEVICE_ID_KEY, v);
  }
  return v;
}

/** The next monotonic device sequence — durable across reloads (never repeats). */
function nextSeq(): number {
  const ls = safeLocal();
  if (!ls) return Date.now();
  const cur = Number(ls.getItem(DEVICE_SEQ_KEY) ?? "0") || 0;
  const next = cur + 1;
  ls.setItem(DEVICE_SEQ_KEY, String(next));
  return next;
}

function readOutbox(): RecordPosSaleInput[] {
  const ls = safeLocal();
  if (!ls) return [];
  try {
    const raw = ls.getItem(OUTBOX_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as RecordPosSaleInput[]) : [];
  } catch {
    return [];
  }
}

function writeOutbox(items: RecordPosSaleInput[]): void {
  safeLocal()?.setItem(OUTBOX_KEY, JSON.stringify(items));
}

interface CartLine {
  skuId: number;
  qty: number;
}

export function PosRegister({
  terminals,
  skus,
}: {
  terminals: PosTerminal[];
  skus: SellableSku[];
}) {
  const t = useTranslations("pos");
  const router = useRouter();

  const [terminalCode, setTerminalCode] = useState(terminals[0]?.code ?? "");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folio, setFolio] = useState<string | null>(null);
  const [queued, setQueued] = useState(0);
  const [online, setOnline] = useState(true);

  const skuById = new Map(skus.map((s) => [s.skuId, s]));
  const qtyOf = (skuId: number) => cart.find((l) => l.skuId === skuId)?.qty ?? 0;

  const subtotalCents = cart.reduce(
    (acc, l) => acc + (skuById.get(l.skuId)?.priceUsdCents ?? 0) * l.qty,
    0,
  );
  const taxCents = Math.round(subtotalCents * ITBMS_RATE);
  const totalCents = subtotalCents + taxCents;
  const itemCount = cart.reduce((acc, l) => acc + l.qty, 0);

  /** Drain the offline queue through the same action; exactly-once via the key. */
  const flush = useCallback(async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    const items = readOutbox();
    if (items.length === 0) {
      setQueued(0);
      return;
    }
    const remaining: RecordPosSaleInput[] = [];
    for (const item of items) {
      try {
        await recordPosSaleAction(item); // a deterministic rejection drains; a throw keeps
      } catch {
        remaining.push(item);
      }
    }
    writeOutbox(remaining);
    setQueued(remaining.length);
    if (remaining.length < items.length) router.refresh();
  }, [router]);

  // Wire connectivity + the durable queue once mounted (client-only).
  useEffect(() => {
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    setQueued(readOutbox().length);
    void flush();
    const goOnline = () => {
      setOnline(true);
      void flush();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [flush]);

  function addToCart(sku: SellableSku) {
    setFolio(null);
    setError(null);
    setCart((prev) => {
      const found = prev.find((l) => l.skuId === sku.skuId);
      if (!found) return [...prev, { skuId: sku.skuId, qty: 1 }];
      if (found.qty >= sku.availableUnits) return prev; // UI mirror of the oversell guard
      return prev.map((l) =>
        l.skuId === sku.skuId ? { ...l, qty: l.qty + 1 } : l,
      );
    });
  }

  function decFromCart(skuId: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.skuId === skuId ? { ...l, qty: l.qty - 1 } : l))
        .filter((l) => l.qty > 0),
    );
  }

  function removeFromCart(skuId: number) {
    setCart((prev) => prev.filter((l) => l.skuId !== skuId));
  }

  function clearSale() {
    setCart([]);
    setError(null);
    setFolio(null);
  }

  async function onCharge() {
    if (!terminalCode.trim()) {
      setError(t("register.errors.noTerminal"));
      return;
    }
    if (cart.length === 0) {
      setError(t("register.errors.emptyCart"));
      return;
    }
    setError(null);
    setFolio(null);
    setPending(true);

    const input: RecordPosSaleInput = {
      terminalCode,
      customerName: customer.trim() || null,
      customerEmail: null,
      deviceId: deviceId(),
      deviceSeq: nextSeq(),
      lines: cart.map((l) => ({ skuId: l.skuId, qtyUnits: l.qty })),
      currency: "USD",
      idempotencyKey: mintKey(),
    };

    // Offline: queue durably and walk away — the sale syncs on reconnect, once.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      writeOutbox([...readOutbox(), input]);
      setQueued((n) => n + 1);
      setCart([]);
      setCustomer("");
      setError(t("register.offlineQueued"));
      setPending(false);
      return;
    }

    try {
      const result = await recordPosSaleAction(input);
      setPending(false);
      if (result.ok) {
        setFolio(result.saleNo);
        setCart([]);
        setCustomer("");
        router.refresh();
      } else {
        setError(result.error); // keep the cart so the cashier can retry
      }
    } catch {
      // A network drop mid-charge: queue it (the key makes a later replay exactly-once).
      writeOutbox([...readOutbox(), input]);
      setQueued((n) => n + 1);
      setCart([]);
      setCustomer("");
      setError(t("register.offlineQueued"));
      setPending(false);
    }
  }

  return (
    <div className="glass-card rounded-2xl p-5">
      {/* Header: heading + till picker + connectivity pill */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-forest" aria-hidden />
          <h2 className="font-display text-lg font-semibold text-ink">
            {t("register.heading")}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {queued > 0 && (
            <Badge tone="honey" dot>
              {t("register.queuedBadge", { count: queued })}
            </Badge>
          )}
          <Badge tone={online ? "ok" : "warn"} dot>
            {online ? (
              <Wifi className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <WifiOff className="h-3.5 w-3.5" aria-hidden />
            )}
            {online ? t("register.online") : t("register.offline")}
          </Badge>
        </div>
      </div>

      {/* Till picker — a select only when more than one till is registered. */}
      {terminals.length > 1 ? (
        <div className="mt-4 space-y-1">
          <label className={LABEL} htmlFor="pos-terminal">
            {t("register.terminalLabel")}
          </label>
          <select
            id="pos-terminal"
            className={FIELD}
            value={terminalCode}
            onChange={(e) => setTerminalCode(e.target.value)}
          >
            {terminals.map((term) => (
              <option key={term.code} value={term.code}>
                {term.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        terminals[0] && (
          <p className="mt-3 text-sm font-medium text-coffee">
            {terminals[0].name}
          </p>
        )
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr]">
        {/* ── Product tiles ── */}
        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-muted-fg">
            {t("register.catalogHeading")}
          </p>
          {skus.length === 0 ? (
            <p className="rounded-xl bg-paper/70 px-3 py-6 text-center text-sm text-muted-fg">
              {t("register.noSkus")}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {skus.map((sku) => {
                const out = sku.availableUnits <= 0;
                const atCap = qtyOf(sku.skuId) >= sku.availableUnits;
                const inCart = qtyOf(sku.skuId);
                return (
                  <div key={sku.skuId} data-testid={`pos-tile-${sku.skuId}`}>
                    <button
                      type="button"
                      disabled={out || atCap}
                      aria-label={t("register.addAria", { name: sku.productName })}
                      onClick={() => addToCart(sku)}
                      className="glass-hover relative flex h-full min-h-[7.5rem] w-full flex-col justify-between rounded-2xl border border-white/55 bg-white/60 p-3 text-left transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40 disabled:opacity-45 disabled:active:scale-100"
                    >
                      {inCart > 0 && (
                        <span className="absolute right-2 top-2 grid h-6 min-w-6 place-items-center rounded-full bg-forest px-1.5 text-xs font-bold tabular-nums text-paper">
                          {inCart}
                        </span>
                      )}
                      <div>
                        <p className="font-display text-sm font-semibold leading-tight text-ink">
                          {sku.productName}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-fg">
                          {sku.bagSize} · {sku.packFormat}
                        </p>
                        {sku.isReserveClub && (
                          <span className="mt-1 inline-flex">
                            <Badge tone="forest">{t("register.reserveTag")}</Badge>
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex items-end justify-between">
                        <span className="font-display text-base font-bold tabular-nums text-forest">
                          {centsUsd(sku.priceUsdCents)}
                        </span>
                        <span className="text-[0.6875rem] tabular-nums text-muted-fg">
                          {out
                            ? t("register.outOfStock")
                            : t("register.available", { count: sku.availableUnits })}
                        </span>
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Cart / charge panel ── */}
        <div
          data-testid="pos-cart"
          className="flex flex-col rounded-2xl border border-forest/15 bg-forest/[0.03] p-4"
        >
          <p className="mb-2 text-xs uppercase tracking-wide text-muted-fg">
            {t("register.cart.heading")}
          </p>

          {cart.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-fg">
              {t("register.cart.empty")}
            </p>
          ) : (
            <ul className="space-y-2">
              {cart.map((line) => {
                const sku = skuById.get(line.skuId);
                if (!sku) return null;
                return (
                  <li
                    key={line.skuId}
                    className="flex items-center gap-2 rounded-xl bg-paper/80 px-2.5 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">
                        {sku.productName}
                      </p>
                      <p className="text-xs tabular-nums text-muted-fg">
                        {centsUsd(sku.priceUsdCents)} · {sku.bagSize}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label={t("register.cart.qtyDecAria", { name: sku.productName })}
                        onClick={() => decFromCart(line.skuId)}
                        className="grid h-8 w-8 place-items-center rounded-lg border border-white/60 bg-white/70 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40 active:scale-95"
                      >
                        <Minus className="h-4 w-4" aria-hidden />
                      </button>
                      <span className="w-6 text-center text-sm font-semibold tabular-nums text-ink">
                        {line.qty}
                      </span>
                      <button
                        type="button"
                        disabled={line.qty >= sku.availableUnits}
                        aria-label={t("register.cart.qtyIncAria", { name: sku.productName })}
                        onClick={() => addToCart(sku)}
                        className="grid h-8 w-8 place-items-center rounded-lg border border-white/60 bg-white/70 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40 active:scale-95 disabled:opacity-40"
                      >
                        <Plus className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={t("register.cart.removeAria", { name: sku.productName })}
                        onClick={() => removeFromCart(line.skuId)}
                        className="grid h-8 w-8 place-items-center rounded-lg text-muted-fg hover:text-cherry focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cherry/40 active:scale-95"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Totals — a PREVIEW; the till recomputes them server-side on record. */}
          <dl className="mt-4 space-y-1.5 border-t border-forest/10 pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-fg">{t("register.cart.subtotal")}</dt>
              <dd data-testid="pos-subtotal" className="tabular-nums text-ink">
                {centsUsd(subtotalCents)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-fg">{t("register.cart.tax")}</dt>
              <dd data-testid="pos-tax" className="tabular-nums text-ink">
                {centsUsd(taxCents)}
              </dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt className="text-ink">{t("register.cart.total")}</dt>
              <dd
                data-testid="pos-total"
                className="font-display text-lg tabular-nums text-forest"
              >
                {centsUsd(totalCents)}
              </dd>
            </div>
          </dl>
          <p className="mt-1 text-[0.6875rem] text-muted-fg">
            {t("register.cart.previewNote")}
          </p>

          {folio && (
            <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-forest/10 px-3 py-2 text-sm font-medium text-forest">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              {t("register.folio", { sale: folio })}
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="mt-3 rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
            >
              {error}
            </p>
          )}

          {/* Customer (optional) */}
          <div className="mt-3 space-y-1">
            <label className={LABEL} htmlFor="pos-customer">
              {t("register.customerLabel")}
            </label>
            <input
              id="pos-customer"
              type="text"
              className={FIELD}
              value={customer}
              placeholder={t("register.customerPlaceholder")}
              onChange={(e) => setCustomer(e.target.value)}
            />
          </div>

          <div className="mt-4 flex gap-2">
            {cart.length > 0 && (
              <Button type="button" variant="outline" onClick={clearSale}>
                {t("register.clear")}
              </Button>
            )}
            <Button
              type="button"
              data-testid="pos-charge"
              disabled={pending || cart.length === 0}
              onClick={onCharge}
              className="flex-1"
            >
              <Receipt className="h-4 w-4" aria-hidden />
              {pending
                ? t("register.cobrando")
                : `${t("register.cobrar")} · ${centsUsd(totalCents)}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
