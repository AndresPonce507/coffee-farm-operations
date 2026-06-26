# Shared-Artifacts Registry — Phase 5 "Connected Estate"

Every value that flows across tabs/dossiers, its single source of truth, its consumers, and
the integration risk if they drift. These are the seams J1 (ripple), J2 (dossier), and J3
(cross-tab gate) live on. Sources are real migrations/views in
`/Users/andres/coffee-farm-operations-worktrees/phase1-deliver/supabase/migrations/*`.

```yaml
shared_artifacts:
  lot_code:                       # JC-NNN
    source_of_truth: "lot_code_seq via record_cherry_intake() (20260621092000/093000)"
    consumers: ["Weigh", "Harvests", "Processing", "Ferment", "Drying", "Inventory", "QC", "Costing", "EUDR", "/lots/[code]", "activity feed", "⌘K entity jump"]
    owner: "lot-event spine (S3)"
    integration_risk: "HIGH — a lot shown on any tab must be the SAME minted code; the dossier is keyed on it."
    validation: "Every entity-bearing lot row links to /lots/<code>; getLotGenealogy rejects unknown codes (404, no fabricated dossier)."

  weigh_event_kg:                 # per-lata kg
    source_of_truth: "weigh_event (20260622102000_weigh_capture)"
    consumers: ["v_weigh_today_by_picker", "v_weigh_by_lot", "v_lot_weigh_reconciliation", "Weigh tally", "/workers/[id]", "payroll"]
    owner: "weigh capture (P2-S2)"
    integration_risk: "HIGH — pay, mill intake, and lot mass all derive from this one append-only row."
    validation: "v_lot_weigh_reconciliation.reconciles must be true (Σ weigh kg == lots.origin_kg)."

  season_today_kg:                # Dashboard 'Today' + season headline
    source_of_truth: "harvests → season_summary_view (20260621093000_derived_metrics)"
    consumers: ["Dashboard SeasonHero", "Dashboard KpiRow"]
    owner: "derived-metrics semantic layer (S4)"
    integration_risk: "HIGH — must NEVER read a hand-authored aggregate (the deprecated daily_cherries/season_summary tables were renamed __deprecated precisely to prevent silent disagreement)."
    validation: "getSeason() reads season_summary_view; getSeasonProvenance() shows 'derived from N harvests'."

  lot_cost_per_kg:
    source_of_truth: "cost_entry → mv_lot_cost (20260621094000_costing) — refreshed on the cost write path"
    consumers: ["Costing", "/lots/[code]#cost-entries", "Inventory"]
    owner: "costing (S7) — the one earned materialized view"
    integration_risk: "MEDIUM — mv refresh must run on every cost write so the dossier never shows a stale cost."
    validation: "book-cost Server Action refreshes mv_lot_cost + mv_lot_cost_by_rule; cogs_per_lot == mv value."

  phi_clears_on:                  # pre-harvest interval per plot
    source_of_truth: "spray_application → v_plot_phi_status (20260622106000_remote_sensing_ipm)"
    consumers: ["Plan (schedule_pasada/replan_pasada gate)", "Map", "Satellite", "Scouting", "/plots/[id]"]
    owner: "remote-sensing/IPM (S12) + planner gate (S12-B)"
    integration_risk: "HIGH — food-safety + EUDR; one source must drive the gate AND every surface that displays PHI."
    validation: "schedule_pasada fail-closed against v_plot_phi_status (20260623110000_phi_planner_gate); same date on Map/Satellite/plot dossier."

  qc_hold:                        # per green lot
    source_of_truth: "qc_hold via place_qc_hold/release_qc_hold (20260622096000_qc_cupping) → getQcStatus"
    consumers: ["QC", "Inventory (un-sellable)", "Dispatch", "/lots/[code]", "/qc/cup/[lot]"]
    owner: "QC/cupping (S?)"
    integration_risk: "HIGH — a held lot must read as un-sellable everywhere it can be reserved or shipped."
    validation: "Inventory reserve path must refuse a held lot; the hold banner shows on the cup + lot dossiers."

  crew_membership:                # which picker is on which crew
    source_of_truth: "crews + crew_memberships (people system, 20260622090000/104000)"
    consumers: ["Weigh (active-crew gate)", "Workers", "Crew", "Dispatch", "/crew/[id]"]
    owner: "people system (S1)"
    integration_risk: "HIGH — currently the Workers UI reads a MOCK `CREWS` constant (src/lib/data/workers.ts) in worker-form.tsx + crew-board.tsx instead of the live crews table. This is the one true MOCK-DATA leak; fixing it is a Phase-5 slice."
    validation: "worker-form + crew-board read crews via a getter; no @/lib/data import in UI code."
```

## Integration checkpoints (horizontal coherence gates)

1. **One lot, everywhere the same** — every lot row across 17 tabs links to `/lots/<code>`; unknown codes 404.
2. **One season truth** — Dashboard headline == Σ today's harvests (no `__deprecated` aggregate read).
3. **One PHI source** — the gate and every PHI display read `v_plot_phi_status`.
4. **One hold posture** — a QC-held lot is un-sellable on Inventory and flagged on Dispatch.
5. **No mock in the UI** — `grep "from '@/lib/data/'" src/**` returns zero non-test UI hits (today: 2 — Workers).
6. **No dead click** — no element has a pointer affordance without a destination/handler (today: 1 — Map polygon).
