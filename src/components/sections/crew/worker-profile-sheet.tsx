import {
  CalendarClock,
  FileSignature,
  Languages,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import type {
  AttendanceEvent,
  PorObraContract,
  WorkerCert,
} from "@/lib/db/people";
import { cn, longDate, usd } from "@/lib/utils";

import { EVENT_KIND_LABELS, bilingual, speaksNgabere } from "./labels";

/**
 * WorkerProfileSheet — the per-worker system-of-record panel.
 *
 * A standalone glass panel (the route may drop it inside the Dialog primitive,
 * or render it inline) that gathers the four ledgers behind one worker:
 *   • identity header (name / preferred name / comarca / languages)
 *   • the APPEND-ONLY attendance timeline (newest-first), and
 *   • the POR-OBRA contract history (superseded ones dimmed), and
 *   • the currently-valid CERT ledger,
 * topped by a CHAIN-VERIFIED badge sourced from `verify_chain` (reusing the
 * audit-drawer idiom). Pure presentation — every list is a plain prop; the thin
 * server wrapper resolves the people.ts getters and hands them down.
 */
export interface WorkerProfileSheetProps {
  /** Identity. */
  name: string;
  preferredName?: string | null;
  role?: string | null;
  comarcaOrigin?: string | null;
  languages?: string[];
  /** The append-only attendance timeline, newest-first (caller-ordered). */
  attendance: AttendanceEvent[];
  /** Por-obra (piece-rate) contract history, newest effective first. */
  contracts: PorObraContract[];
  /** Currently-valid certifications. */
  certs: WorkerCert[];
  /** verify_chain('attendance:<id>') result — drives the green/amber badge. */
  chainVerified: boolean;
  className?: string;
}

/** ISO/timestamptz → compact, locale-stable wall-clock (mirrors the audit drawer). */
function formatClock(value: string): string {
  const t = Date.parse(value);
  if (Number.isNaN(t)) return value;
  return new Date(t).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Attendance-event kind → badge tone. */
function eventTone(kind: string): "ok" | "warn" | "neutral" | "sky" {
  switch (kind) {
    case "clock-in":
      return "ok";
    case "clock-out":
      return "sky";
    case "rest-day":
      return "warn";
    default:
      return "neutral";
  }
}

/** Section heading shared across the panel's four ledgers. */
function SectionTitle({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-fg">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {children}
    </h3>
  );
}

export function WorkerProfileSheet({
  name,
  preferredName,
  role,
  comarcaOrigin,
  languages = [],
  attendance,
  contracts,
  certs,
  chainVerified,
  className,
}: WorkerProfileSheetProps) {
  const t = useTranslations("crew");
  const ngabere = speaksNgabere(languages);
  const VerifyIcon = chainVerified ? ShieldCheck : ShieldAlert;

  return (
    <div
      data-testid="worker-profile-sheet"
      className={cn("animate-rise flex flex-col gap-6", className)}
    >
      {/* ── Identity header ─────────────────────────────────────────────── */}
      <header className="flex items-start gap-4">
        <Avatar name={name} size="md" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-lg font-semibold text-ink">
            {preferredName?.trim() || name}
          </h2>
          {preferredName?.trim() && preferredName.trim() !== name ? (
            <p className="truncate text-xs text-muted-fg">{name}</p>
          ) : null}
          {role ? (
            <p className="mt-0.5 truncate text-sm text-muted-fg">{role}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {comarcaOrigin ? (
              <span className="inline-flex items-center rounded-full bg-coffee-200/50 px-2 py-0.5 text-[11px] font-medium text-coffee ring-1 ring-coffee/15">
                {comarcaOrigin}
              </span>
            ) : null}
            {ngabere ? (
              <span
                // bg-muted/text-muted-fg (5.14:1) — clears WCAG-AA for 11px
                // normal text and mirrors the chip in crew-roster-board.tsx.
                // The prior bg-sky-100/text-sky pair measured only 4.11:1 (AA fail).
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-fg ring-1 ring-line"
              >
                <Languages className="h-3 w-3" aria-hidden="true" />
                es · ngäbere
              </span>
            ) : languages.length > 0 ? (
              <span className="text-[11px] text-muted-fg">
                {languages.join(" · ")}
              </span>
            ) : null}
          </div>
        </div>
        {/* Chain-verified verdict — green when verify_chain reconciles. */}
        <div data-testid="chain-badge" className="shrink-0">
          <Badge tone={chainVerified ? "forest" : "honey"} className="gap-1.5">
            <VerifyIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {chainVerified
              ? t("workerProfileSheet.chainVerified")
              : t("workerProfileSheet.chainUnverified")}
          </Badge>
        </div>
      </header>

      {/* ── Attendance timeline (append-only, newest-first) ─────────────── */}
      <section className="space-y-2.5">
        <SectionTitle icon={CalendarClock}>
          {t("workerProfileSheet.attendanceTimeline")}
        </SectionTitle>
        {attendance.length === 0 ? (
          <p className="rounded-xl bg-card px-3 py-3 text-xs text-muted-fg ring-1 ring-black/5">
            {t("workerProfileSheet.noAttendance")}
          </p>
        ) : (
          <ol className="space-y-2" data-testid="attendance-timeline">
            {attendance.map((evt) => (
              <li
                key={evt.eventUid}
                className="flex items-center justify-between gap-2 rounded-xl bg-card px-3 py-2 ring-1 ring-black/5"
              >
                <Badge tone={eventTone(evt.eventKind)} dot className="capitalize">
                  {bilingual(
                    EVENT_KIND_LABELS[evt.eventKind],
                    languages,
                    evt.eventKind,
                  )}
                </Badge>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-fg">
                  {formatClock(evt.occurredAt)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ── Por-obra contract history (superseded ones dimmed) ──────────── */}
      <section className="space-y-2.5">
        <SectionTitle icon={FileSignature}>
          {t("workerProfileSheet.porObraContracts")}
        </SectionTitle>
        {contracts.length === 0 ? (
          <p className="rounded-xl bg-card px-3 py-3 text-xs text-muted-fg ring-1 ring-black/5">
            {t("workerProfileSheet.noContracts")}
          </p>
        ) : (
          <ul className="space-y-2" data-testid="por-obra-history">
            {contracts.map((c) => {
              const superseded = c.supersededBy != null;
              return (
                <li
                  key={c.id}
                  data-superseded={superseded}
                  className={cn(
                    "rounded-xl bg-card px-3 py-2 ring-1 ring-black/5",
                    superseded && "opacity-55",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-ink">
                      {c.taskKind}
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                      {usd(c.rateUsd, 2)}
                      <span className="ml-1 text-[11px] font-normal text-muted-fg">
                        / {c.rateBasis}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-fg">
                      {longDate(c.effectiveFrom)}
                      {c.effectiveTo
                        ? ` → ${longDate(c.effectiveTo)}`
                        : ` → ${t("workerProfileSheet.current")}`}
                    </span>
                    {superseded ? (
                      <Badge tone="neutral">
                        {t("workerProfileSheet.superseded")}
                      </Badge>
                    ) : (
                      <Badge tone="ok" dot>
                        {t("workerProfileSheet.active")}
                      </Badge>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Cert ledger (currently-valid only) ──────────────────────────── */}
      <section className="space-y-2.5">
        <SectionTitle icon={ShieldCheck}>
          {t("workerProfileSheet.certifications")}
        </SectionTitle>
        {certs.length === 0 ? (
          <EmptyState
            title={t("workerProfileSheet.noCertsTitle")}
            description={t("workerProfileSheet.noCertsDescription")}
            className="py-6"
          />
        ) : (
          <div className="flex flex-wrap gap-1.5" data-testid="cert-ledger">
            {certs.map((cert) => (
              <Badge
                key={`${cert.certKind}-${cert.issuedAt}`}
                tone="forest"
                className="gap-1"
              >
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                {cert.certKind}
                {cert.expiresAt ? (
                  <span className="font-normal opacity-70">
                    {t("workerProfileSheet.certTo", {
                      date: longDate(cert.expiresAt),
                    })}
                  </span>
                ) : null}
              </Badge>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
