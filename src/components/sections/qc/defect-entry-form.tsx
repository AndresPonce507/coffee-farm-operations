"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CheckCircle2, ListPlus, ShieldAlert } from "lucide-react";

import type { DefectCategory, GreenDefect } from "@/lib/types";
import {
  recordDefectAction,
  QC_IDLE,
  type QcActionState,
} from "@/app/(app)/qc/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";

/**
 * DefectEntryForm — the green-grading defect entry surface (P2-S6). This is the
 * MISSING write half of the defect ledger: the `green_defects` table, the
 * `record_defect` RPC, the `getGreenDefects` read port, and the v_qc_status
 * primary/secondary tallies the QC table + cup-to-cause panel render all already
 * existed — but no app path could ever append a row, so every tally was permanently
 * 0/0. This form closes that gap: a grader types a defect kind, a count, picks the
 * primary/secondary band, and appends it through `recordDefectAction`. The ledger is
 * append-only, so existing rows render read-only beneath the form (corrected only by
 * superseding rows, never edited).
 *
 * Client island (it owns the band toggle + submit state). Glass-lite content card,
 * native inputs (AA + keyboard + reduced-motion safe), the shared <Segmented> for
 * the band. es-PA-first labels. The DB CHECKs (count >= 0, category in
 * primary/secondary) are the real enforcement; the command port validates first so a
 * bad entry never round-trips.
 */

const FIELD =
  "h-10 w-full rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100";

const BAND_OPTIONS = [
  { id: "primary", label: "Primary" },
  { id: "secondary", label: "Secondary" },
];

export function DefectEntryForm({
  lotCode,
  defects,
}: {
  lotCode: string;
  defects: GreenDefect[];
}) {
  const [category, setCategory] = useState<DefectCategory>("primary");
  const [state, formAction, pending] = useActionState<QcActionState, FormData>(
    recordDefectAction,
    QC_IDLE,
  );

  // Reset the kind/count fields once a defect lands, so a grader can add the next
  // one without re-clearing (the appended row shows up after the page revalidates).
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  const saved = state.status === "success";
  const errorMessage =
    state.status === "error"
      ? (state.message ??
        Object.values(state.errors ?? {})[0] ??
        "Could not record the defect.")
      : undefined;

  return (
    <Card className="animate-rise">
      <CardHeader>
        <div>
          <CardTitle>Green-grading defects</CardTitle>
          <CardDescription>
            Log the defects found in{" "}
            <span className="font-mono text-forest-700">{lotCode}</span> — primary are
            disqualifying, secondary are quality
          </CardDescription>
        </div>
        <ShieldAlert className="h-5 w-5 text-cherry" aria-hidden />
      </CardHeader>

      <CardContent className="space-y-5 pt-4">
        <form ref={formRef} action={formAction} className="space-y-4">
          <input type="hidden" name="greenLotCode" value={lotCode} />
          {/* The chosen band travels as a controlled hidden field (the Segmented is
              a button group, not a native control). */}
          <input type="hidden" name="category" value={category} />

          <div className="grid gap-4 sm:grid-cols-[1fr_6rem]">
            <div className="space-y-1">
              <label
                className="text-xs font-medium text-muted-fg"
                htmlFor="defect-kind"
              >
                Defect kind
              </label>
              <input
                id="defect-kind"
                name="defectKind"
                placeholder="e.g. full black, quaker, sour"
                className={FIELD}
              />
            </div>
            <div className="space-y-1">
              <label
                className="text-xs font-medium text-muted-fg"
                htmlFor="defect-count"
              >
                Count
              </label>
              <input
                id="defect-count"
                name="count"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                defaultValue={1}
                className={`${FIELD} tabular-nums`}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-medium text-muted-fg">Band</span>
            <Segmented
              options={BAND_OPTIONS}
              value={category}
              onChange={(id) => setCategory(id as DefectCategory)}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div aria-live="polite" className="min-h-[1.25rem] text-sm">
              {saved && (
                <span
                  role="status"
                  className="inline-flex items-center gap-1.5 font-medium text-forest-700"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  Defect recorded — bound to this lot forever.
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
            <Button type="submit" disabled={pending} className="shrink-0">
              <ListPlus className="h-4 w-4" />
              {pending ? "Adding…" : "Add defect"}
            </Button>
          </div>
        </form>

        {/* The append-only ledger for this lot — read-only history. */}
        <div className="border-t border-line/70 pt-4">
          {defects.length === 0 ? (
            <p className="text-sm text-muted-fg">
              No green-grading defects logged for this lot yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {defects.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/60 bg-white/55 px-4 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <Badge tone={d.category === "primary" ? "cherry" : "neutral"} dot>
                      {d.category}
                    </Badge>
                    <span className="text-sm capitalize text-ink">
                      {d.defectKind}
                    </span>
                  </div>
                  <span className="font-display text-sm font-semibold tabular-nums text-ink">
                    {d.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
