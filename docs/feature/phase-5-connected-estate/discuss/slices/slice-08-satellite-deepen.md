# Slice 08 — Deepen Satellite into a connected drill-in tab

**Story:** US-08 · **Job:** J4 · **Release:** 4 · **Effort:** ≤1 day · **Depends on:** slice-03 (/plots/[id])

## Learning hypothesis
The thinnest tab becomes connected by linking each vegetation card to the plot dossier and each PHI
chip to its spray — validating that the "every tab deep" half of the mandate is reachable by
connectivity, not by adding new data.

## Thinnest end-to-end vertical
Each vegetation card → `/plots/[id]#satellite`; each PHI chip → the spray that set it; a "scout this
plot" affordance → Scouting pre-filled.

## In scope
- Vegetation card → plot dossier (satellite section).
- PHI chip → originating spray record.
- "Scout this plot" → Scouting pre-filled with the plot.

## Out of scope
- New satellite data sources / imagery providers. The `/plots/[id]` dossier itself (slice-03).

## Production-data AC
- [ ] Each vegetation card links to `/plots/[id]`; each PHI chip links to its spray record.
- [ ] Satellite moves from "thin" to "deep" on a re-run of wire-up-audit.md (0 cosmetic-only entity controls).
- [ ] Render test (cards render with links) + behavior test (card routes to dossier; chip routes to spray).

## Dogfood moment
Inés clicks a low-confidence plot on Satellite and lands on its dossier to decide whether to scout it.
