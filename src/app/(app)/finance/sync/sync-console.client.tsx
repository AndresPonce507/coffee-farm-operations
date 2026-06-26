"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD, LABEL } from "@/components/ui/form-field";
import { retrySyncAction, setAccountMapAction } from "../actions";

/**
 * The sync console island (P3-S17).
 *
 * "Process queue" runs the $0 MOCK worker drain for a target: it claims the pending +
 * failed posts (FOR UPDATE SKIP LOCKED in the DB) and stamps each with a fake external
 * id / CUFE — the stubbed Edge Function the spec keeps in dev until a real PAC contract
 * is justified. Stamping a dgi_pac post flips its draft doc to 'issued' (the fiscal
 * gate). "Add mapping" upserts an account_map row (how each ledger key posts to the
 * buyer's chart of accounts). Both are explicit human clicks; no untrusted inbound
 * drives a write here (rail §7 — inbound pulls are applied server-side, never from this UI).
 */

const TARGETS = ["qbo", "xero", "dgi_pac"] as const;
const ENTRY_KINDS = ["cost", "revenue"] as const;

export function SyncConsole() {
  const t = useTranslations("finance");
  const router = useRouter();

  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string>("qbo");
  const [entryKind, setEntryKind] = useState<string>("revenue");
  const [matchKey, setMatchKey] = useState("");
  const [accountCode, setAccountCode] = useState("");
  const [accountName, setAccountName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function processQueue(tg: string) {
    setBusy(tg);
    await retrySyncAction({ target: tg });
    setBusy(null);
    router.refresh();
  }

  async function saveMapping() {
    setError(null);
    setPending(true);
    const result = await setAccountMapAction({
      target,
      entryKind,
      matchKey,
      accountCode,
      accountName: accountName.trim() || null,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setMatchKey("");
    setAccountCode("");
    setAccountName("");
    router.refresh();
  }

  return (
    <div className="glass-card flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
      <div className="flex flex-wrap gap-2">
        {TARGETS.map((tg) => (
          <Button
            key={tg}
            variant="outline"
            size="sm"
            onClick={() => processQueue(tg)}
            disabled={busy === tg}
          >
            <RefreshCcw className="h-3.5 w-3.5" aria-hidden />
            {t(`sync.target.${tg}` as "sync.target.qbo")}
            {" · "}
            {busy === tg ? t("sync.health.processing") : t("sync.health.retry")}
          </Button>
        ))}
      </div>

      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden />
        {t("sync.map.add")}
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title={t("sync.map.add")}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className={LABEL}>{t("sync.map.target")}</span>
              <select
                className={FIELD}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                {TARGETS.map((tg) => (
                  <option key={tg} value={tg}>
                    {t(`sync.target.${tg}` as "sync.target.qbo")}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={LABEL}>{t("sync.map.entryKind")}</span>
              <select
                className={FIELD}
                value={entryKind}
                onChange={(e) => setEntryKind(e.target.value)}
              >
                {ENTRY_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`sync.map.kind.${k}` as "sync.map.kind.revenue")}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="space-y-1">
            <span className={LABEL}>{t("sync.map.matchKey")}</span>
            <input
              className={FIELD}
              value={matchKey}
              onChange={(e) => setMatchKey(e.target.value)}
              placeholder="green_sale"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className={LABEL}>{t("sync.map.accountCode")}</span>
              <input
                className={FIELD}
                value={accountCode}
                onChange={(e) => setAccountCode(e.target.value)}
                placeholder="4000"
              />
            </label>
            <label className="space-y-1">
              <span className={LABEL}>{t("sync.map.accountName")}</span>
              <input
                className={FIELD}
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
              />
            </label>
          </div>
          {error && (
            <p className="rounded-lg bg-cherry-100 px-3 py-2 text-sm text-cherry">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {t("sync.map.cancel")}
            </Button>
            <Button
              onClick={saveMapping}
              disabled={pending || !matchKey.trim() || !accountCode.trim()}
            >
              {t("sync.map.save")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
