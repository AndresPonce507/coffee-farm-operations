"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD, LABEL } from "@/components/ui/form-field";
import type { BuyerOption, LotOption, SampleKind } from "./data";
import { logSampleAction, recordVerdictAction } from "./actions";

/**
 * The TWO interactive islands in /sales/samples (the board stays a Server Component):
 *   • <LogSampleButton>     — opens the "log a sample" form (green lot, buyer, kind,
 *     grams, courier, tracking). A pre-shipment kind draws ATP server-side, so the
 *     EXISTING prevent_oversell trigger guards the draw — the form never invents a
 *     counter. The human submits; no untrusted inbound fires this (rail §7).
 *   • <RecordVerdictButton> — records the buyer's score + verdict on one open sample.
 *     An approved pre-shipment verdict is the keystone that unlocks signing a reserve
 *     contract, surfaced inline so the operator sees the consequence before saving.
 *
 * On success each island calls router.refresh() so the server-rendered board re-reads
 * the (now-changed) pipeline. Errors surface verbatim from the action (author-written
 * guard copy) in an assertive alert — never a raw SQLSTATE.
 */

const KINDS: SampleKind[] = ["offer", "pre_shipment", "type", "arbitration"];

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `s_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

export function LogSampleButton({
  lots,
  buyers,
}: {
  lots: LotOption[];
  buyers: BuyerOption[];
}) {
  const t = useTranslations("samples");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [lot, setLot] = useState<string>(lots[0]?.code ?? "");
  const [buyer, setBuyer] = useState<string>("");
  const [kind, setKind] = useState<SampleKind>("offer");
  const [grams, setGrams] = useState<string>("");
  const [courier, setCourier] = useState<string>("");
  const [tracking, setTracking] = useState<string>("");

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function reset() {
    setError(null);
    setDone(false);
    setGrams("");
    setCourier("");
    setTracking("");
  }

  async function onSubmit() {
    setError(null);
    setPending(true);
    const result = await logSampleAction({
      greenLotCode: lot.trim(),
      buyerId: buyer === "" ? null : Number(buyer),
      sampleKind: kind,
      grams: grams.trim() === "" ? NaN : Number(grams),
      courier,
      trackingNo: tracking,
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
      <Button
        type="button"
        variant="primary"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        {t("log.open")}
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title={t("log.title")}>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className={LABEL} htmlFor="ls-lot">
              {t("log.lotLabel")}
            </label>
            <select
              id="ls-lot"
              className={FIELD}
              value={lot}
              onChange={(e) => setLot(e.target.value)}
            >
              {lots.length === 0 && <option value="">{t("log.lotPlaceholder")}</option>}
              {lots.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.code}
                  {l.scaGrade ? ` · ${l.scaGrade}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className={LABEL} htmlFor="ls-buyer">
              {t("log.buyerLabel")}
            </label>
            <select
              id="ls-buyer"
              className={FIELD}
              value={buyer}
              onChange={(e) => setBuyer(e.target.value)}
            >
              <option value="">{t("log.buyerNone")}</option>
              {buyers.map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className={LABEL} htmlFor="ls-kind">
                {t("log.kindLabel")}
              </label>
              <select
                id="ls-kind"
                className={FIELD}
                value={kind}
                onChange={(e) => setKind(e.target.value as SampleKind)}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`kind.${k}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className={LABEL} htmlFor="ls-grams">
                {t("log.gramsLabel")}
              </label>
              <input
                id="ls-grams"
                type="number"
                min={1}
                step="1"
                inputMode="decimal"
                className={FIELD}
                value={grams}
                onChange={(e) => setGrams(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-fg">{t("log.gramsHint")}</p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className={LABEL} htmlFor="ls-courier">
                {t("log.courierLabel")}
              </label>
              <input
                id="ls-courier"
                type="text"
                className={FIELD}
                placeholder={t("log.courierPlaceholder")}
                value={courier}
                onChange={(e) => setCourier(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className={LABEL} htmlFor="ls-tracking">
                {t("log.trackingLabel")}
              </label>
              <input
                id="ls-tracking"
                type="text"
                className={FIELD}
                placeholder={t("log.trackingPlaceholder")}
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
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
          {done && (
            <p
              role="status"
              className="rounded-lg bg-forest-100 px-3 py-2 text-xs font-medium text-forest"
            >
              {t("log.logged")}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("log.cancel")}
            </Button>
            <Button type="button" disabled={pending || done} onClick={onSubmit}>
              {pending ? t("log.submitting") : t("log.submit")}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

const VERDICTS = ["approved", "rejected", "counter"] as const;
type Verdict = (typeof VERDICTS)[number];

export function RecordVerdictButton({
  sampleId,
  lot,
  buyerName,
  sampleKind,
}: {
  sampleId: number;
  lot: string;
  buyerName: string | null;
  sampleKind: SampleKind;
}) {
  const t = useTranslations("samples");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [verdict, setVerdict] = useState<Verdict>("approved");
  const [score, setScore] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit() {
    setError(null);
    setPending(true);
    const result = await recordVerdictAction({
      sampleId,
      buyerScore: score.trim() === "" ? null : Number(score),
      buyerVerdict: verdict,
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
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setError(null);
          setDone(false);
          setOpen(true);
        }}
      >
        {t("verdict.open")}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("verdict.title")}
      >
        <div className="space-y-4">
          <p className="text-sm text-ink">
            {t("verdict.body", {
              buyer: buyerName ?? t("verdict.noBuyer"),
              kind: t(`kind.${sampleKind}`),
              lot,
            })}
          </p>

          <div className="space-y-1">
            <label className={LABEL} htmlFor="rv-verdict">
              {t("verdict.verdictLabel")}
            </label>
            <select
              id="rv-verdict"
              className={FIELD}
              value={verdict}
              onChange={(e) => setVerdict(e.target.value as Verdict)}
            >
              {VERDICTS.map((v) => (
                <option key={v} value={v}>
                  {t(`verdict.${v}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className={LABEL} htmlFor="rv-score">
              {t("verdict.scoreLabel")}
            </label>
            <input
              id="rv-score"
              type="number"
              min={0}
              max={100}
              step="0.5"
              inputMode="decimal"
              className={FIELD}
              placeholder={t("verdict.scorePlaceholder")}
              value={score}
              onChange={(e) => setScore(e.target.value)}
            />
            <p className="text-xs text-muted-fg">{t("verdict.scoreHint")}</p>
          </div>

          {sampleKind === "pre_shipment" && (
            <p className="rounded-xl border border-forest/15 bg-forest/[0.04] px-3 py-2.5 text-xs text-forest">
              {t("verdict.unlockNote")}
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
            >
              {error}
            </p>
          )}
          {done && (
            <p
              role="status"
              className="rounded-lg bg-forest-100 px-3 py-2 text-xs font-medium text-forest"
            >
              {t("verdict.saved")}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("verdict.cancel")}
            </Button>
            <Button type="button" disabled={pending || done} onClick={onSubmit}>
              {pending ? t("verdict.submitting") : t("verdict.submit")}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
