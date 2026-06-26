# Slice 03 — The /plots/[id] dossier + kill the DEAD Map click

**Story:** US-03 · **Job:** J2 · **Release:** 2 · **Effort:** ≤1 day

## Learning hypothesis
Building the plot dossier on the proven lot-dossier pattern and routing the Map polygon to it will
turn the clearest dead-end (a pointer cursor that goes nowhere) into the J2 "whole story in one
place" payoff — validating that entity-row→dossier wiring is cheap and high-trust.

## Thinnest end-to-end vertical
`/plots/[id]` Server Component aggregates the plot's harvests + PHI + vegetation + cost + EUDR origin
(all live getters) → the Map polygon click navigates to it → unknown id 404s.

## In scope
- `/plots/[id]` dossier (harvests, `v_plot_phi_status`, vegetation, cost, EUDR origin).
- Map polygon `onClick` → `/plots/[id]` (remove the DEAD click).
- Link plot rows on Plots + Dashboard plot-health to the dossier.

## Out of scope
- Satellite/EUDR-origin plot links (slice 08 / a follow-up). ⌘K. Worker/crew dossiers.

## Production-data AC
- [ ] `/plots/tizingal-alto` renders its harvests, PHI-until, vegetation, cost, EUDR status from live data.
- [ ] Clicking the plot on the Map lands on the dossier (no more dead click).
- [ ] `/plots/ghost-plot` → 404 (no fabricated story).
- [ ] Render test (dossier sections) + behavior test (Map click routes; unknown id 404s).

## Dogfood moment
Inés clicks Tizingal-Alto on the Map and reads its whole story — harvests, an active PHI, cost — on one screen.
