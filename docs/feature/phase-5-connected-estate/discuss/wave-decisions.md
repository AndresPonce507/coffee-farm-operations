# Wave Decisions — phase-5-connected-estate (DISCUSS)

## Scope Assessment: borderline-oversized → SPLIT into 4 outcome releases (user-approval requested)
- Signals: touches all 17 tabs + >3 bounded contexts (spine, people, QC, IPM, costing, EUDR) +
  walking skeleton uses the existing reactive mechanism (so its integration points are LOW), but the
  full mandate ("every tab deeper + every click wired") is multi-week.
- Resolution: split by **outcome** into Walking Skeleton + Release 1 (J1 spine wiring) + Release 2
  (J2 dossiers) + Release 3 (J3 guards) + Release 4 (depth). Each release ships demonstrable value and
  each slice is ≤1 day. The 8 stories are right-sized (3 scenarios each). **Open question for Andres:
  confirm the 4-release split + sequence (see feature-delta "Open Questions").**

## DIVERGE artifacts
- ABSENT — no `docs/feature/phase-5-connected-estate/diverge/recommendation.md` or `job-analysis.md`.
  **Risk:** the job statement + ODI outcomes were authored here in DISCUSS (greenfield-nWave bootstrap)
  rather than validated upstream in DIVERGE. Mitigation: jobs.yaml is grounded in the real code + the
  explicit mandate; DESIGN should sanity-check J-priorities against Andres before building.

## Greenfield-nWave bootstrap
- Created SSOT: `docs/product/jobs.yaml` (J1-J4), `docs/product/personas/{owner,agronomist,crew-lead,picker}.yaml`.
  Journey lives at `discuss/journey-connected-estate.yaml` (the `journeys/connected-estate.yaml` SSOT
  slot is satisfied by this DISCUSS journey; DESIGN may promote it).

## Key decisions
1. **J1 + J4 co-primary; depth lands WITH wiring per slice** (mandate). No "wire now, deepen later".
2. **The mandate gap is connectivity, not data** (audit finding): the app is already deeply wired for
   writes; the work is dossiers + entity-row links + killing the 1 DEAD click + the 1 mock leak.
3. **Reuse the existing reactive spine** — the walking skeleton adds a proof panel + a link, not new
   propagation. All writes stay on the live SECURITY-DEFINER RPCs.
4. **Audit calibration:** prop-less Server Component wrappers that fetch live getters = WIRED, not MOCK.
   The single mock-leak test is the `@/lib/data/` grep (1 source: CREWS).
5. **CI-free repo** → KPI guards (the grep guard, dead-click check, PHI fail-closed test) wire into the
   local `npm run test` gate, not GitHub Actions (per repo CLAUDE.md).

## Stale-doc flags (out of scope to fix, flagged per CLAUDE.md "flag don't fix")
- `HANDOFF.md` describes the abandoned 6-route mock-only phase-1 state — stale; the app is now ~20
  routes on Supabase. **Flag only.**
- `src/app/(app)/page.tsx` line 18 comment "every section reads from canonical mock data" is FALSE.
  Fixing it is folded into US-01's Dashboard work.
