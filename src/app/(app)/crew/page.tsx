import { PageHeader } from "@/components/ui/page-header";
import { CrewSummary } from "@/components/sections/crew/crew-summary";
import { CrewRosterBoard } from "@/components/sections/crew/crew-roster-board";
import {
  CrewRehireStrip,
  type CrewMemberProfile,
} from "@/components/sections/crew/crew-rehire-strip";
import {
  getCrewRoster,
  getWorkerAttendanceTimeline,
  getWorkerCertsValid,
  getWorkerPorObraHistory,
  verifyAttendanceChain,
} from "@/lib/db/people";
import type { WorkerCert } from "@/lib/db/people";
import { rehireWorkerAction } from "./actions";

/** The season being re-hired into — a Phase-2 config surface later; literal for now. */
const REHIRE_SEASON = "2026-2027";

/**
 * Crew — the "/crew" route for Coffee Farm Operations (P2-S1).
 *
 * The people system-of-record made visible: the flat `workers.crew` string is now
 * a real roster (`v_crew_roster`) of named, returning partners. A headline strip
 * (CrewSummary — crews / members / present today) sits above the glass roster board
 * (CrewRosterBoard) — crews as columns, each member a glass worker-card carrying
 * their comarca chip, valid-cert badges and an attendance dot. The dignity moment is
 * literal: a returning Ngäbe-Buglé picker is a remembered partner, not a free-text
 * string, and the one-tap rehire lives on their card (a follow-up wave wires the
 * profile sheet + rehire action into an interactive island).
 *
 * Server Component: all data flows from the `people` read ports (security_invoker
 * views governed by the authenticated-read RLS the S1 migration set). The append-only
 * attendance/por-obra/cert ledgers are the audit trail behind every figure; nothing
 * here re-implements a projection.
 */
export default async function CrewPage() {
  const roster = await getCrewRoster();

  // Per-worker valid certs, resolved in parallel and folded into a map the board
  // reads to render the cert badges (absent ⇒ no badges, degrades gracefully).
  const certPairs = await Promise.all(
    roster.map(async (m) => [m.workerId, await getWorkerCertsValid(m.workerId)] as const),
  );
  const certsByWorker: Record<string, WorkerCert[]> = Object.fromEntries(
    certPairs.filter(([, certs]) => certs.length > 0),
  );

  const crewCount = new Set(roster.map((m) => m.crewName)).size;
  const presentToday = roster.filter((m) => m.attendance === "present").length;

  // The dignity moment: rehire-eligible returning partners, each with their full
  // append-only ledgers + chain-verified badge resolved for the profile sheet.
  const eligible = roster.filter((m) => m.rehireEligible);
  const profileEntries = await Promise.all(
    eligible.map(async (m) => {
      const [attendance, contracts, certs, chainVerified] = await Promise.all([
        getWorkerAttendanceTimeline(m.workerId),
        getWorkerPorObraHistory(m.workerId),
        getWorkerCertsValid(m.workerId),
        verifyAttendanceChain(m.workerId),
      ]);
      return [
        m.workerId,
        { attendance, contracts, certs, chainVerified } satisfies CrewMemberProfile,
      ] as const;
    }),
  );
  const profiles: Record<string, CrewMemberProfile> =
    Object.fromEntries(profileEntries);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cuadrillas"
        subtitle="El sistema de registro de las personas — compañeros con nombre que regresan"
      />

      <CrewSummary
        crews={crewCount}
        members={roster.length}
        presentToday={presentToday}
      />

      <CrewRehireStrip
        members={eligible}
        profiles={profiles}
        season={REHIRE_SEASON}
        rehireAction={rehireWorkerAction}
      />

      <CrewRosterBoard members={roster} certsByWorker={certsByWorker} />
    </div>
  );
}
