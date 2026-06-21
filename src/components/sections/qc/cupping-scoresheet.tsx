"use client";

import { useMemo, useState } from "react";

import type { CuppingProtocol } from "@/lib/types";
import {
  attributesFor,
  cupFinalScore,
  cupQualityBand,
} from "@/lib/ui/cva-scoring";
import { Badge, type BadgeTone } from "@/components/ui/badge";
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
 * 100-pt), each attribute a big slider, with a LIVE running total that mirrors the
 * authoritative `v_cup_final_score` SQL view exactly (pure cva-scoring.ts, so the
 * preview and the server never disagree). The quality band is shown live so the
 * cupper sees where the cup lands as they score.
 *
 * Client island (it owns the interactive scoring). Sliders are glove-friendly,
 * keyboard-operable (native range = AA + reduced-motion safe). The protocol toggle
 * reuses the shared <Segmented>. A score 0–10 per attribute; the total updates on
 * every change. (Persisting a session/score routes through the recordCuppingSession
 * + recordCupScore Server Actions; this island is the capture surface.)
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

  function setScore(attribute: string, value: number) {
    setScores((prev) => ({ ...prev, [attribute]: value }));
  }

  function onProtocol(id: string) {
    setProtocol(id as CuppingProtocol);
    setScores({}); // a new scoresheet starts fresh
  }

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
        {/* Session meta: who cupped + whether this is a calibration sample. */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-medium text-muted-fg" htmlFor="cupper">
            Cupper
          </label>
          <select
            id="cupper"
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
      </CardContent>
    </Card>
  );
}
