import { ShieldCheck } from "lucide-react";

import { DossierSection } from "@/components/dossier/dossier-section";
import { EntityLink } from "@/components/ui/entity-link";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { CrewRosterMember } from "@/lib/db/people";

/**
 * CrewRosterSection — the crew dossier's roster section.
 *
 * Pure presentational Server Component (no fetch, no hooks). Receives the crew's
 * roster members and renders each as a glass card whose NAME is an
 * `<EntityLink kind="worker">` to that member's /workers/[id] dossier (P6 — the
 * connectivity mechanism inside a dossier). Attendance state is carried by a
 * text label, never colour alone (WCAG-AA on the cream aurora). Wraps its body in
 * `<DossierSection id="roster">` so /crew/[id]#roster deep-links here.
 */
export function CrewRosterSection({
  members,
}: {
  members: CrewRosterMember[];
}) {
  const present = members.filter((m) => m.attendance === "present").length;

  return (
    <DossierSection
      id="roster"
      title="Cuadrilla"
      count={members.length}
      empty={members.length === 0}
      emptyLabel="Sin integrantes en esta cuadrilla todavía"
    >
      <p className="mb-3 text-sm text-muted-fg">
        {present} de {members.length} presentes hoy
      </p>
      <ul role="list" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {members.map((member) => (
          <li key={member.workerId}>
            <EntityLink
              kind="worker"
              id={member.workerId}
              className="glass-card glass-hover flex items-center gap-3 rounded-2xl p-3.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
            >
              <Avatar
                name={member.name}
                size="md"
                className={member.attendance === "present" ? "" : "opacity-50"}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-sm font-semibold text-ink">
                  {member.preferredName?.trim() || member.name}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-fg">
                  {member.role}
                </p>
              </div>
              {member.attendance === "present" ? (
                <Badge tone="ok" dot className="shrink-0">
                  Presente
                </Badge>
              ) : member.attendance === "rest-day" ? (
                <Badge tone="warn" dot className="shrink-0">
                  Descanso
                </Badge>
              ) : (
                <Badge tone="neutral" dot className="shrink-0">
                  Ausente
                </Badge>
              )}
              {member.rehireEligible ? (
                <ShieldCheck
                  className="h-4 w-4 shrink-0 text-forest"
                  aria-label="Elegible para recontratar"
                />
              ) : null}
            </EntityLink>
          </li>
        ))}
      </ul>
    </DossierSection>
  );
}
