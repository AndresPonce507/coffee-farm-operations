import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FileText } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { num, usd } from "@/lib/utils";
import { getAging, type AgingRow } from "../data";
import { NewInvoice } from "./new-invoice.client";

/**
 * /finance/invoices — the AR board (P3-S17).
 *
 * Every AR document, newest first, each a glass card with its status, total, paid,
 * and remaining balance. Each one is a real commitment of green inventory (the
 * issue RPC writes the lot_shipments row prevent_oversell guards). Server Component;
 * the only client JS is the "New invoice" issue composer island.
 */

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: "neutral",
  issued: "sky",
  partially_paid: "honey",
  paid: "ok",
  void: "danger",
};

type FinanceT = Awaited<ReturnType<typeof getTranslations<"finance">>>;

export default async function InvoicesPage() {
  const t = await getTranslations("finance");
  const rows = await getAging();

  return (
    <div className="space-y-6">
      <PageHeader title={t("invoices.title")} subtitle={t("invoices.subtitle")}>
        <NewInvoice />
      </PageHeader>

      {rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={t("invoices.empty.title")}
          description={t("invoices.empty.description")}
        />
      ) : (
        <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <InvoiceCard key={row.docNumber} row={row} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function InvoiceCard({ row, t }: { row: AgingRow; t: FinanceT }) {
  return (
    <Link
      href={`/finance/invoices/${encodeURIComponent(row.docNumber)}`}
      data-testid={`invoice-card-${row.docNumber}`}
      className="glass-card glass-hover perf-contain block rounded-2xl p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:ring-offset-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold text-ink">
            {row.docNumber}
          </p>
          <p className="text-xs text-muted-fg">
            {t(`kind.${row.kind}` as "kind.commercial_invoice")}
          </p>
        </div>
        <Badge tone={STATUS_TONE[row.status] ?? "neutral"} dot>
          {t(`status.${row.status}` as "status.issued")}
        </Badge>
      </div>

      <div className="mt-4">
        <p className="text-xs uppercase tracking-wide text-muted-fg">
          {t("invoices.card.balance")}
        </p>
        <p className="font-display text-2xl font-bold tabular-nums text-ink">
          {usd(row.balanceUsd)}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("invoices.card.total")}
          </p>
          <p className="text-sm font-medium tabular-nums text-ink">
            {usd(row.totalUsd)}
          </p>
        </div>
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("invoices.card.paid")}
          </p>
          <p className="text-sm font-medium tabular-nums text-ink">
            {usd(row.paidUsd)}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs font-medium tabular-nums text-muted-fg">
          {t("invoices.card.days", { days: num(row.daysOutstanding) })}
        </span>
        <span className="text-xs font-medium text-forest">
          {t("invoices.card.open")} →
        </span>
      </div>
    </Link>
  );
}
