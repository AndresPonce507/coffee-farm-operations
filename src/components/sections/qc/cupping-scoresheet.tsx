"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ClipboardCheck } from "lucide-react";

import type { CuppingProtocol } from "@/lib/types";
import {
  recordCuppingSessionAction,
  recordCupScoreAction,
  QC_IDLE,
  type QcActionState,
} from "@/app/(app)/qc/actions";
import {
  attributesFor,
  cupFinalScore,
  cupQualityBand,
} from "@/lib/ui/cva-scoring";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { num } from "@/lib/utils";

/**
 * CuppingScoresheet — the joy-to-use cupping form (P2-S6). A glass scoresheet that
 * renders the right attribute set for the chosen protocol (SCA CVA 2023 / legacy
 * 100-pt), each attribute a big slider, with a LIVE running total computed by the
 * shared pure `cva-scoring.ts` (the same module the server total is derived from),
 * and a live quality band so the cupper sees where the cup lands as they score.
 *
 * Client island (it owns the interactive scoring). Sliders are glove-friendly,
 * keyboard-operable (native range = AA + reduced-motion safe). The protocol toggle
 * reuses the shared <Segmented>. A score 0–10 per attribute; the total updates on
 * every change. Pressing "Record cup" opens a session through
 * `recordCuppingSessionAction` (lot + cupper + protocol + calibration) and then
 * appends every scored attribute to the append-only cupping-score ledger through
 * `recordCupScoreAction` against the returned session — so the cup the family sees
 * on screen is the cup `v_cup_final_score` / `v_cupper_drift` read back.
 */

const BAND_TONE: Record<string, BadgeTone> = {
  Presidential: "forest",
  Specialty: "honey",
  Premium: "coffee",
  "Below Specialty": "neutral",
};

export function CuppingScoresheet({
  lotCode,
  cuppers,
}: {
  lotCode: string;
  cuppers: { id: string; name: string }[];
}) {
  const [protocol, setProtocol] = useState<CuppingProtocol>("sca-cva");
  const [scores, setScores] = useState<Record<string, number>>({});
  const [cupperId, setCupperId] = useState<string>(cuppers[0]?.id ?? "");
  const [isCalibration, setIsCalibration] = useState(false);

  const [sessionState, formAction, pending] = useActionState<
    QcActionState,
    FormData
  >(recordCuppingSessionAction, QC_IDLE);

  // Once the session opens, append every scored attribute to the cup ledger —
  // exactly once per session (the ref guards a re-fire on the success render).
  const appendedRef = useRef<number | null>(null);
  const [appended, setAppended] = useState(false);

  const attributes = attributesFor(protocol);

  const total = useMemo(
    () =>
      cupFinalScore(
        protocol,
        attributes.map((a) => ({ attribute: a, score: scores[a] ?? 0 })),
      ),
    [protocol, attributes, scores],
  );
  const band = cupQualityBand(total);

  // A snapshot of the scores to persist, captured when the session opens so a
  // mid-flight slider change can't skew what lands against this session.
  const pendingScoresRef = useRef<{ attribute: string; score: number }[]>([]);
  useEffect(() => {
    if (!pending && sessionState.status !== "success") {
      pendingScoresRef.current = attributes
        .map((attribute) => ({ attribute, score: scores[attribute] ?? 0 }))
        .filter((s) => s.score > 0);
    }
  }, [pending, sessionState.status, attributes, scores]);

  useEffect(() => {
    if (sessionState.status !== "success" || !sessionState.sessionId) return;
    if (appendedRef.current === sessionState.sessionId) return;
    appendedRef.current = sessionState.sessionId;

    const sessionId = sessionState.sessionId;
    void Promise.all(
      pendingScoresRef.current.map((s) => {
        const fd = new FormData();
        fd.set("sessionId", String(sessionId));
        fd.set("attribute", s.attribute);
        fd.set("score", String(s.score));
        // deviceId / deviceSeq / idempotencyKey are minted server-side by the
        // action (synthetic "server" envelope); the form sends only the score.
        return recordCupScoreAction(QC_IDLE, fd);
      }),
    ).then(() => setAppended(true));
  }, [sessionState]);

  function setScore(attribute: string, value: number) {
    setScores((prev) => ({ ...prev, [attribute]: value }));
  }

  function onProtocol(id: string) {
    setProtocol(id as CuppingProtocol);
    setScores({}); // a new scoresheet starts fresh
  }

  const saved = sessionState.status === "success";
  const errorMessage =
    sessionState.status === "error"
      ? (sessionState.message ??
        Object.values(sessionState.errors ?? {})[0] ??
        "Could not record the cup.")
      : undefined;

  return (
    <Card className="animate-rise">
      <CardHeader>
        <div>
          <CardTitle>Cupping scoresheet</CardTitle>
          <CardDescription>
            <span className="font-mono text-forest-700">{lotCode}</span> · score each
            attribute 0–10 — the total mirrors the server&apos;s
          </CardDescription>
        </div>
        <Segmented
          options={[
            { id: "sca-cva", label: "SCA CVA" },
            { id: "legacy-100", label: "Legacy 100-pt" },
          ]}
          value={protocol}
          onChange={onProtocol}
        />
      </CardHeader>

      <CardContent className="space-y-5 pt-4">
        <form action={formAction} className="space-y-5">
          {/* The capture envelope the session action reads. */}
          <input type="hidden" name="greenLotCode" value={lotCode} />
          <input type="hidden" name="protocol" value={protocol} />

          {/* Session meta: who cupped + whether this is a calibration sample. */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs font-medium text-muted-fg" htmlFor="cupper">
              Cupper
            </label>
            <select
              id="cupper"
              name="cupperId"
              value={cupperId}
              onChange={(e) => setCupperId(e.target.value)}
              className="h-9 rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100"
            >
              {cuppers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-fg">
              <input
                type="checkbox"
                name="isCalibration"
                checked={isCalibration}
                onChange={(e) => setIsCalibration(e.target.checked)}
                className="h-4 w-4 rounded border-line accent-forest-600"
              />
              Calibration sample
            </label>
          </div>

          {/* Attribute sliders. */}
          <div className="grid gap-3 sm:grid-cols-2">
            {attributes.map((attribute) => {
              const value = scores[attribute] ?? 0;
              return (
                <div
                  key={attribute}
                  className="rounded-2xl border border-white/60 bg-white/55 px-4 py-3"
                >
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor={`attr-${attribute}`}
                      className="text-sm font-medium capitalize text-ink"
                    >
                      {attribute.replace(/-/g, " ")}
                    </label>
                    <span className="font-display text-base font-semibold tabular-nums text-forest-700">
                      {num(value, 2)}
                    </span>
                  </div>
                  <input
                    id={`attr-${attribute}`}
                    type="range"
                    min={0}
                    max={10}
                    step={0.25}
                    value={value}
                    aria-label={`${attribute} score`}
                    onChange={(e) => setScore(attribute, Number(e.target.value))}
                    className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-forest-100 accent-forest-600"
                  />
                </div>
              );
            })}
          </div>

          {/* Live total + band — the cup landing zone, always visible. */}
          <div className="flex items-center justify-between rounded-2xl border border-forest-100 bg-forest-100/40 px-5 py-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-fg">
                Live total
              </p>
              <p
                data-testid="cup-live-total"
                className="font-display text-3xl font-bold tabular-nums text-forest"
              >
                {num(total, 2)}
              </p>
            </div>
            <Badge tone={BAND_TONE[band] ?? "neutral"} dot>
              {band}
            </Badge>
          </div>

          {/* Record the cup. */}
          <div className="flex items-center justify-between gap-3">
            <div aria-live="polite" className="min-h-[1.25rem] text-sm">
              {saved && (
                <span
                  role="status"
                  className="inline-flex items-center gap-1.5 font-medium text-forest-700"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  {appended
                    ? "Cup recorded — bound to this lot forever."
                    : "Session opened — saving scores…"}
                </span>
              )}
              {errorMessage && (
                <span
                  role="alert"
                  className="inline-flex items-center gap-1.5 font-medium text-cherry"
                >
                  {errorMessage}
                </span>
              )}
            </div>
            <Button
              type="submit"
              disabled={pending || saved}
              className="shrink-0"
            >
              <ClipboardCheck className="h-4 w-4" />
              {pending ? "Recording…" : saved ? "Recorded" : "Record cup"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
