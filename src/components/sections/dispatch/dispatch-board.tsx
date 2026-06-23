import { CheckCircle2, Send, Sparkles, Users } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { EntityLink } from "@/components/ui/entity-link";
import { Tile } from "@/components/ui/tile";
import { getDispatchToday } from "@/lib/db/dispatch";
import { getCrewRoster } from "@/lib/db/people";
import { num } from "@/lib/utils";
import type { DispatchCard } from "@/lib/types";

import {
  generateDispatchAction,
  markDispatchSentAction,
} from "@/app/(app)/dispatch/actions";

import { DispatchCardPreview } from "./dispatch-card-preview";
import { DispatchShareButton } from "./dispatch-share-button";
import { GenerateDispatchButton } from "./generate-dispatch-button";

/**
 * DispatchBoard — the /dispatch morning board, the cockpit that turns the maturation
 * model into the picker's morning.
 *
 * Async Server Component: it joins the active per-crew dispatch (getDispatchToday →
 * v_dispatch_card) with the crew roster (getCrewRoster → v_crew_roster, for the crew
 * set + each crew's languages so the card goes bilingual). Every crew gets a column:
 *   • no dispatch yet → a "Generate dispatch" island (reads the S8 ripeness model);
 *   • a drafted dispatch → the world-class glass DispatchCardPreview + a one-tap
 *     web-share ($0) "Share" island (the OWNER-INITIATED outbound — nothing
 *     auto-sends; generation never sends).
 *
 * The write islands receive the route's Server Actions; the read is the SSOT (the
 * board never re-derives readiness — the run's assignments snapshot it).
 *
 * World-class: glass tiles + cards, a responsive grid that stacks on mobile, AA on
 * the paper canvas, bilingual field-facing copy, the only motion on the islands'
 * buttons (GPU transforms, reduced-motion safe).
 */

/** The morning this board dispatches — today (the manager's local date). A later
 *  slice can add a date picker; today is the 5:30am use-case the slice targets. */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The current season label — a Phase-2 config surface later; derived for now. */
function currentSeason(): string {
  return String(new Date().getFullYear());
}

/**
 * The readiness cut-off the board hands the generate island [0,1].
 *
 * COLD-MODEL SAFETY (D08-1): the island defaults this to 0.5, but generate_dispatch
 * fills the run from v_harvest_readiness, and on a cold S8 model (no GDD/bloom/NDVI
 * logged yet — the literal state at the start of every Volcán season and on a fresh
 * deploy) every plot scores readiness 0. A 0.5 cut-off then drafts an EMPTY card the
 * manager cannot recover from. The board therefore passes an EXPLICIT, lower,
 * cold-start-aware threshold so marginally-ready plots are surfaced for the manager
 * to review and share — unhardwiring the island's silent default rather than
 * relying on it. The draft is always reviewable + re-draftable before it is shared
 * (append-only; sharing stays a deliberate owner tap), so a more permissive draft
 * cut-off is safe.
 *
 * NOTE — this is the board's interim mitigation, NOT the full fix. It still cannot
 * surface a plot the model scored exactly 0; the real correction is a model-
 * independent manual write path (a build_manual_dispatch command RPC + a manual
 * plot-picker affordance), which spans the migration / Server Action / a client
 * island this board does not own. See findingsDeferred.
 */
const COLD_START_READINESS_THRESHOLD = 0.4;

interface CrewColumn {
  crewId: string;
  crewName: string;
  languages: string[];
  card: DispatchCard | null;
}

export async function DispatchBoard() {
  const [cards, roster] = await Promise.all([getDispatchToday(), getCrewRoster()]);

  // distinct crews from the roster, each with its (most common) language set so the
  // card renders bilingual when the crew speaks ngäbere.
  const byCrew = new Map<string, CrewColumn>();
  for (const m of roster) {
    if (!m.crewId) continue;
    const existing = byCrew.get(m.crewId);
    if (existing) {
      // union the languages across the crew's members (so any ngäbere speaker flips it).
      for (const l of m.languages) {
        if (!existing.languages.includes(l)) existing.languages.push(l);
      }
    } else {
      byCrew.set(m.crewId, {
        crewId: m.crewId,
        crewName: m.crewName,
        languages: [...m.languages],
        card: null,
      });
    }
  }
  // attach each crew's active dispatch card.
  for (const c of cards) {
    const col = byCrew.get(c.crewId);
    if (col) col.card = c;
  }

  const columns = [...byCrew.values()].sort((a, b) =>
    a.crewName.localeCompare(b.crewName),
  );

  const date = todayISO();
  const season = currentSeason();

  const draftedCount = columns.filter((c) => c.card && c.card.status === "draft").length;
  // "Shared" counts a run that is out to the crew lead (sent OR acknowledged — an
  // acknowledged run was necessarily shared first). "Acknowledged" is then surfaced
  // as its OWN tally below so the first-class 'acknowledged' run state the card is
  // already built to render (and getDispatchToday already maps) is no longer
  // invisible on the board — the manager can see a crew lead confirmed (D08-2).
  const sentCount = columns.filter(
    (c) => c.card && (c.card.status === "sent" || c.card.status === "acknowledged"),
  ).length;
  const acknowledgedCount = columns.filter(
    (c) => c.card && c.card.status === "acknowledged",
  ).length;

  return (
    <div className="space-y-6">
      {/* Headline strip */}
      <Card className="animate-rise overflow-hidden" data-testid="dispatch-summary">
        <CardContent className="p-0">
          <div className="stagger grid grid-cols-1 divide-y divide-white/50 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
            <div data-testid="dispatch-tile-crews">
              <Tile
                label="Crews"
                value={num(columns.length)}
                sub="to dispatch this morning"
                accent="forest"
                icon={Users}
                className="glass-hover"
              />
            </div>
            <div data-testid="dispatch-tile-drafted">
              <Tile
                label="Drafted"
                value={num(draftedCount)}
                sub="ready to share"
                accent="honey"
                icon={Sparkles}
                className="glass-hover"
              />
            </div>
            <div data-testid="dispatch-tile-shared">
              <Tile
                label="Shared"
                value={num(sentCount)}
                sub="out to the crew leads"
                accent="coffee"
                icon={Send}
                className="glass-hover"
              />
            </div>
            <div data-testid="dispatch-tile-acknowledged">
              <Tile
                label="Acknowledged"
                value={num(acknowledgedCount)}
                sub="crew lead confirmed"
                accent="forest"
                icon={CheckCircle2}
                className="glass-hover"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Per-crew columns */}
      {columns.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-fg">
            No crews on the roster yet — enroll a crew on the Crew page to dispatch.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
          {columns.map((col) => (
            <section
              key={col.crewId}
              aria-label={`Dispatch — ${col.crewName}`}
              className="space-y-3"
            >
              <header className="flex items-center justify-between gap-3">
                <EntityLink
                  kind="crew"
                  id={col.crewId}
                  name={col.crewId}
                  className="font-display text-sm font-semibold uppercase tracking-wide text-muted-fg underline-offset-2 outline-none transition-colors hover:text-forest hover:underline focus-visible:text-forest focus-visible:underline"
                >
                  {col.crewName}
                </EntityLink>
                <GenerateDispatchButton
                  crewId={col.crewId}
                  crewName={col.crewName}
                  dispatchDate={date}
                  season={season}
                  readinessThreshold={COLD_START_READINESS_THRESHOLD}
                  action={generateDispatchAction}
                  alreadyDrafted={col.card !== null}
                />
              </header>

              {col.card ? (
                <div className="space-y-3">
                  <EntityLink
                    kind="dispatch"
                    id={String(col.card.id)}
                    className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-forest/60"
                  >
                    <DispatchCardPreview card={col.card} languages={col.languages} />
                  </EntityLink>
                  <div className="flex justify-end">
                    <DispatchShareButton
                      card={col.card}
                      languages={col.languages}
                      markSentAction={markDispatchSentAction}
                    />
                  </div>
                </div>
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-sm text-muted-fg">
                    No dispatch yet — generate the ripeness-aware plan for{" "}
                    {col.crewName}.
                  </CardContent>
                </Card>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
