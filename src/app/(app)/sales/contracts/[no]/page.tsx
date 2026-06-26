import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn, num, pct, usd } from "@/lib/utils";
import {
  getContractDetail,
  type ContractDetail,
  type ContractStatus,
} from "./data";
import { ContractWorkspace } from "./contract-workspace.client";

/**
 * /sales/contracts/[no] — the contract workspace (P3-S1 trade trunk).
 *
 * Server Component. Resolves the contract by number, 404s on an unknown number (the
 * palette or a hand-typed URL can route to a contract that doesn't exist — never a
 * fabricated workspace). The left rail is the server-rendered STORY: the status spine
 * (draft → signed → fixed → in_transit → delivered → closed), the buyer + Incoterm +
 * standard, and the running totals. The right rail is the one interactive island,
 * <ContractWorkspace>, where lines are added (each claiming green inventory via
 * prevent_oversell) and the contract is signed.
 */

const STEPS: ContractStatus[] = [
  "draft",
  "signed",
  "fixed",
  "in_transit",
  "delivered",
  "closed",
];

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ no: string }>;
}) {
  const { no } = await params;
  const contractNo = decodeURIComponent(no);
  const t = await getTranslations("sales");

  const detail = await getContractDetail(contractNo).catch(() => null);
  if (!detail) {
    notFound();
  }

  const place = detail.namedPlace ? ` ${detail.namedPlace}` : "";

  return (
    <div className="space-y-6">
      <Link
        href="/sales/contracts"
        className="inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted-fg transition-colors hover:text-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t("workspace.back")}
      </Link>

      {/* header */}
      <div className="animate-rise relative mb-2 pb-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-fg">
          {t("workspace.eyebrow")}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
            {contractNo}
          </h1>
          {detail.standard && (
            <Badge tone="neutral">{detail.standard.toUpperCase()}</Badge>
          )}
          <Badge tone="forest" dot>
            {t(`workspace.basis.${detail.pricingBasis}`)}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-fg">
          {t("workspace.buyerLine", {
            buyer: detail.buyerName ?? "—",
            incoterm: detail.incoterm,
            place,
          })}
        </p>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      {/* status spine */}
      <StatusSpine detail={detail} t={t} />

      {/* summary strip */}
      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        <Cell
          label={t("workspace.summary.volume")}
          value={t("workspace.summary.volumeValue", {
            kg: num(Math.round(detail.totalKg)),
          })}
        />
        <Cell
          label={t("workspace.summary.fixedValue")}
          value={detail.fixedValue > 0 ? usd(detail.fixedValue) : "—"}
        />
        <Cell
          label={t("workspace.summary.fixation")}
          value={pct(detail.fixationPct * 100)}
        />
        <Cell
          label={t("workspace.summary.currency")}
          value={detail.currency}
        />
      </div>

      {/* interactive line editor + sign control */}
      <ContractWorkspace detail={detail} />
    </div>
  );
}

type SalesT = Awaited<ReturnType<typeof getTranslations<"sales">>>;

function StatusSpine({ detail, t }: { detail: ContractDetail; t: SalesT }) {
  const cancelled = detail.status === "cancelled";
  const currentIndex = cancelled ? -1 : STEPS.indexOf(detail.status);

  return (
    <div
      data-testid="contract-status"
      className="glass-card rounded-2xl p-5"
    >
      {cancelled && (
        <div className="mb-4 rounded-xl border border-cherry/20 bg-cherry/[0.06] px-3 py-2 text-sm font-medium text-cherry">
          {t("workspace.status.cancelled")}
        </div>
      )}
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-3">
        {STEPS.map((step, i) => {
          const done = i < currentIndex;
          const current = i === currentIndex;
          return (
            <li key={step} className="flex items-center gap-2">
              <span
                className={cn(
                  "grid h-6 w-6 place-items-center rounded-full text-[0.625rem] font-bold tabular-nums",
                  done && "bg-forest text-paper",
                  current && "bg-forest text-paper ring-2 ring-forest/30 ring-offset-1",
                  !done && !current && "bg-muted text-muted-fg",
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
              </span>
              <span
                className={cn(
                  "text-xs font-medium",
                  current ? "text-ink" : "text-muted-fg",
                )}
                aria-current={current ? "step" : undefined}
              >
                {t(`workspace.status.${step}`)}
              </span>
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    "mx-1 hidden h-px w-6 sm:block",
                    i < currentIndex ? "bg-forest/40" : "bg-line",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4">
      <p className="text-xs uppercase tracking-wide text-muted-fg">{label}</p>
      <p className="mt-1 font-display text-lg font-bold tabular-nums text-ink">
        {value}
      </p>
    </div>
  );
}
