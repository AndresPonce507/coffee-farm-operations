import { Languages, ShieldCheck, Users } from "lucide-react";
import { useTranslations } from "next-intl";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { EntityLink } from "@/components/ui/entity-link";
import type { CrewRosterMember, WorkerCert } from "@/lib/db/people";
import { cn } from "@/lib/utils";

import { ATTENDANCE_LABELS, bilingual, speaksNgabere } from "./labels";

/**
 * CrewRosterBoard — the P2-S1 centerpiece.
 *
 * Crews as COLUMNS; each member a glass worker-card carrying their Avatar, name
 * (preferred name surfaced when present), a COMARCA chip for those of indigenous
 * origin, the count of currently-VALID certs, a bilingual "es · ngäbere"
 * language chip for ngäbere speakers, and an ATTENDANCE dot (present = green ok,
 * rest-day = amber warn, absent = muted neutral). The dot's STATE is carried by
 * an icon-free text label too, never colour alone — WCAG-AA on glass.
 *
 * Pure presentation: `members` (the v_crew_roster projection) and an optional
 * `certsByWorker` map are handed in by a thin server wrapper — this component
 * never fetches. Cards present a draggable AFFORDANCE (glass-hover lift) so the
 * board reads as re-arrangeable, but no real drag-and-drop is wired (see the
 * follow-up note). Motion is GPU-only (transform/opacity via the shared glass
 * classes) and the global `prefers-reduced-motion` rule neutralises it.
 */
export interface CrewRosterBoardProps {
  /** Every crew member, the v_crew_roster projection. Grouped by crewName here. */
  members: CrewRosterMember[];
  /** Per-worker currently-valid certs, keyed by workerId. Absent ⇒ none known. */
  certsByWorker?: Record<string, WorkerCert[]>;
  className?: string;
}

type Translator = ReturnType<typeof useTranslations>;

/** Attendance → badge tone + a colour-independent label. */
function attendanceMeta(
  attendance: string,
  t: Translator,
): {
  tone: "ok" | "warn" | "neutral";
  short: string;
} {
  switch (attendance) {
    case "present":
      return { tone: "ok", short: t("rosterBoard.attendancePresent") };
    case "rest-day":
      return { tone: "warn", short: t("rosterBoard.attendanceRestDay") };
    default:
      return { tone: "neutral", short: t("rosterBoard.attendanceAbsent") };
  }
}

/** Stable, deterministic grouping of members into crew columns (insertion order). */
function groupByCrew(
  members: CrewRosterMember[],
): { crewName: string; crewId: string | null; members: CrewRosterMember[] }[] {
  const order: string[] = [];
  const byCrew = new Map<string, { crewId: string | null; members: CrewRosterMember[] }>();
  for (const m of members) {
    if (!byCrew.has(m.crewName)) {
      byCrew.set(m.crewName, { crewId: m.crewId ?? null, members: [] });
      order.push(m.crewName);
    }
    byCrew.get(m.crewName)!.members.push(m);
  }
  return order.map((crewName) => ({
    crewName,
    crewId: byCrew.get(crewName)!.crewId,
    members: byCrew.get(crewName)!.members,
  }));
}

/** One member's glass worker-card — the liftable, board-ready unit. */
function WorkerCard({
  member,
  certs,
  t,
}: {
  member: CrewRosterMember;
  certs: WorkerCert[];
  t: Translator;
}) {
  const att = attendanceMeta(member.attendance, t);
  const ngabere = speaksNgabere(member.languages);
  const attendanceText = bilingual(
    ATTENDANCE_LABELS[member.attendance],
    member.languages,
    att.short,
  );
  const validCerts = certs.length;

  return (
    <article
      data-testid={`worker-card-${member.workerId}`}
      data-attendance={member.attendance}
      className={cn(
        "glass-card glass-hover group relative flex flex-col gap-3 rounded-2xl p-3.5",
        // A draggable AFFORDANCE only — the grab cursor + lift hint that these
        // cards re-arrange. Real DnD is a deliberate follow-up (see report).
        "cursor-grab active:cursor-grabbing",
      )}
    >
      <div className="flex items-start gap-3">
        <EntityLink kind="worker" id={member.workerId} name={member.preferredName?.trim() || member.name} className="flex min-w-0 flex-1 items-start gap-3">
          <Avatar
            name={member.name}
            size="md"
            className={member.attendance === "present" ? "" : "opacity-50"}
          />
          <div className="min-w-0 flex-1">
            <h4 className="truncate font-display text-sm font-semibold text-ink">
              {member.preferredName?.trim() || member.name}
            </h4>
            <p className="mt-0.5 truncate text-xs text-muted-fg">{member.role}</p>
          </div>
        </EntityLink>
        {/* Attendance dot — colour AND a text label so state survives mono. */}
        <Badge tone={att.tone} dot className="shrink-0 capitalize">
          {attendanceText}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {member.comarcaOrigin ? (
          <span
            data-testid={`comarca-${member.workerId}`}
            className="inline-flex items-center gap-1 rounded-full bg-coffee-200/50 px-2 py-0.5 text-[11px] font-medium text-coffee ring-1 ring-coffee/15"
          >
            {member.comarcaOrigin}
          </span>
        ) : null}

        {ngabere ? (
          <span
            data-testid={`lang-${member.workerId}`}
            // bg-muted/text-muted-fg (5.14:1) — clears WCAG-AA for 11px normal
            // text and mirrors the sibling chip in crew-rehire-strip.tsx. The
            // prior bg-sky-100/text-sky pair measured only 4.11:1 (AA fail).
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-fg ring-1 ring-line"
          >
            <Languages className="h-3 w-3" aria-hidden="true" />
            es · ngäbere
          </span>
        ) : null}

        {validCerts > 0 ? (
          <Badge tone="forest" className="gap-1">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            {validCerts === 1
              ? t("rosterBoard.certCountOne", { count: validCerts })
              : t("rosterBoard.certCountOther", { count: validCerts })}
          </Badge>
        ) : null}
      </div>
    </article>
  );
}

export function CrewRosterBoard({
  members,
  certsByWorker = {},
  className,
}: CrewRosterBoardProps) {
  const t = useTranslations("crew");
  const columns = groupByCrew(members);
  const totalPresent = members.filter((m) => m.attendance === "present").length;

  return (
    <Card className={cn("animate-rise overflow-hidden", className)}>
      <CardHeader>
        <div>
          <CardTitle>{t("rosterBoard.title")}</CardTitle>
          <CardDescription>
            {t("rosterBoard.description", {
              present: totalPresent,
              total: members.length,
            })}
          </CardDescription>
        </div>
        <Badge tone="forest" dot>
          {columns.length === 1
            ? t("rosterBoard.crewCountOne", { count: columns.length })
            : t("rosterBoard.crewCountOther", { count: columns.length })}
        </Badge>
      </CardHeader>

      <CardContent>
        {columns.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t("rosterBoard.emptyTitle")}
            description={t("rosterBoard.emptyDescription")}
          />
        ) : (
          <div
            role="list"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
          >
            {columns.map((column) => {
              const present = column.members.filter(
                (m) => m.attendance === "present",
              ).length;
              const total = column.members.length;
              return (
                <section
                  key={column.crewName}
                  role="listitem"
                  aria-label={t("rosterBoard.crewLabel", { crew: column.crewName })}
                  className="glass-card flex flex-col gap-3 rounded-2xl p-3"
                >
                  <header className="flex items-center justify-between gap-2 px-1">
                    {column.crewId ? (
                      <EntityLink kind="crew" id={column.crewId} name={column.crewName}>
                        <h3 className="font-display text-sm font-semibold text-ink">
                          {column.crewName}
                        </h3>
                      </EntityLink>
                    ) : (
                      <h3 className="font-display text-sm font-semibold text-ink">
                        {column.crewName}
                      </h3>
                    )}
                    <Badge tone={present === total ? "ok" : "warn"} dot>
                      {t("rosterBoard.presentOfTotal", { present, total })}
                    </Badge>
                  </header>

                  <div className="stagger perf-contain flex flex-col gap-2.5">
                    {column.members.map((member) => (
                      <WorkerCard
                        key={member.workerId}
                        member={member}
                        certs={certsByWorker[member.workerId] ?? []}
                        t={t}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
