"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PenLine, Send, UserMinus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD, LABEL } from "@/components/ui/form-field";
import { cn } from "@/lib/utils";
import type {
  AudienceContact,
  CampaignBoardRow,
  CampaignTrigger,
  LotMergeTag,
} from "./data";
import {
  draftCampaignAction,
  markCampaignSentAction,
  queueCampaignSendAction,
  recordUnsubscribeAction,
} from "./actions";

/**
 * MarketingConsole — the ONE interactive island on /marketing (the board + log stay
 * Server Components). The whole lifecycle, human-driven end to end (rail §7):
 *   • Compose — write a campaign from real rows; a live preview resolves the merge tags
 *     ({{lot_code}}/{{cup_score}}/{{sca_grade}}) from the picked lot EXACTLY the way the
 *     queue RPC resolves them, so what you see is what sends. Save → a draft.
 *   • Build send list — queue_campaign_send fans the draft out to ONLY opted-in
 *     contacts (the DB consent gate). Still queued, nothing sent.
 *   • Send — opens a glass confirm; a HUMAN clicks "Send it" and only then does
 *     mark_campaign_sent flip the queued rows + append the 'campaign_sent' lot_event.
 *   • Audience — the opted-in list (the consent gate is the list). An unsubscribe is
 *     the contact's own opt-out; it only removes capability, never sends.
 * Every path calls its Server Action then router.refresh() so the board + log update
 * (marketing moves no inventory, so there is no ATP ripple).
 */

type Tab = "compose" | "send";

const TRIGGERS: CampaignTrigger[] = [
  "lot-launch",
  "replenishment",
  "sample-follow-up",
  "manual",
];

const MERGE_TAGS = ["{{lot_code}}", "{{cup_score}}", "{{sca_grade}}"] as const;

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `mk_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

/** Resolve merge tags the way queue_campaign_send does (faithful preview). */
function resolve(template: string, lot: LotMergeTag | null): string {
  const lotCode = lot?.lotCode ?? "";
  const cup = lot?.cupScore != null ? String(lot.cupScore) : "";
  const grade = lot?.scaGrade ?? "";
  return template
    .replaceAll("{{lot_code}}", lotCode)
    .replaceAll("{{cup_score}}", cup)
    .replaceAll("{{sca_grade}}", grade);
}

export function MarketingConsole({
  campaigns,
  lots,
  audience,
}: {
  campaigns: CampaignBoardRow[];
  lots: LotMergeTag[];
  audience: AudienceContact[];
}) {
  const t = useTranslations("marketing");
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("compose");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function reset() {
    setError(null);
    setNotice(null);
  }

  // ── compose ────────────────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<CampaignTrigger>("manual");
  const [lotCode, setLotCode] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const selectedLot = useMemo(
    () => lots.find((l) => l.lotCode === lotCode) ?? null,
    [lots, lotCode],
  );

  const previewSubject = resolve(subject, selectedLot);
  const previewBody = resolve(body, selectedLot);

  async function onDraft() {
    reset();
    setPending(true);
    const r = await draftCampaignAction({
      name,
      triggerKind: trigger,
      greenLotCode: lotCode === "" ? null : lotCode,
      subject,
      bodyTemplate: body,
      idempotencyKey: newKey(),
    });
    setPending(false);
    if (r.ok) {
      setNotice(t("console.savedDraft"));
      setName("");
      setSubject("");
      setBody("");
      router.refresh();
    } else {
      setError(r.error);
    }
  }

  // ── send ─────────────────────────────────────────────────────────────────
  const sendable = campaigns.filter((c) => c.status !== "archived");
  const [sendId, setSendId] = useState<number | null>(sendable[0]?.campaignId ?? null);
  const selectedCampaign = campaigns.find((c) => c.campaignId === sendId) ?? null;
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function onQueue() {
    if (sendId == null) {
      setError(t("errors.campaignRequired"));
      return;
    }
    reset();
    setPending(true);
    const r = await queueCampaignSendAction({
      campaignId: sendId,
      idempotencyKey: newKey(),
    });
    setPending(false);
    if (r.ok) {
      setNotice(t("console.queued", { count: r.queuedCount }));
      router.refresh();
    } else {
      setError(r.error);
    }
  }

  async function onSend() {
    if (sendId == null) return;
    reset();
    setPending(true);
    const r = await markCampaignSentAction({
      campaignId: sendId,
      idempotencyKey: newKey(),
    });
    setPending(false);
    setConfirmOpen(false);
    if (r.ok) {
      setNotice(t("sendDialog.sent", { count: r.sentCount }));
      router.refresh();
    } else {
      setError(r.error);
    }
  }

  // ── audience ───────────────────────────────────────────────────────────────
  async function onUnsubscribe(contactId: number) {
    reset();
    const r = await recordUnsubscribeAction({ contactId, idempotencyKey: newKey() });
    if (r.ok) {
      setNotice(t("console.unsubscribed"));
      router.refresh();
    } else {
      setError(r.error);
    }
  }

  const queuedTotal = selectedCampaign?.queuedTotal ?? 0;
  const canSend = queuedTotal > 0;

  return (
    <div className="glass-card rounded-2xl p-5">
      <p className="font-display text-base font-semibold text-ink">
        {t("console.title")}
      </p>

      <div className="mt-4 flex gap-1.5" role="tablist" aria-label={t("console.title")}>
        <TabBtn active={tab === "compose"} onClick={() => { reset(); setTab("compose"); }} icon={PenLine}>
          {t("console.compose")}
        </TabBtn>
        <TabBtn active={tab === "send"} onClick={() => { reset(); setTab("send"); }} icon={Send}>
          {t("console.send")}
        </TabBtn>
      </div>

      <div className="mt-4 space-y-3">
        {tab === "compose" ? (
          <>
            <Field label={t("console.fields.name")}>
              <input className={FIELD} type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("console.fields.trigger")}>
                <select className={FIELD} value={trigger} onChange={(e) => setTrigger(e.target.value as CampaignTrigger)} aria-label={t("console.fields.trigger")}>
                  {TRIGGERS.map((tr) => (
                    <option key={tr} value={tr}>
                      {t(`board.trigger.${tr}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("console.fields.lot")}>
                <select className={FIELD} value={lotCode} onChange={(e) => setLotCode(e.target.value)} aria-label={t("console.fields.lot")}>
                  <option value="">{t("console.fields.noLot")}</option>
                  {lots.map((l) => (
                    <option key={l.lotCode} value={l.lotCode}>
                      {l.lotCode}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label={t("console.fields.subject")}>
              <input className={FIELD} type="text" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </Field>
            <Field label={t("console.fields.body")}>
              <textarea
                className={cn(FIELD, "h-24 resize-y py-2 leading-relaxed")}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </Field>

            {/* Merge tag chips — click to drop one into the message. */}
            <div>
              <p className={LABEL}>{t("console.mergeTags")}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {MERGE_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setBody((b) => (b ? `${b} ${tag}` : tag))}
                    className="rounded-md bg-forest-100/70 px-2 py-1 font-mono text-[0.6875rem] text-forest transition hover:bg-forest-100"
                  >
                    {tag}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[0.6875rem] text-muted-fg">{t("console.mergeTagsHint")}</p>
            </div>

            {/* Live preview — resolves from the picked lot exactly like the queue RPC. */}
            <div className="rounded-xl border border-forest/15 bg-forest/[0.04] px-3 py-2.5">
              <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">{t("console.preview")}</p>
              {selectedLot == null && subject === "" && body === "" ? (
                <p className="mt-1 text-xs text-muted-fg">{t("console.previewEmpty")}</p>
              ) : (
                <>
                  {previewSubject && (
                    <p className="mt-1 text-sm font-semibold text-ink">{previewSubject}</p>
                  )}
                  {previewBody && (
                    <p className="mt-0.5 whitespace-pre-wrap text-xs text-ink/80">{previewBody}</p>
                  )}
                </>
              )}
            </div>

            <div className="flex justify-end pt-1">
              <Button type="button" disabled={pending} onClick={onDraft}>
                {pending ? t("console.drafting") : t("console.draft")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <Field label={t("console.pickCampaign")}>
              <select
                className={FIELD}
                value={sendId ?? ""}
                onChange={(e) => setSendId(e.target.value === "" ? null : Number(e.target.value))}
                aria-label={t("console.pickCampaign")}
              >
                {sendable.length === 0 && <option value="">—</option>}
                {sendable.map((c) => (
                  <option key={c.campaignId} value={c.campaignId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>

            <p className="text-[0.6875rem] text-muted-fg">{t("console.queueHint")}</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs tabular-nums text-muted-fg">
                {t("card.queued", { count: queuedTotal })}
              </span>
              <Button type="button" variant="outline" disabled={pending || sendId == null} onClick={onQueue}>
                {pending ? t("console.queuing") : t("console.queue")}
              </Button>
            </div>

            <div className="flex items-center justify-end pt-1">
              <Button
                type="button"
                disabled={!canSend || pending}
                onClick={() => {
                  reset();
                  setConfirmOpen(true);
                }}
              >
                {t("console.sendBtn")}
              </Button>
            </div>
            {!canSend && (
              <p className="text-[0.6875rem] text-muted-fg">{t("console.sendNone")}</p>
            )}
          </>
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-lg bg-forest/10 px-3 py-2 text-xs font-medium text-forest">
            {notice}
          </p>
        )}
      </div>

      {/* Audience — the consent gate IS the list. */}
      <div className="mt-5 border-t border-line pt-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-ink">{t("console.audienceTitle")}</p>
          <p className="text-xs tabular-nums text-muted-fg">
            {t("console.audienceCount", { count: audience.length })}
          </p>
        </div>
        <p className="mt-1 text-[0.6875rem] text-muted-fg">{t("console.audienceHint")}</p>

        {audience.length === 0 ? (
          <p className="mt-3 text-xs text-muted-fg">{t("console.noAudience")}</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {audience.map((a) => (
              <li
                key={a.contactId}
                className="flex items-center justify-between gap-2 rounded-lg bg-paper/70 px-2.5 py-1.5"
              >
                <span className="min-w-0 truncate text-xs font-medium text-ink">{a.name}</span>
                <button
                  type="button"
                  onClick={() => onUnsubscribe(a.contactId)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[0.6875rem] font-medium text-muted-fg transition hover:bg-cherry/10 hover:text-cherry focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cherry/30"
                  aria-label={`${t("console.unsubscribe")} ${a.name}`}
                >
                  <UserMinus className="h-3 w-3" />
                  {t("console.unsubscribe")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Human-confirmed send — the app drafts, the owner signs. */}
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} title={t("sendDialog.title")}>
        <div className="space-y-4">
          {canSend ? (
            <p className="text-sm text-ink">
              {t("sendDialog.body", {
                name: selectedCampaign?.name ?? "",
                count: audience.length,
              })}
            </p>
          ) : (
            <p className="text-sm text-ink">{t("sendDialog.noQueue")}</p>
          )}
          <p className="text-xs text-muted-fg">{t("sendDialog.humanNote")}</p>

          {error && (
            <p role="alert" className="rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              {t("sendDialog.cancel")}
            </Button>
            <Button type="button" disabled={!canSend || pending} onClick={onSend}>
              {pending ? t("sendDialog.sending") : t("sendDialog.confirm")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition",
        active ? "bg-forest text-paper" : "bg-white/60 text-muted-fg hover:bg-white/80 hover:text-ink",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className={LABEL}>{label}</label>
      {children}
    </div>
  );
}
