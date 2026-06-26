# Slice 01 — Weigh ripple proof (WALKING SKELETON)

**Story:** US-01 · **Job:** J1 · **Release:** Walking Skeleton · **Effort:** ≤1 day

## Learning hypothesis
If the existing reactive mechanism (`record_weigh_in` → `v_weigh_today_by_picker` +
`harvests`→`season_summary_view`) is surfaced as a visible "esto también actualizó…" proof on the
Weigh screen, the owner will *believe* the cockpit agrees with itself — validating that the J1
graph lands end-to-end and feels trustworthy **before** any tab-deepening investment.

## Thinnest end-to-end vertical
ONE weigh-in (via the live RPC) → TWO downstream consumers shown reactively (the Weigh per-picker
tally + the Dashboard "Today"/season headline) → the minted lot becomes one click from `/lots/[code]`.
Reuses everything that exists; adds only the proof panel + the lot link.

## In scope
- A reactive **proof panel** on the Weigh tab listing the consumers a capture just updated, each linked.
- Verify/ensure the Dashboard "Today"/season headline derives from `season_summary_view` (no `__deprecated` read).
- Make the minted lot in the proof panel link to `/lots/[code]`.

## Out of scope
- Building `/plots/[id]` / `/workers/[id]` (later slices). Other tabs' wiring. ⌘K palette.

## Production-data AC
- [ ] Capturing a real weigh-in (Lupita, Tizingal-Alto, 18.4 kg) makes the tally and Dashboard "Today" each rise by 18.4 kg with no re-entry.
- [ ] The proof panel names ≥2 consumers and links each (Dashboard, lot dossier).
- [ ] Offline capture → exactly-one ripple after replay.
- [ ] Render test (proof panel) + behavior test (ripple to 2 consumers; headline derives from harvests).

## Dogfood moment
Marcelino weighs the first picker of the morning; Don Ricardo, on the Dashboard, sees the number
move without touching another screen — and clicks through to the new lot.
