"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD, LABEL } from "@/components/ui/form-field";
import { upsertContactAction } from "./actions";
import type { ContactKind, ContactStatus } from "./data";

/**
 * NewContactButton — the create-a-contact composer (one of the two client islands in
 * /crm). A glass dialog drives upsert_contact (create branch). Marketing consent is an
 * explicit opt-in that REQUIRES a source (the lawful-basis gate the DB enforces; the UI
 * mirrors it so the human can't even submit a sourceless consent). No untrusted inbound
 * reaches this path — it's an authenticated human filling a form (rail §7).
 */

const KINDS: ContactKind[] = [
  "roaster",
  "importer",
  "agent",
  "distributor",
  "retailer",
  "press",
  "individual",
  "other",
];
const STAGES: ContactStatus[] = ["lead", "prospect", "active", "dormant", "lost"];

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `c_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

export function NewContactButton() {
  const t = useTranslations("crm");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const [name, setName] = useState("");
  const [kind, setKind] = useState<ContactKind>("roaster");
  const [status, setStatus] = useState<ContactStatus>("lead");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [consent, setConsent] = useState(false);
  const [consentSource, setConsentSource] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setKind("roaster");
    setStatus("lead");
    setEmail("");
    setPhone("");
    setCountry("");
    setConsent(false);
    setConsentSource("");
    setError(null);
  }

  async function onSave() {
    setError(null);
    setSaving(true);
    const result = await upsertContactAction({
      contactId: null,
      name,
      kind,
      status,
      countryCode: country.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      buyerId: null,
      consentMarketing: consent,
      consentSource: consent ? consentSource : null,
      idempotencyKey: newKey(),
    });
    setSaving(false);
    if (result.ok) {
      setOpen(false);
      reset();
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  const canSave =
    !saving && name.trim() !== "" && (!consent || consentSource.trim() !== "");

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" aria-hidden />
        {t("newContact.button")}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("newContact.title")}
      >
        <div className="space-y-4">
          <div className="space-y-1">
            <label className={LABEL} htmlFor="nc-name">
              {t("newContact.name")}
            </label>
            <input
              id="nc-name"
              type="text"
              className={FIELD}
              placeholder={t("newContact.namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className={LABEL} htmlFor="nc-kind">
                {t("newContact.kind")}
              </label>
              <select
                id="nc-kind"
                className={FIELD}
                value={kind}
                onChange={(e) => setKind(e.target.value as ContactKind)}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`kind.${k}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className={LABEL} htmlFor="nc-status">
                {t("newContact.status")}
              </label>
              <select
                id="nc-status"
                className={FIELD}
                value={status}
                onChange={(e) => setStatus(e.target.value as ContactStatus)}
              >
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {t(`status.${s}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className={LABEL} htmlFor="nc-email">
                {t("newContact.email")}
              </label>
              <input
                id="nc-email"
                type="email"
                className={FIELD}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className={LABEL} htmlFor="nc-phone">
                {t("newContact.phone")}
              </label>
              <input
                id="nc-phone"
                type="tel"
                className={FIELD}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className={LABEL} htmlFor="nc-country">
              {t("newContact.country")}
            </label>
            <input
              id="nc-country"
              type="text"
              className={FIELD}
              placeholder={t("newContact.countryPlaceholder")}
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2.5 rounded-xl border border-line bg-paper/60 px-3 py-2.5">
            <input
              type="checkbox"
              className="h-4 w-4 accent-forest"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span className="text-sm text-ink">{t("newContact.consent")}</span>
          </label>

          {consent && (
            <div className="space-y-1">
              <label className={LABEL} htmlFor="nc-consent-source">
                {t("newContact.consentSource")}
              </label>
              <input
                id="nc-consent-source"
                type="text"
                className={FIELD}
                placeholder={t("newContact.consentSourcePlaceholder")}
                value={consentSource}
                onChange={(e) => setConsentSource(e.target.value)}
              />
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
            >
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("newContact.cancel")}
            </Button>
            <Button type="button" disabled={!canSave} onClick={onSave}>
              {saving ? t("newContact.saving") : t("newContact.save")}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
