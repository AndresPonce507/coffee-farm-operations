# Feature Delta — phase-5-connected-estate (DISCUSS wave)

All DISCUSS findings, as `## Wave: DISCUSS / [REF|WHY|HOW] <Section>`. Grounded in the live
codebase at `/Users/andres/coffee-farm-operations-worktrees/phase1-deliver` (branch `main`):
append-only hash-chained `lot_event` spine, SECURITY-DEFINER command RPCs, reactive views/matviews
(`season_summary_view`, `v_weigh_*`, `mv_lot_cost`, `v_plot_phi_status`), 17 tabs, ~58 tables.

---

## Wave: DISCUSS / WHY — The mandate

"No dead UI — wire everything, deepen everything." Two co-primary outcomes: (1) every one of the 17
tabs gets materially deeper; (2) every clickable element on every tab ties to real data or a real
action — read/write a command-RPC, navigate to a connected entity dossier, or trigger a cross-tab
reactive effect. This makes **J4 co-primary with J1**.

---

## Wave: DISCUSS / REF — JTBD (four jobs, forces, opportunity scores)

Full SSOT in `docs/product/jobs.yaml`. Opportunity score = importance + (importance − satisfaction).

| Job | Name | Type | Importance | Satisfaction | Opportunity | Functional / Emotional / Social |
|-----|------|------|-----------|-------------|-------------|---------------------------------|
| **J1** | Enter-once, trust-everywhere | **CO-PRIMARY** (walking-skeleton focus) | 9 | 3 | **15** | record once / confidence numbers agree / show a buyer traceable figures |
| **J2** | One place, whole story | Secondary | 8 | 2 | **14** | click an entity → full cross-tab story / relief / one shareable dossier |
| **J3** | A mistake can't slip through | Secondary | 8 | 4 | **12** | auto-block PHI/QC/moisture / peace of mind / protect crew + EUDR standing |
| **J4** | Every tab real + every click wired | **CO-PRIMARY** | 10 | 2 | **18** | every tab deep + every click wired / pride, nothing fake / demoable estate cockpit |

**Four forces (per job, condensed):**
- **J1** — Push: re-keying the same weight to pay/mill/traceability; numbers disagree. Pull: one tap
  ripples everywhere. Anxiety: a wrong auto-ripple I won't notice until payroll. Habit: notebook + 3 spreadsheets.
- **J2** — Push: 7 tabs to answer "what happened to JC-712?". Pull: the lot dossier already renders.
  Anxiety: an incomplete dossier is worse than none. Habit: the story lives in the owner's head.
- **J3** — Push: a pick inside a residue window nobody catches. Pull: the planner already refuses it.
  Anxiety: over-blocking legitimate field work. Habit: PHI on a clipboard.
- **J4** — Push: dead buttons/mock numbers erode trust instantly. Pull: the backend already exists.
  Anxiety: half-finished tabs if wired all at once. Habit: a beautiful but mock-bound phase-1 dashboard.

---

## Wave: DISCUSS / REF — Comprehensive journey

Full artifacts: `journey-connected-estate-visual.md` (mental model + happy path with outputs +
emotional arc + TUI mockups + error paths) and `journey-connected-estate.yaml` (structured schema with
embedded Gherkin per step). Shared-artifact registry: `shared-artifacts-registry.md`.

- **Emotional arc:** Confidence Building → Trust (skeptical/re-keying-weary → focused → confident/proud).
  Peak tension: the first weigh-in of the morning visibly rippling to the Dashboard with zero re-entry,
  AND every click paying off (one dead button resets trust).
- **Happy path (with outputs):** capture weigh-in → ripple lands (tally + Dashboard + lot + cost) →
  open the whole story (lot/plot/worker dossiers) → a mistake can't slip through (PHI gate visible).
- **Shared artifacts (single source):** `${lot_code}` (lot_code_seq), `${kg_today}` (weigh_event),
  `${season_today_kg}` (season_summary_view), `${lot_cost_per_kg}` (mv_lot_cost), `${phi_clears_on}`
  (v_plot_phi_status), `${qc_hold}` (getQcStatus), `crew_membership` (crews — currently mock in UI).
- **Error paths (→ DISTILL):** offline replay exactly-once; double-tap dedup; picker-not-on-crew refusal;
  unknown-entity 404 (no fabricated dossier); PHI fail-closed; **no dead clicks after Phase 5**.

---

## Wave: DISCUSS / REF — The per-tab WIRE-UP AUDIT (the depth backlog)

Full artifact: `wire-up-audit.md` (every clickable element on all 17 tabs, classified). Produced by a
4-cluster parallel read-only audit reconciled against a definitive `@/lib/data/` grep.

**Headline:** ~307 interactive elements across 17 tabs — **WIRED ~246 · COSMETIC ~88 · STUB 3
(intentional, keep) · MOCK-DATA 6 (1 source: `CREWS`) · DEAD 1 (Map polygon).** Depth: 13 deep · 3
partial (Dashboard, Plots, Workers) · 1 thin (Satellite).

**The three gap patterns the mandate targets:**
1. **Orphan dossiers** — `/lots/[code]`, `/ferment/[batch]`, `/qc/cup/[lot]` exist + are deep but the
   sidebar links to none (reachable only by typed URL / a few inline links).
2. **Entity rows that go nowhere** — plot/worker/crew/lot/pasada rows across most tabs are COSMETIC;
   they name a connected entity but click nowhere.
3. **Missing dossiers** — no `/plots/[id]`, `/workers/[id]`, `/crew/[id]`, `/dispatch/[id]`,
   `/pay-period/[id]`, drying-station, spray-record dossiers yet.

Plus the **1 DEAD click** (Map polygon: pointer cursor, no handler) and the **1 MOCK leak** (`CREWS`).

---

## Wave: DISCUSS / HOW — Story map + stories

Full artifacts: `story-map.md` (backbone + walking skeleton + 4 outcome releases + priority rationale),
`user-stories.md` (8 stories, each with Elevator Pitch + embedded testable AC + `job_id`),
`outcome-kpis.md`, and `slices/slice-01..08`.

| Story | Job | Release | Elevator-pitch entry point |
|-------|-----|---------|----------------------------|
| US-01 Weigh ripple proof (WALKING SKELETON) | J1 | WS | Weigh tab proof panel + Dashboard "Today" |
| US-02 Replace CREWS mock with live crews | J4 | R1 | /workers crew dropdown + board |
| US-03 /plots/[id] dossier + kill Map dead-click | J2 | R2 | Map polygon click → /plots/[id] |
| US-04 /workers/[id] dossier | J2 | R2 | Harvests picker row → /workers/[id] |
| US-05 ⌘K entity jump to existing dossiers | J2 | R2 | ⌘K → /lots,/ferment,/qc/cup |
| US-06 PHI visible on every plot surface | J3 | R3 | "PHI hasta" badge on Map/Satellite/dossier |
| US-07 QC-held lot un-sellable on Inventory+Dispatch | J3 | R3 | Inventory "no vendible" banner |
| US-08 Deepen Satellite into drill-in | J4 | R4 | Satellite vegetation card → /plots/[id] |

**Walking skeleton:** US-01 — one weigh-in (live RPC) auto-propagating to TWO downstream consumers
(Weigh tally `v_weigh_today_by_picker` + Dashboard headline `season_summary_view`) through the existing
view mechanism, end-to-end, with the originating control fully wired and a reactive proof surfaced.

---

## Wave: DISCUSS / HOW — Outcome KPIs (summary)

Full: `outcome-kpis.md`. **North star:** % of clickable elements wired to data/action across all 17
tabs → **100%** (baseline ~80%). **Leading:** dossier reachability 0→100%, avg cross-entity links/dossier
≥4, tabs-deep 14→17. **Guardrails (must not degrade):** mock-data reads 0 (from 1 source), dead clicks 0
(from 1), unsafe picks schedulable 0, build+test green.

---

## Wave: DISCUSS / REF — Definition of Ready (9-item gate)

Per-story DoR validated in the handoff section below. Feature-level posture:

| # | DoR item | Status | Evidence |
|---|----------|--------|----------|
| 1 | Problem statement clear, domain language | PASS | each story opens from owner/agronomist/crew-lead pain in farm language |
| 2 | Persona with specific characteristics | PASS | 4 personas in `docs/product/personas/*` (Ngäbe-Buglé offline picker, etc.) |
| 3 | 3+ domain examples with real data | PASS | each story has 3 (Lupita Gonzalez, plot Tizingal-Alto, lot JC-7NN/JC-712/JC-680) |
| 4 | UAT in Given/When/Then (3-7 scenarios) | PASS | each story has 3 business-outcome scenarios |
| 5 | AC derived from UAT | PASS | each story's AC trace to its scenarios + the cross-cutting wiring AC |
| 6 | Right-sized (1-3 days, 3-7 scenarios) | PASS | 8 stories, 3 scenarios each, ≤1-day slices |
| 7 | Technical notes: constraints/dependencies | PASS | each story cites real RPC/view/migration; slice deps noted (US-08→US-03) |
| 8 | Dependencies resolved or tracked | PASS | walking skeleton reuses live spine; US-08 depends on US-03 (tracked) |
| 9 | Outcome KPIs with measurable targets | PASS | per-story KPIs + `outcome-kpis.md` with baselines + measurement plan |
| — | `job_id` on every story | PASS | all 8 stories carry J1/J2/J3/J4 (→ jobs.yaml) |
| — | Elevator Pitch on every non-@infra story | PASS | all 8 stories have Before/After/Decision-enabled with a real entry point |

---

## Wave: DISCUSS / REF — PRINCIPLE.md alignment (north-star Rule 2)

The feature-root `PRINCIPLE.md` sets a sharper bar than "wired": **Rule 2 — every clickable is a
real CREATE or EDIT surface; reading is the floor, editing/creating real records is the
expectation.** This DISCUSS set satisfies the *connectivity* mandate (no dead UI, no mock, every
entity reachable) but DESIGN must additionally decide, **per element**, whether the right wiring is
a *create/edit affordance* (the default) or a *navigate-to-dossier* link (only when the value is
genuinely read-derived). This is captured as a cross-cutting AC in `user-stories.md` System
Constraints and surfaced as Open Question 4 below. No story should ship a navigate-only link where a
create/edit surface is the real expectation.

## Wave: DISCUSS / REF — Open Questions for Andres (DESIGN must resolve)

1. **Release sequence** — confirm the 4-release split (J1 wiring → J2 dossiers → J3 guards → J4 depth)
   and the walking-skeleton-first order. (Scope-assessment gate is awaiting your confirm.)
2. **Dossier scope** — which entities get a full dossier in Phase 5: confirmed `/plots/[id]`,
   `/workers/[id]`, `/crew/[id]`; should `/dispatch/[id]` and `/pay-period/[id]` also land, or defer?
3. **⌘K vs row-links** — is a command palette the right "make orphan dossiers reachable" mechanism, or
   do you prefer nav entries + breadcrumb links only (lighter, no client palette)?
4. **"Deep" definition for J4** — is "every entity-bearing control links to a dossier + 0 cosmetic-only
   entity controls" the bar for a tab to count as "deep", or do you want richer per-tab depth (charts,
   new sections) beyond connectivity?
5. **Intentional STUBs** — confirm we KEEP the 3 courtesy-disabled controls (Drying "Mill", Inventory
   "Sold out", Scouting uncertified-applicator) as DB-guard reflections, not "dead UI".
6. **Stale `HANDOFF.md`** — fix now or leave (flagged, out of scope per "flag-don't-fix")?
