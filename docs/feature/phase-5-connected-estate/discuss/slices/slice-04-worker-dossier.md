# Slice 04 — The /workers/[id] dossier

**Story:** US-04 · **Job:** J2 · **Release:** 2 · **Effort:** ≤1 day

## Learning hypothesis
A worker dossier that joins attendance + kg + por-obra pay + crew + certs in one view will let the
owner settle a pay question from one screen — validating J2 for the people side of the estate.

## Thinnest end-to-end vertical
`/workers/[id]` aggregates the live people/weigh spine → picker rows on Harvests + Workers + QC link to it.

## In scope
- `/workers/[id]` (attendance_event, weigh tally, `v_active_por_obra`, crew, certifications).
- Link worker rows on Harvests top-pickers, Workers roster, QC cup-to-cause.

## Out of scope
- The `/crew/[id]` dossier (follow-up). Payroll editing.

## Production-data AC
- [ ] `/workers/lupita` shows her attendance, kg, pay, crew, certs from live data.
- [ ] Worker rows on Harvests/Workers/QC link to the dossier.
- [ ] `/workers/ghost` → 404.
- [ ] Render test + behavior test (row routes; data live; unknown id 404s).

## Dogfood moment
Andres clicks a top picker and reads her week — attendance, kg, what she's owed — in one place.
