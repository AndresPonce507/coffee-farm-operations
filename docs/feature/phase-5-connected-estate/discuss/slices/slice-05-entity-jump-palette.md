# Slice 05 — ⌘K entity jump to the lineage/ferment/cupping dossiers

**Story:** US-05 · **Job:** J2 · **Release:** 2 · **Effort:** ≤1 day

## Learning hypothesis
The deep dossiers already exist but are orphans; a ⌘K entity jump will make built value findable in
two keystrokes — validating that the connectivity gap (not the dossier depth) was the real problem.

## Thinnest end-to-end vertical
A ⌘K palette resolves a typed lot/batch/cup code → routes to the existing dossier; unknown → no result.

## In scope
- ⌘K command palette routing lot → `/lots/[code]`, batch → `/ferment/[batch]`, green lot → `/qc/cup/[lot]`.
- "Sin resultados" for unknown codes; direct nav to unknown still 404s.

## Out of scope
- Rebuilding any dossier. Full fuzzy search across all entities (codes-only is enough for the slice).

## Production-data AC
- [ ] Entering "JC-712" opens /lots/JC-712 with its full lineage.
- [ ] A ferment batch id → /ferment/[batch]; a green lot → /qc/cup/[lot].
- [ ] "JC-999" (no such lot) → no result; no fabricated dossier.
- [ ] Render test (palette) + behavior test (known code routes; unknown shows no result).

## Dogfood moment
A buyer asks about lot JC-712; Andres hits ⌘K, types it, and shows the dossier on the spot.
