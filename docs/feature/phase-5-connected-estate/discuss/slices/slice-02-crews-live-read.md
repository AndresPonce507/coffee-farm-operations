# Slice 02 — Replace the CREWS mock with the live crews table

**Story:** US-02 · **Job:** J4 · **Release:** 1 · **Effort:** ≤0.5 day

## Learning hypothesis
The single mock-data leak in the UI is removable with a thin getter swap; doing it first proves the
"no mock data on prod paths" guardrail can hold at 0 and establishes the grep guard the rest of the
phase relies on.

## Thinnest end-to-end vertical
Add `getCrews()` over the live `crews` table → swap the two `@/lib/data/workers` `CREWS` imports
(worker-form.tsx, crew-board.tsx) → the dropdown + board reflect the real table.

## In scope
- `getCrews()` getter (live `crews`).
- Replace `CREWS` in `worker-form.tsx` + `crew-board.tsx`.
- A repo grep guard wired into `npm run test`: 0 non-test UI imports from `@/lib/data/`.

## Out of scope
- The `/crew/[id]` dossier (later slice). Crew CRUD changes.

## Production-data AC
- [ ] The crew dropdown lists exactly the crews in the live `crews` table.
- [ ] A crew added directly in the DB appears on next load.
- [ ] `grep "from '@/lib/data/'"` over non-test `src/` returns 0.
- [ ] Render test (board renders live crews) + behavior test (getter returns DB crews; DB-added crew surfaces).

## Dogfood moment
Andres adds "Sur-2" to the DB; it appears in the Workers UI without a code change.
