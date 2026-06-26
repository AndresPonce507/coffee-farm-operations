"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { FIELD, LABEL } from "@/components/ui/form-field";
import { num } from "@/lib/utils";
import type { ByproductKind, MachineKind, MillRunStatus } from "./data";
import {
  recordMillByproductAction,
  recordMillPassAction,
} from "./actions";

/**
 * Mass-balance workspace — the ONE interactive island in /mill/[runId]/balance
 * (the page stays a Server Component). Two append-only write doors:
 *   • Record a machine pass — the input kg is PRE-FILLED + locked to the prior pass
 *     output (or the parchment-in for pass 1) so the clean stream stays continuous;
 *     the operator enters only the clean output + reject. The DB is the real wall
 *     (the per-pass mass CHECK + the in-RPC continuity guard); this is the courtesy.
 *   • Record a byproduct — mints a fresh sellable, traceable byproduct lots node +
 *     a conserved 'byproduct' lot_edge (the existing lot_edges_conserve_mass trigger
 *     guards it for free; no parallel counter).
 * Both are recorded by a human operator clicking submit — no untrusted inbound ever
 * drives the write (rail §7). After a committed write we router.refresh() so the
 * server-rendered gauge / chain / ledger re-derive in place (the Wiring pass will
 * add a dedicated milling EventKind to the reactive-refresh SSOT and repoint).
 */

const MACHINES: MachineKind[] = [
  "huller",
  "polisher",
  "screen_grader",
  "gravity_table",
  "optical_sorter",
];
const BYPRODUCTS: ByproductKind[] = [
  "husk",
  "chaff",
  "screen_rejects",
  "defects",
];

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `m_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

export function MassBalanceWorkspace({
  runId,
  status,
  parchmentKgIn,
  lastPassNo,
  lastPassOutputKg,
}: {
  runId: number;
  status: MillRunStatus;
  parchmentKgIn: number;
  lastPassNo: number;
  lastPassOutputKg: number | null;
}) {
  const t = useTranslations("millBalance");
  const router = useRouter();
  const open = status === "open";

  // continuity: the next pass is fed exactly what the prior pass emitted.
  const nextPassNo = lastPassNo + 1;
  const expectedInput = lastPassOutputKg ?? parchmentKgIn;

  // ── pass form ──
  const [outputStr, setOutputStr] = useState("");
  const [rejectStr, setRejectStr] = useState("0");
  const [machine, setMachine] = useState<MachineKind | "">("");
  const [passPending, setPassPending] = useState(false);
  const [passError, setPassError] = useState<string | null>(null);
  const [passOk, setPassOk] = useState(false);

  // ── byproduct form ──
  const [bypKind, setBypKind] = useState<ByproductKind | "">("");
  const [bypKgStr, setBypKgStr] = useState("");
  const [bypPending, setBypPending] = useState(false);
  const [bypError, setBypError] = useState<string | null>(null);
  const [bypOk, setBypOk] = useState<string | null>(null);

  async function onRecordPass() {
    setPassError(null);
    setPassOk(false);
    setPassPending(true);
    const result = await recordMillPassAction({
      runId,
      passNo: nextPassNo,
      machineKind: machine === "" ? ("" as MachineKind) : machine,
      inputKg: expectedInput,
      outputKg: Number(outputStr),
      rejectKg: rejectStr.trim() === "" ? 0 : Number(rejectStr),
      idempotencyKey: newKey(),
    });
    setPassPending(false);
    if (result.ok) {
      setPassOk(true);
      setOutputStr("");
      setRejectStr("0");
      setMachine("");
      router.refresh();
    } else {
      setPassError(result.error);
    }
  }

  async function onRecordByproduct() {
    setBypError(null);
    setBypOk(null);
    setBypPending(true);
    const result = await recordMillByproductAction({
      runId,
      kind: bypKind === "" ? ("" as ByproductKind) : bypKind,
      kg: Number(bypKgStr),
      idempotencyKey: newKey(),
    });
    setBypPending(false);
    if (result.ok) {
      setBypOk(t("record.byproductRecorded", { code: result.byproductLotCode }));
      setBypKind("");
      setBypKgStr("");
      router.refresh();
    } else {
      setBypError(result.error);
    }
  }

  if (!open) {
    return (
      <div className="glass-card rounded-2xl p-5">
        <p role="status" className="text-sm text-muted-fg">
          {t("record.closedRun", { status: t(`status.${status}`) })}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── record a machine pass ── */}
      <section className="glass-card rounded-2xl p-5">
        <h2 className="font-display text-base font-semibold text-ink">
          {t("record.passTitle")}
        </h2>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <span className={LABEL}>{t("record.passNo")}</span>
            <p className="font-display text-lg font-bold tabular-nums text-ink">
              {nextPassNo}
            </p>
          </div>
          <div className="space-y-1">
            <span className={LABEL}>{t("record.inputKg")}</span>
            <p className="font-display text-lg font-bold tabular-nums text-ink">
              {num(Math.round(expectedInput))}
            </p>
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-fg">
          {t("record.passContinuity")}
        </p>

        <div className="mt-3 space-y-1">
          <label className={LABEL} htmlFor="mp-machine">
            {t("record.machine")}
          </label>
          <select
            id="mp-machine"
            className={FIELD}
            value={machine}
            onChange={(e) => setMachine(e.target.value as MachineKind | "")}
          >
            <option value="">{t("record.machinePlaceholder")}</option>
            {MACHINES.map((m) => (
              <option key={m} value={m}>
                {t(`machine.${m}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className={LABEL} htmlFor="mp-output">
              {t("record.outputKg")}
            </label>
            <input
              id="mp-output"
              type="number"
              min={0}
              step="0.1"
              inputMode="decimal"
              className={FIELD}
              value={outputStr}
              onChange={(e) => setOutputStr(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className={LABEL} htmlFor="mp-reject">
              {t("record.rejectKg")}
            </label>
            <input
              id="mp-reject"
              type="number"
              min={0}
              step="0.1"
              inputMode="decimal"
              className={FIELD}
              value={rejectStr}
              onChange={(e) => setRejectStr(e.target.value)}
            />
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-fg">{t("record.massHint")}</p>

        {passError && (
          <p
            role="alert"
            className="mt-3 rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
          >
            {passError}
          </p>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          {passOk && (
            <span className="mr-auto text-xs font-medium text-forest">
              {t("record.passRecorded")}
            </span>
          )}
          <Button type="button" disabled={passPending} onClick={onRecordPass}>
            {passPending ? t("record.recordingPass") : t("record.submitPass")}
          </Button>
        </div>
      </section>

      {/* ── record a byproduct ── */}
      <section className="glass-card rounded-2xl p-5">
        <h2 className="font-display text-base font-semibold text-ink">
          {t("record.byproductTitle")}
        </h2>

        <div className="mt-3 space-y-1">
          <label className={LABEL} htmlFor="bp-kind">
            {t("record.kind")}
          </label>
          <select
            id="bp-kind"
            className={FIELD}
            value={bypKind}
            onChange={(e) => setBypKind(e.target.value as ByproductKind | "")}
          >
            <option value="">{t("record.kindPlaceholder")}</option>
            {BYPRODUCTS.map((k) => (
              <option key={k} value={k}>
                {t(`byproductKind.${k}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 space-y-1">
          <label className={LABEL} htmlFor="bp-kg">
            {t("record.kg")}
          </label>
          <input
            id="bp-kg"
            type="number"
            min={0}
            step="0.1"
            inputMode="decimal"
            className={FIELD}
            value={bypKgStr}
            onChange={(e) => setBypKgStr(e.target.value)}
          />
        </div>
        <p className="mt-1 text-xs text-muted-fg">{t("record.byproductHint")}</p>

        {bypError && (
          <p
            role="alert"
            className="mt-3 rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
          >
            {bypError}
          </p>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          {bypOk && (
            <span className="mr-auto text-xs font-medium text-forest">
              {bypOk}
            </span>
          )}
          <Button
            type="button"
            variant="secondary"
            disabled={bypPending}
            onClick={onRecordByproduct}
          >
            {bypPending
              ? t("record.recordingByproduct")
              : t("record.submitByproduct")}
          </Button>
        </div>
      </section>
    </div>
  );
}
