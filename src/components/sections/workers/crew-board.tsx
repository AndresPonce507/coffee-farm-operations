import { Users } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { workers, CREWS } from "@/lib/data/workers";

/**
 * CrewBoard — at-a-glance roster of every field crew with today's presence.
 * Static, server-rendered: one sub-panel per crew, an overlapping avatar wrap,
 * and a present/total readout so the farm office can see who's on the ground.
 */
export function CrewBoard() {
  const crews = CREWS.map((crew) => {
    const members = workers.filter((w) => w.crew === crew);
    const present = members.filter((w) => w.attendance === "present").length;
    const total = members.length;
    const allIn = total > 0 && present === total;
    return { crew, members, present, total, allIn };
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
          {crews.length} crews
        </Badge>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {crews.map(({ crew, members, present, total, allIn }) => (
            <div
              key={crew}
              className="flex flex-col gap-4 rounded-xl border border-line bg-paper-2 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="font-display text-sm font-semibold text-ink">
                    {crew}
                  </h4>
                  <p className="mt-0.5 text-xs text-muted-fg">
                    {total} {total === 1 ? "member" : "members"}
                  </p>
                </div>
                <Badge tone={allIn ? "ok" : "warn"} dot>
                  {present}/{total} present
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
                          ? "ring-2 ring-card"
                          : "opacity-40 ring-2 ring-card"
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
                <span className="font-medium text-ink">{present}</span> on the
                ground today
                {present < total ? (
                  <span> · {total - present} off</span>
                ) : null}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
