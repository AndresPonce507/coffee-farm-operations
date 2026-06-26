"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ClipboardCheck, FilePlus2, Thermometer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FIELD, LABEL } from "@/components/ui/form-field";
import { cn } from "@/lib/utils";
import {
  issueStorageCertificateAction,
  recordStorageReadingAction,
  upsertStorageLocationAction,
} from "./actions";

/**
 * StorageConsole — the ONE interactive island on /storage (the gauge cluster stays a
 * Server Component). Three owner-authored, human-submitted write paths (rail §7, never
 * driven by untrusted inbound), tabbed so the card stays compact on mobile:
 *   • Log a reading — the $0 manual path (a future LoRaWAN sensor posts the same RPC).
 *   • Add a location — mints / re-bands a controlled-environment location.
 *   • Issue a certificate — the database refuses a zero-readings window, so the verdict
 *     is honest; the cert shows up in the server-rendered log on refresh.
 * Each calls its Server Action then router.refresh() so the new reading / band / cert
 * shows immediately (storage moves no inventory, so there is no ATP ripple).
 */

interface LocationOption {
  code: string;
  name: string;
}
interface LotOption {
  lotCode: string;
  location: string | null;
}

type Tab = "log" | "add" | "cert";

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `st_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

const parseNum = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

function nowLocalInput(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function todayInput(): string {
  return isoDaysAgo(0);
}

export function StorageConsole({
  locations,
  greenLots,
}: {
  locations: LocationOption[];
  greenLots: LotOption[];
}) {
  const t = useTranslations("storage");
  const router = useRouter();
  const hasLocations = locations.length > 0;

  const [tab, setTab] = useState<Tab>(hasLocations ? "log" : "add");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function reset() {
    setError(null);
    setNotice(null);
  }

  // ── log reading ──────────────────────────────────────────────────────────
  const [logCode, setLogCode] = useState(locations[0]?.code ?? "");
  const [temp, setTemp] = useState("");
  const [rh, setRh] = useState("");
  const [aw, setAw] = useState("");
  const [readingAt, setReadingAt] = useState(nowLocalInput());

  async function onLog() {
    reset();
    setPending(true);
    const r = await recordStorageReadingAction({
      locationCode: logCode,
      tempC: parseNum(temp),
      rhPct: parseNum(rh),
      aw: parseNum(aw),
      source: "manual",
      deviceId: null,
      readingAt: new Date(readingAt).toISOString(),
      idempotencyKey: newKey(),
    });
    setPending(false);
    if (r.ok) {
      setNotice(t("console.loggedReading"));
      setTemp("");
      setRh("");
      setAw("");
      router.refresh();
    } else {
      setError(r.error);
    }
  }

  // ── add location ─────────────────────────────────────────────────────────
  const [locCode, setLocCode] = useState("");
  const [locName, setLocName] = useState("");
  const [tMin, setTMin] = useState("15");
  const [tMax, setTMax] = useState("25");
  const [rMin, setRMin] = useState("50");
  const [rMax, setRMax] = useState("65");
  const [awMax, setAwMax] = useState("0.65");

  async function onAddLocation() {
    reset();
    setPending(true);
    const r = await upsertStorageLocationAction({
      code: locCode,
      name: locName,
      tempMinC: Number(tMin),
      tempMaxC: Number(tMax),
      rhMinPct: Number(rMin),
      rhMaxPct: Number(rMax),
      awMax: Number(awMax),
      idempotencyKey: newKey(),
    });
    setPending(false);
    if (r.ok) {
      setNotice(t("console.savedLocation"));
      setLocCode("");
      setLocName("");
      router.refresh();
    } else {
      setError(r.error);
    }
  }

  // ── issue certificate ────────────────────────────────────────────────────
  const nameToCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of locations) m.set(l.name, l.code);
    return m;
  }, [locations]);

  const [certLot, setCertLot] = useState(greenLots[0]?.lotCode ?? "");
  const [certCode, setCertCode] = useState(locations[0]?.code ?? "");
  const [winStart, setWinStart] = useState(isoDaysAgo(30));
  const [winEnd, setWinEnd] = useState(todayInput());

  function onPickCertLot(lotCode: string) {
    setCertLot(lotCode);
    const lot = greenLots.find((g) => g.lotCode === lotCode);
    const mapped = lot?.location ? nameToCode.get(lot.location) : undefined;
    if (mapped) setCertCode(mapped);
  }

  async function onIssueCert() {
    reset();
    setPending(true);
    const r = await issueStorageCertificateAction({
      greenLotCode: certLot,
      locationCode: certCode,
      windowStart: new Date(`${winStart}T00:00:00`).toISOString(),
      windowEnd: new Date(`${winEnd}T23:59:59`).toISOString(),
      idempotencyKey: newKey(),
    });
    setPending(false);
    if (r.ok) {
      setNotice(t("console.issuedCert"));
      router.refresh();
    } else {
      setError(r.error);
    }
  }

  const TABS: { id: Tab; label: string; icon: typeof Thermometer; disabled?: boolean }[] = [
    { id: "log", label: t("console.logReading"), icon: Thermometer, disabled: !hasLocations },
    { id: "add", label: t("console.addLocation"), icon: FilePlus2 },
    {
      id: "cert",
      label: t("console.issueCert"),
      icon: ClipboardCheck,
      disabled: !hasLocations || greenLots.length === 0,
    },
  ];

  return (
    <div className="glass-card rounded-2xl p-5">
      <div>
        <p className="font-display text-base font-semibold text-ink">
          {t("console.title")}
        </p>
        <p className="mt-1 text-xs text-muted-fg">{t("console.subtitle")}</p>
      </div>

      {/* Tab switch */}
      <div className="mt-4 flex flex-wrap gap-1.5" role="tablist" aria-label={t("console.title")}>
        {TABS.map((tabDef) => {
          const Icon = tabDef.icon;
          const active = tab === tabDef.id;
          return (
            <button
              key={tabDef.id}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={tabDef.disabled}
              onClick={() => {
                reset();
                setTab(tabDef.id);
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-40",
                active
                  ? "bg-forest text-paper"
                  : "bg-white/60 text-muted-fg hover:bg-white/80 hover:text-ink",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tabDef.label}
            </button>
          );
        })}
      </div>

      <div className="mt-4 space-y-3">
        {tab === "log" && (
          <>
            <Field label={t("console.fields.location")}>
              <select
                className={FIELD}
                value={logCode}
                onChange={(e) => setLogCode(e.target.value)}
                aria-label={t("console.fields.location")}
              >
                {locations.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label={t("console.fields.temp")}>
                <input className={FIELD} type="number" step="0.1" inputMode="decimal" value={temp} onChange={(e) => setTemp(e.target.value)} />
              </Field>
              <Field label={t("console.fields.rh")}>
                <input className={FIELD} type="number" step="1" inputMode="decimal" value={rh} onChange={(e) => setRh(e.target.value)} />
              </Field>
              <Field label={t("console.fields.aw")}>
                <input className={FIELD} type="number" step="0.01" min={0} max={1} inputMode="decimal" value={aw} onChange={(e) => setAw(e.target.value)} />
              </Field>
            </div>
            <p className="text-[0.6875rem] text-muted-fg">{t("console.awHint")}</p>
            <Field label={t("console.fields.readingAt")}>
              <input className={FIELD} type="datetime-local" value={readingAt} onChange={(e) => setReadingAt(e.target.value)} />
            </Field>
            <div className="flex justify-end pt-1">
              <Button type="button" disabled={pending} onClick={onLog}>
                {pending ? t("console.logging") : t("console.log")}
              </Button>
            </div>
          </>
        )}

        {tab === "add" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("console.fields.locationCode")} hint={t("console.fields.locationCodeHint")}>
                <input className={FIELD} type="text" value={locCode} onChange={(e) => setLocCode(e.target.value)} />
              </Field>
              <Field label={t("console.fields.locationName")}>
                <input className={FIELD} type="text" value={locName} onChange={(e) => setLocName(e.target.value)} />
              </Field>
            </div>
            <Field label={t("console.fields.tempBand")}>
              <div className="grid grid-cols-2 gap-2">
                <input className={FIELD} type="number" step="0.5" aria-label={t("console.fields.min")} value={tMin} onChange={(e) => setTMin(e.target.value)} />
                <input className={FIELD} type="number" step="0.5" aria-label={t("console.fields.max")} value={tMax} onChange={(e) => setTMax(e.target.value)} />
              </div>
            </Field>
            <Field label={t("console.fields.rhBand")}>
              <div className="grid grid-cols-2 gap-2">
                <input className={FIELD} type="number" step="1" aria-label={t("console.fields.min")} value={rMin} onChange={(e) => setRMin(e.target.value)} />
                <input className={FIELD} type="number" step="1" aria-label={t("console.fields.max")} value={rMax} onChange={(e) => setRMax(e.target.value)} />
              </div>
            </Field>
            <Field label={t("console.fields.awMax")} hint={t("console.awHint")}>
              <input className={FIELD} type="number" step="0.01" min={0} max={1} value={awMax} onChange={(e) => setAwMax(e.target.value)} />
            </Field>
            <div className="flex justify-end pt-1">
              <Button type="button" disabled={pending} onClick={onAddLocation}>
                {pending ? t("console.saving") : t("console.save")}
              </Button>
            </div>
          </>
        )}

        {tab === "cert" && (
          <>
            <Field label={t("console.fields.greenLot")}>
              <select className={FIELD} value={certLot} onChange={(e) => onPickCertLot(e.target.value)} aria-label={t("console.fields.greenLot")}>
                {greenLots.map((g) => (
                  <option key={g.lotCode} value={g.lotCode}>
                    {g.lotCode}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("console.fields.location")}>
              <select className={FIELD} value={certCode} onChange={(e) => setCertCode(e.target.value)} aria-label={t("console.fields.location")}>
                {locations.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("console.fields.windowStart")}>
                <input className={FIELD} type="date" value={winStart} onChange={(e) => setWinStart(e.target.value)} />
              </Field>
              <Field label={t("console.fields.windowEnd")}>
                <input className={FIELD} type="date" value={winEnd} onChange={(e) => setWinEnd(e.target.value)} />
              </Field>
            </div>
            <div className="flex justify-end pt-1">
              <Button type="button" disabled={pending} onClick={onIssueCert}>
                {pending ? t("console.issuing") : t("console.issue")}
              </Button>
            </div>
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
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className={LABEL}>{label}</label>
      {children}
      {hint && <p className="text-[0.6875rem] text-muted-fg">{hint}</p>}
    </div>
  );
}
