# Outcome KPIs — Phase 5 "Connected Estate"

## Feature: phase-5-connected-estate

### Objective
By the end of Phase 5, the estate cockpit is a connected instrument: one field fact ripples
trustably to every downstream number (J1), any named entity opens its whole story in one place
(J2), cross-tab guards stop mistakes everywhere they matter (J3), and **every tab is deep and
every click is wired** (J4) — no dead UI, no mock data.

### Outcome KPIs

| # | Who | Does What | By How Much | Baseline | Measured By | Type |
|---|-----|-----------|-------------|----------|-------------|------|
| 1 | every clickable element (17 tabs) | is wired to real data or a real action | 100% wired | ~80% (1 DEAD, 6 mock, ~88 cosmetic-only entity controls) | re-run wire-up-audit.md element census | Leading |
| 2 | prod read paths | read live data, not mock | 0 mock-data reads | 1 (CREWS in 2 Workers files) | `grep "from '@/lib/data/'"` over non-test `src/` | Leading |
| 3 | dead clicks | any pointer affordance with no destination | 0 | 1 (Map polygon) | audit element census | Leading (guardrail) |
| 4 | entity dossiers | are reachable without typing a URL | 100% reachable from nav/⌘K/row-link | 0% (orphans) | audit reachability check | Leading |
| 5 | a dossier | surfaces cross-entity links to its connected entities | avg ≥4 links/dossier | n/a (no dossiers wired) | count links on /lots,/plots,/workers,/crew dossiers | Leading |
| 6 | the tabs | are "deep" vs "stub/thin" on the audit | 17/17 deep | 13 deep · 3 partial · 1 thin | re-run wire-up-audit.md depth scorecard | Leading |
| 7 | the owner | trusts the morning Dashboard headline without re-keying | hand-reconciliation of the daily total → 0/week | daily | dogfood observation + provenance shown | Leading (north-star) |
| 8 | unsafe picks | are schedulable inside an active PHI window | 0 | 0 already at planner; ≥4 surfaces now show it | PHI surfaced-count + gate test | Leading (guardrail) |

### Metric Hierarchy
- **North Star:** % of clickable elements wired to data/action across all 17 tabs → **100%** (KPI 1).
  This single ratio operationalizes Andres's "no dead UI — wire everything" mandate.
- **Leading indicators:** dossier reachability (KPI 4), avg cross-entity links per dossier (KPI 5),
  tabs-deep count (KPI 6) — these predict the north star and the J2/J4 outcome.
- **Guardrail metrics (must NOT degrade):** mock-data reads = 0 (KPI 2), dead clicks = 0 (KPI 3),
  unsafe picks schedulable = 0 (KPI 8), test suite green + `npm run build` green (repo gate).

### Measurement Plan
| KPI | Data Source | Collection Method | Frequency | Owner |
|-----|------------|-------------------|-----------|-------|
| 1, 6 | wire-up-audit.md | re-run the element/depth census after each release | per release | product-owner |
| 2 | source grep | `grep "from '@/lib/data/'" src` excluding tests | per PR (guard) | software-crafter |
| 3, 4, 5 | audit reachability/link census | manual + a static link-check script | per release | product-owner |
| 7 | dogfood | observe owner's morning routine; provenance "derived from N harvests" | weekly | owner (Andres) |
| 8 | PHI surfaced-count + planner gate test | count surfaces + run the fail-closed test | per release | acceptance-designer |

### Hypothesis
We believe that **wiring every control to real data/action and giving every entity a reachable
dossier** for **the owner, agronomist, and crew-lead** will achieve **a cockpit they trust end to
end**. We will know this is true when **every clickable element is wired (100%), every dossier is
reachable, and the owner stops hand-reconciling the daily total**.

## Handoff to DEVOPS (platform-architect)
- **Instrument:** the wire-up audit element census as a repeatable script (the north-star metric).
- **Guards (CI-free repo → local guards):** the `@/lib/data/` grep guard, a dead-click/link static
  check, the PHI fail-closed test — wire these into the local `npm run test` gate (no GitHub Actions).
- **Baselines to capture:** the current audit counts (this file's Baseline column) before R1 lands.
