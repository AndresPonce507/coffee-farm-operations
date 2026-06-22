import { cache } from "react";

import { getDispatchRunById } from "@/lib/db/dispatch";
import { getCrewById } from "@/lib/db/people";
import type { CrewRosterMember } from "@/lib/db/people";
import type { DispatchCard } from "@/lib/types";

/* ====================================================================== */
/* Phase 5 · R4 — the /dispatch/[id] DOSSIER read-port.                    */
/*                                                                          */
/* This dossier-scoped module composes ALREADY-LIVE getters into the one    */
/* anchor read the /dispatch/[id] page needs — it adds NO new view, table,  */
/* or write path (honors the $0 / no-schema-churn posture). It is file-     */
/* disjoint from the shared src/lib/db/dispatch.ts (which it imports read-   */
/* only): the parallel dossier fleet each owns its own src/lib/db/dossier/*  */
/* file so 50 agents never collide on a shared getter file.                 */
/*                                                                          */
/* Why compose: the dispatch run (v_dispatch_card) names the crew by id +   */
/* name, but the field-facing card goes BILINGUAL (es · ngäbere) off the    */
/* crew's `languages`, and the dossier links each assigned worker to a       */
/* /workers/[id] dossier — neither lives on the run row. So we enrich the    */
/* run with its crew roster (members → worker links) + languages (bilingual  */
/* copy). The crew may be absent (a legacy run whose crew left the roster);  */
/* the dossier still renders the run, just without roster enrichment.        */
/* ====================================================================== */

/** The /dispatch/[id] anchor: a dispatch run plus the crew context the dossier
 *  needs (roster members → worker links, languages → bilingual field copy). The
 *  crew fields are nullable: a run can outlive its crew's roster presence, and the
 *  run itself is still a real, renderable dossier. */
export interface DispatchRunDossier {
  /** The dispatch run header + its plot lines (already display-sorted). */
  run: DispatchCard;
  /** The assigned crew's roster members (each → a /workers/[id] dossier), or
   *  empty when the crew is no longer on the roster. */
  crewMembers: CrewRosterMember[];
  /** The crew's languages — drives the bilingual (es · ngäbere) card copy. Empty
   *  when the crew isn't on the roster. */
  crewLanguages: string[];
}

/**
 * THE dispatch-run dossier anchor read (Phase 5 R4). Resolves ONE run by its
 * public numeric handle (`v_dispatch_card.id`, NOT idempotency_key) — the route
 * param arrives as a string, so the underlying getter coerces it and returns null
 * for a non-numeric / unknown id (the page calls notFound() — no fabricated run).
 *
 * On a hit it enriches the run with its crew's roster (member worker-links +
 * languages) by composing the live `getCrewById`. The crew lookup never fails the
 * dossier: an absent crew (a run that outlived its crew's roster row) yields empty
 * members/languages, and the run still renders. Read-only; both composed getters
 * are React-`cache()`'d so the enrichment dedupes within the request.
 */
export const getDispatchRunDossier = cache(
  async (id: string | number): Promise<DispatchRunDossier | null> => {
    const run = await getDispatchRunById(id);
    if (!run) return null;

    const crew = await getCrewById(run.crewId);

    return {
      run,
      crewMembers: crew?.members ?? [],
      crewLanguages: dedupeLanguages(crew?.members ?? []),
    };
  },
);

/** Union of every roster member's languages, de-duplicated, order-stable — the
 *  crew-level language set the bilingual card renders against. */
function dedupeLanguages(members: CrewRosterMember[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of members) {
    for (const lang of m.languages) {
      if (!seen.has(lang)) {
        seen.add(lang);
        out.push(lang);
      }
    }
  }
  return out;
}

/** Re-export the underlying run getter so the dossier surface has a single import
 *  home (the page/sections import only from this dossier-scoped module). */
export { getDispatchRunById };
