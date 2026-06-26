"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Flame, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD, LABEL } from "@/components/ui/form-field";
import { num } from "@/lib/utils";
import {
  createRoastProfileAction,
  openRoastBatchAction,
} from "./actions";
import type { RoastProfile, RoastableGreenLot, Roaster } from "./data";

/**
 * RoastConsole — the ONE interactive launcher on /roast (the board stays a Server
 * Component). Two human-driven flows (rail §7 — nothing here is driven by untrusted
 * inbound):
 *   • Author a golden-curve profile — born DRAFT (lock it golden before roasting).
 *   • Open a roast batch — the golden gate: only an approved/golden profile is
 *     offered, and the green draw is the oversell-guarded shipment claim at the DB.
 * Each writes through a single SECURITY DEFINER RPC; on success the board re-reads via
 * router.refresh().
 */

const ROAST_LEVELS = [
  "light",
  "medium-light",
  "medium",
  "medium-dark",
  "dark",
] as const;

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `rc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

function numOrNull(s: string): number | null {
  const v = s.trim();
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function RoastConsole({
  goldenProfiles,
  roasters,
  greenLots,
}: {
  goldenProfiles: RoastProfile[];
  roasters: Roaster[];
  greenLots: RoastableGreenLot[];
}) {
  const t = useTranslations("roast");
  const [profileOpen, setProfileOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setProfileOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden />
        {t("console.newProfile")}
      </Button>
      <Button type="button" onClick={() => setBatchOpen(true)}>
        <Flame className="h-4 w-4" aria-hidden />
        {t("console.openBatch")}
      </Button>

      <ProfileDialog
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
      />
      <BatchDialog
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        goldenProfiles={goldenProfiles}
        roasters={roasters}
        greenLots={greenLots}
      />
    </>
  );
}

function ProfileDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("roast");
  const router = useRouter();

  const [name, setName] = useState("");
  const [variety, setVariety] = useState("");
  const [roastLevel, setRoastLevel] = useState<string>("medium");
  const [chargeStr, setChargeStr] = useState("");
  const [dropStr, setDropStr] = useState("");
  const [timeStr, setTimeStr] = useState("");
  const [dtrStr, setDtrStr] = useState("");

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const charge = numOrNull(chargeStr);
  const drop = numOrNull(dropStr);
  const total = numOrNull(timeStr);

  const canSubmit =
    !pending &&
    name.trim() !== "" &&
    charge != null &&
    charge > 0 &&
    drop != null &&
    drop > 0 &&
    total != null &&
    total > 0;

  async function onSubmit() {
    if (!canSubmit || charge == null || drop == null || total == null) return;
    setError(null);
    setPending(true);
    const result = await createRoastProfileAction({
      name,
      variety: variety.trim() === "" ? null : variety.trim(),
      roastLevel,
      chargeTempC: charge,
      dropTempC: drop,
      totalTimeS: total,
      dtrPct: numOrNull(dtrStr),
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
    <Dialog open={open} onClose={onClose} title={t("console.profile.title")}>
      {done ? (
        <div className="space-y-4">
          <p className="text-sm font-medium text-forest">
            {t("console.created")}
          </p>
          <div className="flex justify-end">
            <Button type="button" onClick={onClose}>
              {t("lock.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1">
            <label className={LABEL} htmlFor="rp-name">
              {t("console.profile.name")}
            </label>
            <input
              id="rp-name"
              type="text"
              className={FIELD}
              placeholder={t("console.profile.namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className={LABEL} htmlFor="rp-variety">
                {t("console.profile.variety")}
              </label>
              <input
                id="rp-variety"
                type="text"
                className={FIELD}
                placeholder={t("console.profile.varietyPlaceholder")}
                value={variety}
                onChange={(e) => setVariety(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className={LABEL} htmlFor="rp-level">
                {t("console.profile.roastLevel")}
              </label>
              <select
                id="rp-level"
                className={FIELD}
                value={roastLevel}
                onChange={(e) => setRoastLevel(e.target.value)}
              >
                {ROAST_LEVELS.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {t(`roastLevel.${lvl}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <NumField
              id="rp-charge"
              label={t("console.profile.charge")}
              value={chargeStr}
              onChange={setChargeStr}
              step="1"
            />
            <NumField
              id="rp-drop"
              label={t("console.profile.drop")}
              value={dropStr}
              onChange={setDropStr}
              step="1"
            />
            <NumField
              id="rp-time"
              label={t("console.profile.totalTime")}
              value={timeStr}
              onChange={setTimeStr}
              step="1"
            />
          </div>

          <NumField
            id="rp-dtr"
            label={t("console.profile.dtr")}
            value={dtrStr}
            onChange={setDtrStr}
            step="0.1"
          />

          <p className="text-xs text-muted-fg">{t("console.profile.hint")}</p>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
            >
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("lock.cancel")}
            </Button>
            <Button type="button" disabled={!canSubmit} onClick={onSubmit}>
              {pending
                ? t("console.profile.submitting")
                : t("console.profile.submit")}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function BatchDialog({
  open,
  onClose,
  goldenProfiles,
  roasters,
  greenLots,
}: {
  open: boolean;
  onClose: () => void;
  goldenProfiles: RoastProfile[];
  roasters: Roaster[];
  greenLots: RoastableGreenLot[];
}) {
  const t = useTranslations("roast");
  const router = useRouter();

  const [lotCode, setLotCode] = useState(greenLots[0]?.greenLotCode ?? "");
  const [profileId, setProfileId] = useState(
    goldenProfiles[0] ? String(goldenProfiles[0].id) : "",
  );
  const [roasterId, setRoasterId] = useState(
    roasters[0] ? String(roasters[0].id) : "",
  );
  const [kgStr, setKgStr] = useState("");

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const selectedLot = useMemo(
    () => greenLots.find((l) => l.greenLotCode === lotCode) ?? null,
    [greenLots, lotCode],
  );
  const kg = numOrNull(kgStr);

  const hasGolden = goldenProfiles.length > 0;
  const hasGreen = greenLots.length > 0;
  const canSubmit =
    !pending &&
    hasGolden &&
    hasGreen &&
    lotCode !== "" &&
    profileId !== "" &&
    roasterId !== "" &&
    kg != null &&
    kg > 0;

  async function onSubmit() {
    if (!canSubmit || kg == null) return;
    setError(null);
    setPending(true);
    const result = await openRoastBatchAction({
      greenLotCode: lotCode,
      profileId: Number(profileId),
      roasterId: Number(roasterId),
      greenInKg: kg,
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
    <Dialog open={open} onClose={onClose} title={t("console.batch.title")}>
      {done ? (
        <div className="space-y-4">
          <p className="text-sm font-medium text-forest">
            {t("console.opened")}
          </p>
          <div className="flex justify-end">
            <Button type="button" onClick={onClose}>
              {t("lock.cancel")}
            </Button>
          </div>
        </div>
      ) : !hasGolden ? (
        <p className="text-sm text-muted-fg">{t("console.batch.noGolden")}</p>
      ) : !hasGreen ? (
        <p className="text-sm text-muted-fg">{t("console.batch.noGreen")}</p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1">
            <label className={LABEL} htmlFor="rb-lot">
              {t("console.batch.greenLot")}
            </label>
            <select
              id="rb-lot"
              className={FIELD}
              value={lotCode}
              onChange={(e) => setLotCode(e.target.value)}
            >
              {greenLots.map((l) => (
                <option key={l.greenLotCode} value={l.greenLotCode}>
                  {l.greenLotCode}
                  {l.variety ? ` · ${l.variety}` : ""}
                </option>
              ))}
            </select>
            {selectedLot && (
              <p className="text-[0.6875rem] tabular-nums text-muted-fg">
                {t("console.batch.atpLine", { kg: num(selectedLot.atpKg) })}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className={LABEL} htmlFor="rb-profile">
                {t("console.batch.profile")}
              </label>
              <select
                id="rb-profile"
                className={FIELD}
                value={profileId}
                onChange={(e) => setProfileId(e.target.value)}
              >
                {goldenProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {t("profile.version", { version: num(p.version) })}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className={LABEL} htmlFor="rb-roaster">
                {t("console.batch.roaster")}
              </label>
              <select
                id="rb-roaster"
                className={FIELD}
                value={roasterId}
                onChange={(e) => setRoasterId(e.target.value)}
              >
                {roasters.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <NumField
            id="rb-kg"
            label={t("console.batch.kg")}
            value={kgStr}
            onChange={setKgStr}
            step="0.1"
          />

          <p className="text-xs text-muted-fg">
            {t("console.batch.irreversible")}
          </p>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
            >
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("lock.cancel")}
            </Button>
            <Button type="button" disabled={!canSubmit} onClick={onSubmit}>
              {pending
                ? t("console.batch.submitting")
                : t("console.batch.submit")}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function NumField({
  id,
  label,
  value,
  onChange,
  step,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  step: string;
}) {
  return (
    <div className="space-y-1">
      <label className={LABEL} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={0}
        step={step}
        inputMode="decimal"
        className={FIELD}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
