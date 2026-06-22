import { Users } from "lucide-react";
import type { ReactNode } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EntityLink } from "@/components/ui/entity-link";
import { getWorkers } from "@/lib/db/workers";
import { getCrews } from "@/lib/db/people";

/**
 * CrewBoard — at-a-glance roster of every field crew with today's presence.
 *
 * Static, server-rendered: one sub-panel per crew, an overlapping avatar wrap,
 * and a present/total readout so the farm office can see who's on the ground.
 *
 * Phase 5 L3: crews are read LIVE via `getCrews()` (the mock-free replacement
 * for the hardcoded `CREWS` const), and each crew card is wrapped in an
 * `<EntityLink kind="crew">` to its `/crew/[id]` dossier (P6 connectivity) —
 * except crewId-less buckets, which can't resolve a dossier and stay inert.
 */
export async function CrewBoard() {
  const [crews, workers] = await Promise.all([getCrews(), getWorkers()]);

  // The avatar wrap needs each crew's members; match the live roster by name
  // (the workers getter is the avatar source — getCrews carries only counts).
  const cards = crews.map((crew) => {
    const members = workers.filter((w) => w.crew === crew.crewName);
    const allIn = crew.memberCount > 0 && crew.presentCount === crew.memberCount;
    return { ...crew, members, allIn };
  });

  return (
    <Card className="animate-rise overflow-hidden">
      <CardHeader>
        <div>
          <CardTitle>Crews</CardTitle>
          <CardDescription>
            Field teams and today&rsquo;s presence on the farm
          </CardDescription>
        </div>
        <Badge tone="forest" dot>
          {cards.length} crews
        </Badge>
      </CardHeader>

      <CardContent>
        <div className="stagger perf-contain grid grid-cols-1 gap-4 sm:grid-cols-2">
          {cards.map((card) => {
            const { crewId, crewName, members, presentCount, memberCount, allIn } =
              card;

            const inner = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="font-display text-sm font-semibold text-ink">
                      {crewName}
                    </h4>
                    <p className="mt-0.5 text-xs text-muted-fg">
                      {memberCount} {memberCount === 1 ? "member" : "members"}
                    </p>
                  </div>
                  <Badge tone={allIn ? "ok" : "warn"} dot>
                    {presentCount}/{memberCount} present
                  </Badge>
                </div>

                {members.length > 0 ? (
                  <div className="flex -space-x-2">
                    {members.map((member) => (
                      <Avatar
                        key={member.id}
                        name={member.name}
                        className={
                          member.attendance === "present"
                            ? "ring-2 ring-white/60"
                            : "opacity-40 ring-2 ring-white/60"
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-muted-fg">
                    <Users className="h-3.5 w-3.5" aria-hidden="true" />
                    No one assigned
                  </p>
                )}

                <p className="text-xs text-muted-fg">
                  <span className="font-medium text-ink">{presentCount}</span> on
                  the ground today
                  {presentCount < memberCount ? (
                    <span> · {memberCount - presentCount} off</span>
                  ) : null}
                </p>
              </>
            );

            const cardClass =
              "glass-card glass-hover flex flex-col gap-4 rounded-2xl p-4";

            // A crew with a real crewId drills into its /crew/[id] dossier; a
            // crewId-less bucket (legacy/unassigned) can't resolve a dossier, so
            // it renders inert rather than link to a 404.
            const key = crewId ?? `name:${crewName}`;

            return crewId ? (
              <EntityLink
                key={key}
                kind="crew"
                id={crewId}
                className={`${cardClass} transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper`}
              >
                {inner as ReactNode}
              </EntityLink>
            ) : (
              <div key={key} className={cardClass}>
                {inner}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
