import { ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";
import { useTranslations } from "next-intl";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EntityLink } from "@/components/ui/entity-link";
import { DossierSection } from "@/components/dossier/dossier-section";
import type { WorkerIdentity } from "@/lib/db/dossier/worker";
import type { WorkerCert } from "@/lib/db/people";

/**
 * WorkerIdentitySection — the worker dossier's identity + certifications card.
 *
 * Pure presentational Server Component (page owns the fetch). Renders the
 * identity facts (role, comarca of origin, languages, start year, daily rate)
 * and the crew-membership chip as an <EntityLink kind="crew"> drilling to
 * /crew/[id] — the cross-entity link the roster only HINTS at. Below it, the
 * currently-valid certifications, each with its cert-validity state derived
 * from expires_at (vigente / por vencer ≤30d / sin vencimiento) — the eligibility
 * signal the Scouting/IPM surface gates on. es-PA copy, AA on cream.
 */
export interface WorkerIdentitySectionProps {
  worker: WorkerIdentity;
  certs: WorkerCert[];
  /** Reference "today" for cert-validity math; defaults to now (injectable for tests). */
  now?: Date;
}

/** Days until a date string, or null when no expiry. Pure. */
function daysUntil(expiresAt: string | null, now: Date): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now.getTime();
  return Math.ceil(ms / 86_400_000);
}

type CertState = "valid" | "expiring" | "perennial";

/**
 * Cert-validity classification used by the badge + icon. Pure, exported for test.
 * Returns the state, the day count (for the i18n "expiring" interpolation) and a
 * non-localized label fallback — the rendered badge copy is resolved via t() in
 * the component from `state` + `days`, so this stays a pure, hook-free function.
 */
export function certValidity(
  expiresAt: string | null,
  now: Date,
): { state: CertState; days: number | null; label: string } {
  const d = daysUntil(expiresAt, now);
  if (d === null) return { state: "perennial", days: null, label: "Sin vencimiento" };
  if (d <= 30) return { state: "expiring", days: d, label: `Vence en ${d} d` };
  return { state: "valid", days: d, label: "Vigente" };
}

const CERT_ICON = {
  valid: ShieldCheck,
  expiring: ShieldAlert,
  perennial: ShieldCheck,
} as const;

const CERT_TONE = {
  valid: "ok",
  expiring: "warn",
  perennial: "forest",
} as const;

export function WorkerIdentitySection({
  worker,
  certs,
  now = new Date(),
}: WorkerIdentitySectionProps) {
  const t = useTranslations("workers");

  /** Resolve the localized cert badge label from the pure validity classification. */
  const certLabel = (v: ReturnType<typeof certValidity>) => {
    if (v.state === "perennial") return t("identity.certNoExpiry");
    if (v.state === "expiring") return t("identity.certExpiresIn", { n: v.days ?? 0 });
    return t("identity.certValid");
  };

  const facts: { label: string; value: string }[] = [
    { label: t("identity.factRole"), value: worker.role },
    {
      label: t("identity.factComarca"),
      value: worker.comarcaOrigin ?? "—",
    },
    {
      label: t("identity.factLanguages"),
      value: worker.languages.length ? worker.languages.join(", ") : "—",
    },
    {
      label: t("identity.factSince"),
      value: worker.startedYear ? String(worker.startedYear) : "—",
    },
    {
      label: t("identity.factDayRate"),
      value:
        worker.dailyRateUsd == null
          ? "—"
          : `$${worker.dailyRateUsd.toFixed(2)}`,
    },
  ];

  return (
    <DossierSection id="identity" title={t("identity.sectionTitle")}>
      <Card data-testid="worker-identity-card" className="animate-rise">
        <CardContent className="space-y-5">
          {/* Crew membership — the cross-entity link to /crew/[id]. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-fg">{t("identity.crewLabel")}</span>
            {worker.crewId ? (
              <EntityLink
                kind="crew"
                id={worker.crewId}
                name={worker.crewName ?? undefined}
                className="rounded-full"
              >
                <Badge tone="forest" dot>
                  {worker.crewName}
                </Badge>
              </EntityLink>
            ) : (
              <Badge tone="neutral">{worker.crewName}</Badge>
            )}
            {worker.rehireEligible && (
              <Badge tone="ok">{t("identity.rehireable")}</Badge>
            )}
          </div>

          {/* Identity facts grid. */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            {facts.map((f) => (
              <div key={f.label}>
                <dt className="text-xs text-muted-fg">{f.label}</dt>
                <dd className="mt-0.5 font-display text-sm font-semibold tabular-nums text-ink">
                  {f.value}
                </dd>
              </div>
            ))}
          </dl>

          {/* Certifications with validity state. */}
          <div className="border-t border-line pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-forest/70">
              {t("identity.currentCerts")}
            </p>
            {certs.length === 0 ? (
              <p className="flex items-center gap-1.5 text-sm text-muted-fg">
                <ShieldX className="h-4 w-4" aria-hidden />
                {t("identity.noCerts")}
              </p>
            ) : (
              <ul className="space-y-2" data-testid="worker-certs">
                {certs.map((c) => {
                  const v = certValidity(c.expiresAt, now);
                  const Icon = CERT_ICON[v.state];
                  return (
                    <li
                      key={`${c.certKind}-${c.issuedAt}`}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="flex items-center gap-2 text-sm text-ink">
                        <Icon
                          className="h-4 w-4 shrink-0 text-forest"
                          aria-hidden
                        />
                        <span className="font-medium">{c.certKind}</span>
                        {c.issuer && (
                          <span className="text-xs text-muted-fg">
                            · {c.issuer}
                          </span>
                        )}
                      </span>
                      <Badge tone={CERT_TONE[v.state]}>{certLabel(v)}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </DossierSection>
  );
}
