"use client";

import { useState } from "react";
import { HeartHandshake, IdCard } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type {
  AttendanceEvent,
  CrewRosterMember,
  PorObraContract,
  WorkerCert,
} from "@/lib/db/people";
import { RehireButton } from "./rehire-button";
import { WorkerProfileSheet } from "./worker-profile-sheet";
import { speaksNgabere } from "./labels";

/**
 * The per-worker profile bundle the strip opens in a sheet. The page resolves the
 * append-only ledgers (attendance timeline, por-obra history, valid certs) + the
 * verify_chain badge per worker and hands them in, so this island stays pure-client
 * over plain data (no fetching on the client).
 */
export interface CrewMemberProfile {
  attendance: AttendanceEvent[];
  contracts: PorObraContract[];
  certs: WorkerCert[];
  chainVerified: boolean;
}

export interface CrewRehireStripProps {
  /** Returning, rehire-eligible partners — the dignity moment's subjects. */
  members: CrewRosterMember[];
  /** Per-worker profile data, keyed by workerId (absent ⇒ empty ledgers). */
  profiles: Record<string, CrewMemberProfile>;
  /** The season being re-hired into, e.g. "2026-2027". */
  season: string;
  /** The rehire server action — passed by shape so this island never imports the route. */
  rehireAction: (fd: FormData) => Promise<unknown>;
  className?: string;
}

const EMPTY_PROFILE: CrewMemberProfile = {
  attendance: [],
  contracts: [],
  certs: [],
  chainVerified: true,
};

/**
 * CrewRehireStrip — the literal dignity moment. At season start the family sees last
 * season's returning Ngäbe-Buglé partners as named cards (not a free-text string),
 * each opening a profile sheet (append-only attendance + por-obra + cert ledgers,
 * chain-verified) and carrying a ONE-TAP REHIRE glass button that fires
 * `rehire_worker` — reactivating them into the new season's crew with their identity
 * + still-valid certs intact, never re-keying their history.
 */
export function CrewRehireStrip({
  members,
  profiles,
  season,
  rehireAction,
  className,
}: CrewRehireStripProps) {
  const [openWorker, setOpenWorker] = useState<string | null>(null);

  if (members.length === 0) return null;

  const active = members.find((m) => m.workerId === openWorker) ?? null;
  const activeProfile =
    (openWorker && profiles[openWorker]) || EMPTY_PROFILE;

  return (
    <Card className={cn("animate-rise overflow-hidden", className)}>
      <CardHeader>
        <div>
          <CardTitle>Returning partners</CardTitle>
          <CardDescription>
            Last season&rsquo;s crew — one tap to rehire, identity and certs carried forward
          </CardDescription>
        </div>
        <Badge tone="honey" dot>
          {members.length} eligible
        </Badge>
      </CardHeader>

      <CardContent>
        <div className="stagger perf-contain grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {members.map((member) => {
            const bilingual = speaksNgabere(member.languages);
            const certCount = (profiles[member.workerId]?.certs ?? []).length;
            return (
              <div
                key={member.workerId}
                className="glass-card glass-hover flex flex-col gap-3 rounded-2xl p-4"
              >
                <div className="flex items-start gap-3">
                  <Avatar name={member.name} size="md" />
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => setOpenWorker(member.workerId)}
                      className="rounded text-left font-display text-sm font-semibold text-ink transition-colors hover:text-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-300"
                    >
                      {member.preferredName || member.name}
                    </button>
                    <p className="mt-0.5 truncate text-xs text-muted-fg">
                      {member.role} · {member.crewName}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {member.comarcaOrigin && (
                    <Badge tone="forest">{member.comarcaOrigin}</Badge>
                  )}
                  {bilingual && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-fg">
                      es · ngäbere
                    </span>
                  )}
                  {certCount > 0 && (
                    <Badge tone="ok" dot>
                      {certCount} valid {certCount === 1 ? "cert" : "certs"}
                    </Badge>
                  )}
                </div>

                <div className="mt-auto flex items-center justify-between gap-2">
                  <Chip onClick={() => setOpenWorker(member.workerId)}>
                    <IdCard className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                    Profile
                  </Chip>
                  <RehireButton
                    workerId={member.workerId}
                    crewId={member.crewId ?? ""}
                    season={season}
                    action={rehireAction}
                    disabled={!member.rehireEligible}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>

      <Dialog
        open={active !== null}
        onClose={() => setOpenWorker(null)}
        title={active ? `${active.preferredName || active.name}` : "Worker"}
      >
        {active && (
          <WorkerProfileSheet
            name={active.name}
            preferredName={active.preferredName}
            role={active.role}
            comarcaOrigin={active.comarcaOrigin}
            languages={active.languages}
            attendance={activeProfile.attendance}
            contracts={activeProfile.contracts}
            certs={activeProfile.certs}
            chainVerified={activeProfile.chainVerified}
          />
        )}
      </Dialog>
    </Card>
  );
}
