"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MessageSquarePlus, Send, ThumbsUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD, LABEL } from "@/components/ui/form-field";
import { num } from "@/lib/utils";
import {
  recordContactEventAction,
  recordSampleDispatchAction,
  recordSampleFeedbackAction,
} from "../actions";
import type {
  ContactEventKind,
  SampleableLot,
  SampleDispatchRow,
} from "../data";

/**
 * ContactActions — the ONE interactive island on the contact sheet (the page stays a
 * Server Component). Three jobs:
 *   • Log a relationship touchpoint (record_contact_event).
 *   • Dispatch a sample — the MONEY-SHAPED, human-confirmed write. A sample is real
 *     green leaving inventory, so the confirm dialog shows the ATP drop LIVE before the
 *     human commits; record_sample_dispatch inserts the oversell-guarded row (the same
 *     prevent_oversell trigger that protects a paid sale now protects the free sample).
 *   • Record a buyer's cup verdict on a dispatched sample (record_sample_feedback).
 * No untrusted inbound reaches any of these — they fire only on an authenticated human's
 * click (rail §7). On success the island router.refresh()es so the server timeline +
 * pipeline re-render with the new append-only rows.
 */

const LOG_KINDS: ContactEventKind[] = [
  "inquiry",
  "sample_requested",
  "quote_sent",
  "meeting",
  "call",
  "note",
];

const VERDICTS = ["approved", "rejected", "counter"] as const;

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `e_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

export function ContactActions({
  contactId,
  samples,
  sampleableLots,
}: {
  contactId: number;
  samples: SampleDispatchRow[];
  sampleableLots: SampleableLot[];
}) {
  const t = useTranslations("crm");
  const router = useRouter();

  // ── log activity ──────────────────────────────────────────────────────────
  const [logKind, setLogKind] = useState<ContactEventKind>("note");
  const [logNote, setLogNote] = useState("");
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  async function onLog() {
    setLogError(null);
    setLogging(true);
    const result = await recordContactEventAction({
      contactId,
      kind: logKind,
      note: logNote.trim() || null,
      idempotencyKey: newKey(),
    });
    setLogging(false);
    if (result.ok) {
      setLogNote("");
      router.refresh();
    } else {
      setLogError(result.error);
    }
  }

  // ── dispatch sample (money-shaped, human-confirmed) ───────────────────────
  const hasLots = sampleableLots.length > 0;
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [lotCode, setLotCode] = useState<string>(
    sampleableLots[0]?.greenLotCode ?? "",
  );
  const [grams, setGrams] = useState<number>(250);
  const [courier, setCourier] = useState("");
  const [tracking, setTracking] = useState("");
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  const selectedLot = useMemo(
    () => sampleableLots.find((l) => l.greenLotCode === lotCode) ?? null,
    [sampleableLots, lotCode],
  );
  const atpBefore = selectedLot?.atpKg ?? 0;
  const drawKg = Number.isFinite(grams) && grams > 0 ? grams / 1000 : 0;
  const atpAfter = Math.max(0, atpBefore - drawKg);
  const canDispatch =
    !dispatching && lotCode !== "" && Number.isFinite(grams) && grams > 0;

  async function onDispatch() {
    setDispatchError(null);
    setDispatching(true);
    const result = await recordSampleDispatchAction({
      greenLotCode: lotCode,
      contactId,
      grams,
      courier: courier.trim() || null,
      trackingNo: tracking.trim() || null,
      idempotencyKey: newKey(),
    });
    setDispatching(false);
    if (result.ok) {
      setDispatchOpen(false);
      setCourier("");
      setTracking("");
      router.refresh();
    } else {
      setDispatchError(result.error);
    }
  }

  // ── record sample feedback ────────────────────────────────────────────────
  const [feedbackFor, setFeedbackFor] = useState<SampleDispatchRow | null>(null);
  const [score, setScore] = useState("");
  const [verdict, setVerdict] = useState<(typeof VERDICTS)[number]>("approved");
  const [notes, setNotes] = useState("");
  const [recording, setRecording] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  function openFeedback(sample: SampleDispatchRow) {
    setFeedbackFor(sample);
    setScore("");
    setVerdict("approved");
    setNotes("");
    setFeedbackError(null);
  }

  async function onFeedback() {
    if (!feedbackFor) return;
    setFeedbackError(null);
    setRecording(true);
    const result = await recordSampleFeedbackAction({
      sampleDispatchId: feedbackFor.sampleId,
      score: score.trim() === "" ? null : Number(score),
      verdict,
      notes: notes.trim() || null,
      idempotencyKey: newKey(),
    });
    setRecording(false);
    if (result.ok) {
      setFeedbackFor(null);
      router.refresh();
    } else {
      setFeedbackError(result.error);
    }
  }

  const pending = samples.filter((s) => s.latestVerdict == null);

  return (
    <div className="space-y-6">
      {/* log activity */}
      <section className="glass-card rounded-2xl p-5">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold text-ink">
          <MessageSquarePlus className="h-4 w-4 text-forest" aria-hidden />
          {t("actions.logTitle")}
        </h2>
        <div className="mt-3 space-y-3">
          <div className="space-y-1">
            <label className={LABEL} htmlFor="ca-kind">
              {t("actions.logKind")}
            </label>
            <select
              id="ca-kind"
              className={FIELD}
              value={logKind}
              onChange={(e) => setLogKind(e.target.value as ContactEventKind)}
            >
              {LOG_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`event.${k}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className={LABEL} htmlFor="ca-note">
              {t("actions.logNote")}
            </label>
            <input
              id="ca-note"
              type="text"
              className={FIELD}
              placeholder={t("actions.logNotePlaceholder")}
              value={logNote}
              onChange={(e) => setLogNote(e.target.value)}
            />
          </div>
          {logError && (
            <p
              role="alert"
              className="rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
            >
              {logError}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="button" disabled={logging} onClick={onLog}>
              {logging ? t("actions.logging") : t("actions.log")}
            </Button>
          </div>
        </div>
      </section>

      {/* dispatch a sample */}
      <section className="glass-card rounded-2xl p-5">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold text-ink">
          <Send className="h-4 w-4 text-forest" aria-hidden />
          {t("actions.sampleTitle")}
        </h2>
        <p className="mt-2 text-xs text-muted-fg">{t("actions.sampleHint")}</p>
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            variant="primary"
            disabled={!hasLots}
            onClick={() => {
              setDispatchError(null);
              if (!lotCode && sampleableLots[0]) {
                setLotCode(sampleableLots[0].greenLotCode);
              }
              setDispatchOpen(true);
            }}
          >
            {t("actions.sampleButton")}
          </Button>
        </div>
        {!hasLots && (
          <p className="mt-2 text-right text-xs text-muted-fg">
            {t("dispatch.noLots")}
          </p>
        )}
      </section>

      {/* feedback affordances per pending sample */}
      {pending.length > 0 && (
        <section className="glass-card rounded-2xl p-5">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-ink">
            <ThumbsUp className="h-4 w-4 text-forest" aria-hidden />
            {t("feedback.title")}
          </h2>
          <ul className="mt-3 space-y-2">
            {pending.map((s) => (
              <li
                key={s.sampleId}
                className="flex items-center justify-between gap-3 rounded-xl bg-paper/70 px-3 py-2"
              >
                <span className="min-w-0 text-sm">
                  <span className="font-medium tabular-nums text-ink">
                    {s.greenLotCode}
                  </span>{" "}
                  <span className="text-muted-fg">
                    {t("sample.grams", { grams: num(s.grams) })}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => openFeedback(s)}
                >
                  {t("actions.feedbackButton")}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* dispatch confirm dialog — money-shaped, shows the ATP drop live */}
      <Dialog
        open={dispatchOpen}
        onClose={() => setDispatchOpen(false)}
        title={t("dispatch.title")}
      >
        <div className="space-y-4">
          <p className="text-sm text-ink">
            {t("dispatch.body", { grams: num(grams) })}
          </p>

          <div className="space-y-1">
            <label className={LABEL} htmlFor="ca-lot">
              {t("dispatch.lot")}
            </label>
            <select
              id="ca-lot"
              className={FIELD}
              value={lotCode}
              onChange={(e) => setLotCode(e.target.value)}
            >
              <option value="" disabled>
                {t("dispatch.lotPlaceholder")}
              </option>
              {sampleableLots.map((l) => (
                <option key={l.greenLotCode} value={l.greenLotCode}>
                  {l.greenLotCode}
                  {l.scaGrade ? ` · ${l.scaGrade}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className={LABEL} htmlFor="ca-grams">
                {t("dispatch.grams")}
              </label>
              <input
                id="ca-grams"
                type="number"
                min={1}
                step="1"
                inputMode="decimal"
                className={FIELD}
                value={Number.isFinite(grams) ? grams : ""}
                onChange={(e) => setGrams(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <label className={LABEL} htmlFor="ca-courier">
                {t("dispatch.courier")}
              </label>
              <input
                id="ca-courier"
                type="text"
                className={FIELD}
                placeholder={t("dispatch.courierPlaceholder")}
                value={courier}
                onChange={(e) => setCourier(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className={LABEL} htmlFor="ca-tracking">
              {t("dispatch.tracking")}
            </label>
            <input
              id="ca-tracking"
              type="text"
              className={FIELD}
              placeholder={t("dispatch.trackingPlaceholder")}
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
            />
          </div>

          {/* the ATP drop — the same green guarantee that protects a paid sale */}
          <div className="flex items-center justify-between rounded-xl bg-paper/70 px-3 py-3 text-sm">
            <div>
              <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
                {t("dispatch.atpBefore")}
              </p>
              <p className="font-display text-lg font-bold tabular-nums text-ink">
                {num(atpBefore, atpBefore < 100 ? 1 : 0)}
              </p>
            </div>
            <span aria-hidden className="text-muted-fg">
              →
            </span>
            <div className="text-right">
              <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
                {t("dispatch.atpAfter")}
              </p>
              <p className="font-display text-lg font-bold tabular-nums text-forest">
                {num(atpAfter, atpAfter < 100 ? 1 : 0)}
              </p>
              <p className="text-[0.625rem] text-muted-fg">{t("dispatch.atpUnit")}</p>
            </div>
          </div>

          <p className="text-xs text-muted-fg">{t("dispatch.irreversible")}</p>

          {dispatchError && (
            <p
              role="alert"
              className="rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
            >
              {dispatchError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDispatchOpen(false)}
            >
              {t("dispatch.cancel")}
            </Button>
            <Button type="button" disabled={!canDispatch} onClick={onDispatch}>
              {dispatching ? t("dispatch.dispatching") : t("dispatch.confirm")}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* feedback dialog */}
      <Dialog
        open={feedbackFor != null}
        onClose={() => setFeedbackFor(null)}
        title={t("feedback.title")}
      >
        <div className="space-y-4">
          {feedbackFor && (
            <p className="text-sm text-ink">
              {t("feedback.for", { lot: feedbackFor.greenLotCode })}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className={LABEL} htmlFor="ca-score">
                {t("feedback.score")}
              </label>
              <input
                id="ca-score"
                type="number"
                min={0}
                max={100}
                step="0.25"
                inputMode="decimal"
                className={FIELD}
                placeholder={t("feedback.scorePlaceholder")}
                value={score}
                onChange={(e) => setScore(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className={LABEL} htmlFor="ca-verdict">
                {t("feedback.verdict")}
              </label>
              <select
                id="ca-verdict"
                className={FIELD}
                value={verdict}
                onChange={(e) =>
                  setVerdict(e.target.value as (typeof VERDICTS)[number])
                }
              >
                {VERDICTS.map((v) => (
                  <option key={v} value={v}>
                    {t(
                      v === "approved"
                        ? "feedback.verdictApproved"
                        : v === "rejected"
                          ? "feedback.verdictRejected"
                          : "feedback.verdictCounter",
                    )}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className={LABEL} htmlFor="ca-notes">
              {t("feedback.notes")}
            </label>
            <input
              id="ca-notes"
              type="text"
              className={FIELD}
              placeholder={t("feedback.notesPlaceholder")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {feedbackError && (
            <p
              role="alert"
              className="rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
            >
              {feedbackError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => setFeedbackFor(null)}
            >
              {t("feedback.cancel")}
            </Button>
            <Button type="button" disabled={recording} onClick={onFeedback}>
              {recording ? t("feedback.recording") : t("feedback.record")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
