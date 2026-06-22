# Story Map — Phase 5 "Connected Estate"

## User: Don Ricardo (Owner) + Marcelino (Crew-lead) + Inés (Agronomist)
## Goal: enter once / trust everywhere · open any entity's whole story · every click wired

The backbone is the owner's day with the estate. The mandate makes **depth + wiring co-primary
with the reactive graph** — so every release band PAIRS "deepen + fully-wire tab X" with the
J1/J2 connective work, never deferring depth.

## Backbone (user activities, chronological)

| A. Capture a field fact | B. Trust the ripple | C. Open the whole story | D. Stay compliant | E. Deepen + wire every tab |
|---|---|---|---|---|
| Weigh a picker (offline) | See it on the Dashboard | Click a lot → dossier | PHI blocks an unsafe pick | Make every entity row a link |
| Advance a lot's stage | See pay/attendance update | Click a plot → dossier | QC-hold flags everywhere | Kill the dead Map click |
| Book a cost | See cost/kg recompute | Click a worker → dossier | EUDR origin verified | Replace the CREWS mock |
| Log a spray | See season headline move | Reach dossiers from nav/⌘K | Moisture/reposo gate holds | Deepen Satellite + thin tabs |

---

### Walking Skeleton (thinnest end-to-end J1 slice — one task per activity)

**One weigh-in auto-propagating to TWO downstream consumers through the existing view
mechanism, end-to-end, with the originating control fully wired and a reactive proof surfaced.**

- A. **Capture**: the Weigh "Capturar" control writes via the live `record_weigh_in` RPC (already WIRED) — the genesis event.
- B. **Trust**: the **Dashboard "Today"/season headline** (`season_summary_view`) AND the **Weigh per-picker tally** (`v_weigh_today_by_picker`) both reflect that one weigh-in — proving the ripple to two consumers with zero re-entry. A small "esto también actualizó…" proof panel names + links the consumers.
- C. **Story**: the minted lot becomes clickable → `/lots/<code>` (the existing deep dossier), now reachable from the proof panel.
- D./E. deferred to releases below.

> This is intentionally thin: it reuses the live RPC + two existing views + the existing lot
> dossier. It adds only (1) the reactive proof panel + (2) the lot link out of Weigh/activity.
> It validates the riskiest assumption — *does the existing reactive mechanism visibly land
> end-to-end and feel trustworthy?* — before any tab-deepening investment.

---

### Release 1 — "Enter once, trust everywhere" (J1 + J4 wiring of the spine tabs)
Target outcome: the owner trusts that one field fact ripples to all spine numbers.
Tasks: deepen the Weigh reactive proof; wire Dashboard rows to dossiers; surface Costing
recompute on the lot dossier; replace the `CREWS` mock with the live crews read.
KPI link: % clickable elements wired → 100% on Dashboard/Weigh/Costing/Workers; mock-data reads on prod paths → 0.

### Release 2 — "One place, whole story" (J2 entity dossiers)
Target outcome: any named entity opens its whole life in one place.
Tasks: build `/plots/[id]`, `/workers/[id]`, `/crew/[id]` dossiers; wire the orphan dossiers
(`/lots/[code]`, `/ferment/[batch]`, `/qc/cup/[lot]`) into nav + a ⌘K entity jump; make every
entity-bearing row across all 17 tabs a dossier link; **kill the DEAD Map polygon click**.
KPI link: avg cross-entity links surfaced per dossier ≥ 4; DEAD clicks → 0.

### Release 3 — "A mistake can't slip through" (J3 cross-tab guards)
Target outcome: PHI / QC-hold / moisture auto-block or flag everywhere they matter.
Tasks: surface `phi_clears_on` on Map/Satellite/Scouting/plot dossier from the one source;
make a QC-held lot read un-sellable on Inventory + flagged on Dispatch; surface the reposo gate
on the lot/drying dossiers.
KPI link: # tabs surfacing a live cross-tab guard ≥ 6; 0 unsafe picks schedulable.

### Release 4 — "Deepen the thin tabs" (J4 depth)
Target outcome: no tab stays thin/demo; Satellite + any partial tab get materially deeper.
Tasks: Satellite read-only → plot drill-in + PHI→spray linkage; Plan/Dispatch rows → dossiers;
Scouting threshold "control task" → `/tasks` link; deepen Harvests/QC cross-entity references.
KPI link: # tabs at "deep" vs "stub" on the audit → 17/17 deep.

---

## Priority Rationale

Priority order is **outcome impact + dependency**, tie-broken by Walking Skeleton > Riskiest
Assumption > Highest Value (per the user-story-mapping skill):

1. **Walking Skeleton first** — it validates the riskiest assumption (does the existing reactive
   mechanism land visibly and feel trustworthy?) at the lowest cost; everything else assumes "yes."
2. **Release 1 (J1 spine wiring) next** — J1 is the named walking-skeleton focus and J4 is co-primary;
   wiring the spine tabs + killing the mock leak is high-value, low-risk (the backend exists).
3. **Release 2 (J2 dossiers)** — highest *connectivity* value and the largest mandate gap (orphan
   dossiers + entity rows that go nowhere + the DEAD click). Depends on R1's wiring patterns.
4. **Release 3 (J3 guards)** — high safety value but builds on the live PHI/QC spine; sequenced after
   the dossiers exist so a guard can link to the entity it concerns.
5. **Release 4 (depth)** — closes the "every tab deep" half of the mandate; sequenced last because the
   thin tabs (Satellite) gain most from the dossiers + guards that R2/R3 create.

> Story IDs are assigned in `user-stories.md` (Phase 4). Each release band targets a Connectedness
> KPI in `outcome-kpis.md`. No release is "all of feature A then all of feature B" — every band
> touches multiple activities (slices ACROSS tabs by outcome), per the anti-pattern guard.
