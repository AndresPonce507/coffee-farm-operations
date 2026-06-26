# Slice 06 — PHI block visible on every plot surface

**Story:** US-06 · **Job:** J3 · **Release:** 3 · **Effort:** ≤1 day

## Learning hypothesis
Surfacing the same `phi_clears_on` the planner gate reads onto Map/Satellite/Scouting/plot-dossier
will make the existing fail-closed block feel legible in the field — validating J3 cross-tab guards
as *visible*, not just enforced.

## Thinnest end-to-end vertical
Read `v_plot_phi_status` → render a "PHI hasta <fecha>" badge on each plot surface, from the one
source that drives the gate.

## In scope
- PHI-until badge on Map, Satellite, Scouting, and `/plots/[id]`.
- The badge date == the planner gate boundary (single source); no badge on plots without sprays.

## Out of scope
- Changing the planner gate (already live). New spray write paths.

## Production-data AC
- [ ] A sprayed plot shows "PHI hasta <fecha>" on Map + plot dossier, == the gate boundary.
- [ ] A plot with no spray shows no PHI badge anywhere.
- [ ] Two sprays → the later clear date shows (max), matching the gate.
- [ ] Render test (badge date) + behavior test (date == gate; no-spray plot shows none).

## Dogfood moment
Inés glances at the Map and immediately sees which plots are still in a residue window.
