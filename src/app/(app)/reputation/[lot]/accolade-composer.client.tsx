"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PenLine, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD, LABEL } from "@/components/ui/form-field";
import {
  recordAccoladeAction,
  reviseAccoladeAction,
} from "../actions";

/**
 * AccoladeComposer — the ONE interactive island on /reputation/[lot] (the page stays a
 * Server Component). Two owner-authored, human-submitted write paths (rail §7, never
 * driven by untrusted inbound):
 *   • Record — binds a NEW cup score / award / certification / press mention. The score
 *     field appears only for a cup score (the regime the DB CHECK enforces).
 *   • Revise — the correction path: posts a 'score-revision' REVERSING row. The
 *     original stays on the ledger, marked superseded — an append-only correction, the
 *     cost_entry idiom, surfaced as a confirm so the owner knows it supersedes, never
 *     edits.
 * Both call their Server Action then router.refresh() so the freshly-appended entry
 * shows on the ledger immediately (an accolade moves no inventory, so there is no
 * ATP ripple to fan out).
 */

type RecordKind = "cup-score" | "award" | "certification" | "press-mention";
const KINDS: RecordKind[] = [
  "cup-score",
  "award",
  "certification",
  "press-mention",
];

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `acc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

const parseNum = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

export function AccoladeComposer({
  lotCode,
  revisable,
}: {
  lotCode: string;
  revisable: { id: number; label: string }[];
}) {
  const t = useTranslations("reputation");
  const router = useRouter();

  const [recordOpen, setRecordOpen] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);

  return (
    <div className="glass-card rounded-2xl p-5">
      <div className="flex flex-col gap-2">
        <Button type="button" onClick={() => setRecordOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          {t("compose.open")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={revisable.length === 0}
          onClick={() => setReviseOpen(true)}
        >
          <PenLine className="h-4 w-4" aria-hidden />
          {t("revise.open")}
        </Button>
        {revisable.length === 0 && (
          <p className="text-xs text-muted-fg">{t("revise.none")}</p>
        )}
        <p className="mt-1 text-xs text-muted-fg">{t("compose.immutable")}</p>
      </div>

      <RecordDialog
        lotCode={lotCode}
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        onDone={() => router.refresh()}
      />
      <ReviseDialog
        revisable={revisable}
        open={reviseOpen}
        onClose={() => setReviseOpen(false)}
        onDone={() => router.refresh()}
      />
    </div>
  );
}

function RecordDialog({
  lotCode,
  open,
  onClose,
  onDone,
}: {
  lotCode: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("reputation");

  const [kind, setKind] = useState<RecordKind>("cup-score");
  const [title, setTitle] = useState("");
  const [scoreStr, setScoreStr] = useState("");
  const [awardedBy, setAwardedBy] = useState("");
  const [yearStr, setYearStr] = useState("");
  const [evidence, setEvidence] = useState("");

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const isScore = kind === "cup-score";

  function reset() {
    setTitle("");
    setScoreStr("");
    setAwardedBy("");
    setYearStr("");
    setEvidence("");
    setError(null);
    setDone(false);
  }

  async function onSubmit() {
    setError(null);
    setPending(true);
    const result = await recordAccoladeAction({
      lotCode,
      kind,
      title: title.trim() === "" ? null : title.trim(),
      score: isScore ? parseNum(scoreStr) : null,
      awardedBy: awardedBy.trim() === "" ? null : awardedBy.trim(),
      awardYear: parseNum(yearStr),
      evidenceUrl: evidence.trim() === "" ? null : evidence.trim(),
      sourceSessionId: null,
      idempotencyKey: newKey(),
    });
    setPending(false);
    if (result.ok) {
      setDone(true);
      onDone();
    } else {
      setError(result.error);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("compose.title")}>
      {done ? (
        <div className="space-y-4">
          <p className="text-sm font-medium text-forest">
            {t("compose.recorded")}
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("compose.cancel")}
            </Button>
            <Button type="button" onClick={reset}>
              {t("compose.another")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1">
            <label className={LABEL} htmlFor="acc-kind">
              {t("compose.kindLabel")}
            </label>
            <select
              id="acc-kind"
              className={FIELD}
              value={kind}
              onChange={(e) => setKind(e.target.value as RecordKind)}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kind.${k}`)}
                </option>
              ))}
            </select>
          </div>

          {isScore ? (
            <div className="space-y-1">
              <label className={LABEL} htmlFor="acc-score">
                {t("compose.scoreLabel")}
              </label>
              <input
                id="acc-score"
                type="number"
                min={0}
                max={100}
                step="0.1"
                inputMode="decimal"
                className={FIELD}
                value={scoreStr}
                onChange={(e) => setScoreStr(e.target.value)}
              />
              <p className="text-xs text-muted-fg">{t("compose.scoreHint")}</p>
            </div>
          ) : (
            <div className="space-y-1">
              <label className={LABEL} htmlFor="acc-title">
                {t("compose.titleLabel")}
              </label>
              <input
                id="acc-title"
                type="text"
                className={FIELD}
                placeholder={t("compose.titlePlaceholder")}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-1">
            <label className={LABEL} htmlFor="acc-by">
              {t("compose.awardedByLabel")}
            </label>
            <input
              id="acc-by"
              type="text"
              className={FIELD}
              placeholder={t("compose.awardedByPlaceholder")}
              value={awardedBy}
              onChange={(e) => setAwardedBy(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className={LABEL} htmlFor="acc-year">
                {t("compose.yearLabel")}
              </label>
              <input
                id="acc-year"
                type="number"
                min={1900}
                max={2200}
                step="1"
                inputMode="numeric"
                className={FIELD}
                value={yearStr}
                onChange={(e) => setYearStr(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className={LABEL} htmlFor="acc-evidence">
                {t("compose.evidenceLabel")}
              </label>
              <input
                id="acc-evidence"
                type="url"
                className={FIELD}
                placeholder={t("compose.evidencePlaceholder")}
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
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

          <p className="text-xs text-muted-fg">{t("compose.immutable")}</p>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("compose.cancel")}
            </Button>
            <Button type="button" disabled={pending} onClick={onSubmit}>
              {pending ? t("compose.submitting") : t("compose.submit")}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function ReviseDialog({
  revisable,
  open,
  onClose,
  onDone,
}: {
  revisable: { id: number; label: string }[];
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("reputation");

  const [accoladeId, setAccoladeId] = useState<number>(revisable[0]?.id ?? 0);
  const [scoreStr, setScoreStr] = useState("");
  const [note, setNote] = useState("");

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit() {
    setError(null);
    setPending(true);
    const result = await reviseAccoladeAction({
      accoladeId: Number(accoladeId),
      newScore: parseNum(scoreStr) ?? NaN,
      note: note.trim() === "" ? null : note.trim(),
      idempotencyKey: newKey(),
    });
    setPending(false);
    if (result.ok) {
      setDone(true);
      onDone();
    } else {
      setError(result.error);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("revise.title")}>
      {done ? (
        <div className="space-y-4">
          <p className="text-sm font-medium text-forest">{t("revise.revised")}</p>
          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("revise.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1">
            <label className={LABEL} htmlFor="rev-which">
              {t("revise.pickLabel")}
            </label>
            <select
              id="rev-which"
              className={FIELD}
              value={accoladeId}
              onChange={(e) => setAccoladeId(Number(e.target.value))}
            >
              {revisable.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className={LABEL} htmlFor="rev-score">
              {t("revise.newScoreLabel")}
            </label>
            <input
              id="rev-score"
              type="number"
              min={0}
              max={100}
              step="0.1"
              inputMode="decimal"
              className={FIELD}
              value={scoreStr}
              onChange={(e) => setScoreStr(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className={LABEL} htmlFor="rev-note">
              {t("revise.noteLabel")}
            </label>
            <input
              id="rev-note"
              type="text"
              className={FIELD}
              placeholder={t("revise.notePlaceholder")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
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

          <p className="text-xs text-muted-fg">{t("revise.supersedes")}</p>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("revise.cancel")}
            </Button>
            <Button
              type="button"
              disabled={pending || revisable.length === 0}
              onClick={onSubmit}
            >
              {pending ? t("revise.submitting") : t("revise.submit")}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
