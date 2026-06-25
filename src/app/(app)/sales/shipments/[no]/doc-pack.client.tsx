"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2, FileText, Lock, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, shortDate } from "@/lib/utils";
import {
  DOC_KINDS,
  ISSUE_ORDER,
  type DocKind,
  type DocReadiness,
  type IssuedDoc,
} from "@/app/(app)/sales/shipments/types";
import { issueExportDocAction } from "@/app/(app)/sales/shipments/actions";

/**
 * Document pack — THE headline island. Renders the five-tile traffic-light grid from
 * the server-passed `v_export_pack_readiness` verdict:
 *   • green  — issued (a live doc exists), shows its frozen doc number;
 *   • amber  — prerequisites met, ready to issue (one tap);
 *   • red    — blocked, listing the EXACT unmet prerequisites the database returned
 *              (auditor-honest — never a blank doc; the bill of lading is chain-locked
 *              until the other four go green).
 * Issuing is the gated writer: `issue_export_doc` re-checks every prereq server-side
 * and raises the exact unmet list if any is missing, so the UI gate is a courtesy and
 * the database is the wall. "Issue full pack" mints every clear doc in dependency order
 * in one sweep. On success the route RSC re-reads fresh readiness (router.refresh).
 */

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `d_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

type TileState = "issued" | "ready" | "blocked";

function stateOf(r: DocReadiness): TileState {
  if (r.issued) return "issued";
  return r.unmetPrereqs.length === 0 ? "ready" : "blocked";
}

const STATE_TONE: Record<TileState, BadgeTone> = {
  issued: "forest",
  ready: "honey",
  blocked: "danger",
};

export function DocPack({
  shipmentId,
  readiness,
  issuedDocs,
  lineCount,
}: {
  shipmentId: number;
  readiness: DocReadiness[];
  issuedDocs: IssuedDoc[];
  lineCount: number;
}) {
  const t = useTranslations("shipments");
  const router = useRouter();

  const [issuingKind, setIssuingKind] = useState<DocKind | null>(null);
  const [issuingAll, setIssuingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const docByKind = useMemo(() => {
    const m = new Map<DocKind, IssuedDoc>();
    for (const d of issuedDocs) m.set(d.docKind, d);
    return m;
  }, [issuedDocs]);

  const readyByKind = useMemo(() => {
    const m = new Map<DocKind, DocReadiness>();
    for (const r of readiness) m.set(r.docKind, r);
    return m;
  }, [readiness]);

  const busy = issuingKind != null || issuingAll;
  const hasLines = lineCount > 0;
  const allClear = readiness.every((r) => r.issued);
  const anyIssuable = readiness.some((r) => !r.issued && r.unmetPrereqs.length === 0);

  async function issueOne(kind: DocKind): Promise<boolean> {
    const result = await issueExportDocAction({
      shipmentId,
      docKind: kind,
      idempotencyKey: newKey(),
    });
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    return true;
  }

  async function onIssue(kind: DocKind) {
    setError(null);
    setIssuingKind(kind);
    const ok = await issueOne(kind);
    setIssuingKind(null);
    if (ok) router.refresh();
  }

  async function onIssueAll() {
    setError(null);
    setIssuingAll(true);
    let issuedAny = false;
    // Mint in dependency order; the DB gate re-checks each prereq as state advances.
    for (const kind of ISSUE_ORDER) {
      const r = readyByKind.get(kind);
      if (!r || r.issued) continue;
      const ok = await issueOne(kind);
      if (!ok) break;
      issuedAny = true;
    }
    setIssuingAll(false);
    if (issuedAny) router.refresh();
  }

  return (
    <section className="glass-card rounded-2xl p-5" data-testid="doc-pack">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold text-ink">
            {t("pack.title")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-fg">{t("pack.subtitle")}</p>
        </div>
        <Button
          type="button"
          variant="primary"
          disabled={busy || !hasLines || !anyIssuable}
          onClick={onIssueAll}
        >
          {issuingAll ? t("pack.issuingAll") : t("pack.issueAll")}
        </Button>
      </div>

      {!hasLines && (
        <p className="mt-3 rounded-lg bg-honey-100/60 px-3 py-2 text-xs text-honey-700">
          {t("pack.noLines")}
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

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {DOC_KINDS.map((kind) => (
          <DocTile
            key={kind}
            kind={kind}
            readiness={readyByKind.get(kind)}
            doc={docByKind.get(kind) ?? null}
            issuing={issuingKind === kind}
            disabled={busy || !hasLines}
            onIssue={() => onIssue(kind)}
            t={t}
          />
        ))}
      </div>
    </section>
  );
}

function DocTile({
  kind,
  readiness,
  doc,
  issuing,
  disabled,
  onIssue,
  t,
}: {
  kind: DocKind;
  readiness: DocReadiness | undefined;
  doc: IssuedDoc | null;
  issuing: boolean;
  disabled: boolean;
  onIssue: () => void;
  t: ReturnType<typeof useTranslations<"shipments">>;
}) {
  const r: DocReadiness = readiness ?? {
    docKind: kind,
    issued: false,
    liveDocId: null,
    unmetPrereqs: [],
  };
  const state = stateOf(r);
  const isBl = kind === "bill_of_lading";
  const tag =
    state === "issued"
      ? t("tile.issuedTag")
      : state === "ready"
        ? t("tile.readyTag")
        : isBl
          ? t("tile.lockedTag")
          : t("tile.blockedTag");

  const ring =
    state === "issued"
      ? "border-forest/30"
      : state === "ready"
        ? "border-honey-300/60"
        : "border-cherry/30";

  return (
    <div
      data-testid={`doc-tile-${kind}`}
      data-state={state}
      className={cn(
        "flex flex-col rounded-xl border bg-paper/60 p-4",
        ring,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn(
              "grid h-7 w-7 place-items-center rounded-lg",
              state === "issued"
                ? "bg-forest-100 text-forest"
                : state === "ready"
                  ? "bg-honey-100 text-honey-700"
                  : "bg-cherry-100 text-cherry",
            )}
          >
            {state === "issued" ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : isBl && state === "blocked" ? (
              <Lock className="h-4 w-4" />
            ) : state === "ready" ? (
              <FileText className="h-4 w-4" />
            ) : (
              <ShieldAlert className="h-4 w-4" />
            )}
          </span>
          <p className="font-display text-sm font-semibold text-ink">
            {t(`doc.${kind}`)}
          </p>
        </div>
        <Badge tone={STATE_TONE[state]} dot>
          {tag}
        </Badge>
      </div>

      <div className="mt-3 flex-1">
        {state === "issued" ? (
          <div className="space-y-0.5">
            <p className="text-sm font-medium tabular-nums text-ink">
              {t("tile.docNo", { docNo: doc?.docNo ?? "—" })}
            </p>
            {doc?.issuedAt && (
              <p className="text-[0.6875rem] text-muted-fg">
                {t("tile.issuedAt", { date: shortDate(doc.issuedAt) })}
              </p>
            )}
          </div>
        ) : state === "ready" ? (
          <p className="text-xs text-muted-fg">{t("tile.ready")}</p>
        ) : (
          <div>
            <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-cherry">
              {t("tile.unmetTitle")}
            </p>
            <ul className="mt-1 space-y-0.5">
              {r.unmetPrereqs.map((label) => (
                <li key={label} className="flex gap-1.5 text-xs text-ink">
                  <span aria-hidden className="text-cherry">
                    •
                  </span>
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {state !== "issued" && (
        <div className="mt-3">
          <Button
            type="button"
            size="sm"
            variant={state === "ready" ? "primary" : "outline"}
            disabled={disabled || issuing || state === "blocked"}
            onClick={onIssue}
            className="w-full"
          >
            {issuing ? t("tile.issuing") : t("tile.issue")}
          </Button>
        </div>
      )}
    </div>
  );
}
