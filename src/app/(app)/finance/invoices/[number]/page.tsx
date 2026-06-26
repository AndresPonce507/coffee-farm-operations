import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { num, shortDate, usd } from "@/lib/utils";
import { getInvoice, type InvoiceDetail, type LotMargin } from "../../data";
import { PaymentActions } from "./payment-actions.client";

/**
 * /finance/invoices/[number] — one AR doc's full story (P3-S17).
 *
 * Server Component. 404s on an unknown doc_number (a ⌘K jump or a hand-typed URL can
 * route to a doc that doesn't exist — never a fabricated invoice). Renders the
 * instrument header, the line items each linking to their green-lot provenance, the
 * realized per-lot margin strip (revenue against true cost-per-kg-green — NULL cost
 * surfaces as "cost not booked", never a faked number), and the append-only payment
 * timeline. The ONE interactive island is <PaymentActions>: "Record payment" is a
 * confirm-gated, money-shaped write (rail §7), and "Void" posts a reversing row.
 */

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: "neutral",
  issued: "sky",
  partially_paid: "honey",
  paid: "ok",
  void: "danger",
};

const perKg = (v: number) => usd(v, v < 100 ? 2 : 0);
type FinanceT = Awaited<ReturnType<typeof getTranslations<"finance">>>;

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const { number } = await params;
  const docNumber = decodeURIComponent(number);
  const t = await getTranslations("finance");

  const invoice = await getInvoice(docNumber).catch(() => null);
  if (!invoice) {
    notFound();
  }

  const { doc, lines, payments, margins, paidUsd, balanceUsd } = invoice;
  const marginByLot = new Map(margins.map((m) => [m.greenLotCode, m]));
  const canPay = doc.status !== "paid" && doc.status !== "void";
  const canVoid =
    (doc.status === "draft" || doc.status === "issued") && paidUsd === 0;

  return (
    <div className="space-y-6">
      <Link
        href="/finance/invoices"
        className="inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted-fg transition-colors hover:text-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t("invoice.back")}
      </Link>

      {/* header */}
      <div className="animate-rise relative mb-2 pb-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-fg">
          {t(`kind.${doc.kind}` as "kind.commercial_invoice")}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
            {doc.docNumber}
          </h1>
          <Badge tone={STATUS_TONE[doc.status] ?? "neutral"} dot>
            {t(`status.${doc.status}` as "status.issued")}
          </Badge>
        </div>
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-fg">
          <span>{t("invoice.summary.issued", { date: shortDate(doc.issuedAt) })}</span>
          {doc.incoterm && (
            <span>{t("invoice.summary.incoterm", { incoterm: doc.incoterm })}</span>
          )}
          {doc.buyerRef && (
            <span>{t("invoice.summary.buyer", { buyer: doc.buyerRef })}</span>
          )}
          {doc.contractRef && (
            <span>{t("invoice.summary.contract", { contract: doc.contractRef })}</span>
          )}
        </p>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      {/* totals strip */}
      <div className="glass-card grid grid-cols-3 gap-px overflow-hidden rounded-2xl">
        <div className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-fg">
            {t("invoice.summary.total")}
          </p>
          <p className="font-display text-2xl font-bold tabular-nums text-ink">
            {usd(doc.totalUsd)}
          </p>
        </div>
        <div className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-fg">
            {t("invoice.summary.paid")}
          </p>
          <p className="font-display text-2xl font-bold tabular-nums text-forest">
            {usd(paidUsd)}
          </p>
        </div>
        <div className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-fg">
            {t("invoice.summary.balance")}
          </p>
          <p className="font-display text-2xl font-bold tabular-nums text-ink">
            {usd(balanceUsd)}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          {/* line items */}
          <section className="glass-card rounded-2xl p-5">
            <h2 className="font-display text-base font-semibold text-ink">
              {t("invoice.lines.title")}
            </h2>
            <ul className="mt-3 divide-y divide-line">
              {lines.map((line) => (
                <li
                  key={line.id}
                  data-testid={`line-${line.id}`}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {line.description}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-fg">
                      {line.greenLotCode ? (
                        <Link
                          href={`/lots/${encodeURIComponent(line.greenLotCode)}`}
                          className="font-medium text-forest hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
                        >
                          {t("invoice.lines.lot", { lot: line.greenLotCode })}
                        </Link>
                      ) : (
                        t("invoice.lines.noLot")
                      )}
                      {line.kg != null && (
                        <span className="ml-2 tabular-nums">
                          {t("invoice.lines.kg", { kg: num(line.kg) })}
                          {" · "}
                          {t("invoice.lines.unit", { price: perKg(line.unitPriceDoc) })}
                        </span>
                      )}
                    </p>
                  </div>
                  <p className="shrink-0 font-display text-sm font-semibold tabular-nums text-ink">
                    {usd(line.amountDoc, doc.currency === "USD" ? 0 : 2)}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          {/* realized margin strip — the number that closes the loop */}
          <section
            data-testid="margin-strip"
            className="glass-card rounded-2xl p-5"
          >
            <h2 className="font-display text-base font-semibold text-ink">
              {t("invoice.margin.title")}
            </h2>
            <p className="mt-1 text-xs text-muted-fg">{t("invoice.margin.subtitle")}</p>
            {margins.length === 0 ? (
              <p className="mt-3 text-sm text-muted-fg">{t("invoice.margin.empty")}</p>
            ) : (
              <div className="mt-3 space-y-3">
                {Array.from(marginByLot.values()).map((m) => (
                  <MarginRow key={m.greenLotCode} m={m} t={t} />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* right rail: payment timeline + the money-shaped actions */}
        <div className="space-y-6">
          <PaymentActions
            arDocId={doc.id}
            docNumber={doc.docNumber}
            currency={doc.currency}
            balanceUsd={balanceUsd}
            canPay={canPay}
            canVoid={canVoid}
          />

          <section
            data-testid="payment-timeline"
            className="glass-card rounded-2xl p-5"
          >
            <h2 className="font-display text-base font-semibold text-ink">
              {t("invoice.payments.title")}
            </h2>
            {payments.length === 0 ? (
              <p className="mt-3 text-sm text-muted-fg">
                {t("invoice.payments.empty")}
              </p>
            ) : (
              <ol className="mt-3 space-y-3">
                {payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3">
                    <div>
                      <Badge tone="forest">
                        {t(`method.${p.method}` as "method.wire")}
                      </Badge>
                      <p className="mt-1 text-xs text-muted-fg">
                        {t("invoice.payments.received", {
                          date: shortDate(p.receivedAt),
                        })}
                      </p>
                    </div>
                    <p className="font-display text-sm font-semibold tabular-nums text-ink">
                      {usd(p.amountUsdAtReceipt)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function MarginRow({ m, t }: { m: LotMargin; t: FinanceT }) {
  const known = m.marginPerKgGreen != null;
  return (
    <div className="rounded-xl border border-forest/15 bg-forest/[0.04] px-3 py-2.5">
      <div className="flex items-center justify-between">
        <p className="font-display text-sm font-semibold text-ink">{m.greenLotCode}</p>
        {!known && (
          <Badge tone="warn">{t("invoice.margin.unknown")}</Badge>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted-fg">{t("invoice.margin.revenuePerKg")}</dt>
          <dd className="font-medium tabular-nums text-ink">
            {m.revenuePerKgGreen == null ? "—" : perKg(m.revenuePerKgGreen)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-fg">{t("invoice.margin.costPerKg")}</dt>
          <dd className="font-medium tabular-nums text-ink">
            {m.costPerKgGreen == null ? "—" : perKg(m.costPerKgGreen)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-fg">{t("invoice.margin.marginPerKg")}</dt>
          <dd className="font-medium tabular-nums text-forest">
            {m.marginPerKgGreen == null ? "—" : perKg(m.marginPerKgGreen)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
