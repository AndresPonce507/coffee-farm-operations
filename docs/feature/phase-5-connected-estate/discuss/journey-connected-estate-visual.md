# Journey — The Connected Estate (J1 reactive walking skeleton + J2/J4 connectivity)

Persona: **Don Ricardo (Owner)** with **Marcelino (Crew-lead)** at the weigh station and
**Inés (Agronomist)** on compliance. Goal: enter ONE field fact and watch it ripple
trustably to every downstream number AND open any named entity's whole story in one place —
with **every control on every tab tied to real data or a real action**.

## Emotional arc (Confidence Building → Trust)

```
START                         MIDDLE                         END
Skeptical / re-keying-weary   Watching the ripple land       Trusting the cockpit
"do the numbers even agree?"  "I entered it once…"           "every screen agrees, and I can
                                                              show a buyer the whole story"
        anxious  ───────────────► focused ───────────────► confident / proud
```

The peak tension is the **first weigh-in of the morning**: will the season headline, the
picker's pay, and the lot's mass all move from one tap — without Don Ricardo touching another
screen? If yes, every later tap compounds confidence. The mandate adds a second peak: **does
every click pay off?** A single dead button resets trust to zero — so depth + wiring land
together, never deferred.

## Happy path — the genesis weigh-in ripples everywhere (WALKING SKELETON)

```
[5:40am · Marcelino at the weigh station]
        │
        ▼
( 1 ) BADGE + WEIGH ──────────────────────────────────────────────────────────────────
   Marcelino badges Lupita, confirms plot Tizingal-Alto (GPS auto-picks), taps 18.4 kg,
   taps "ripe", hits Capture.  → record_weigh_in RPC (offline-safe outbox)
        │   outputs: lot JC-7NN minted · harvests row · attendance clock-in · weigh_event
        ▼
( 2 ) THE RIPPLE LANDS (no re-entry) ──────────────────────────────────────────────────
   ┌─ Weigh tally:     Lupita 18.4 kg · 1 lata   (v_weigh_today_by_picker)
   ├─ Dashboard:       "Today" KPI + season headline tick up (season_summary_view sums harvests)
   ├─ Costing:         lot JC-7NN appears, cost/kg recomputes when costs book (mv_lot_cost)
   └─ Lot dossier:     JC-7NN now has a genealogy node (cherry intake)   ← J2 lands here
        │   Don Ricardo sees the morning number WITHOUT opening another screen.
        ▼
( 3 ) OPEN THE WHOLE STORY (J2) ───────────────────────────────────────────────────────
   Don Ricardo clicks the lot in the activity feed → /lots/JC-7NN: lineage + EUDR + cost.
   He clicks the plot name → /plots/tizingal-alto: this plot's harvests, sprays, PHI, satellite.
   He clicks Lupita → /workers/lupita: her attendance, kg, por-obra pay, crew.
        │   Every named entity is one click from its whole life across all 17 tabs.
        ▼
( 4 ) A MISTAKE CAN'T SLIP THROUGH (J3) ────────────────────────────────────────────────
   Inés tries to schedule a pick on a plot still inside a spray PHI window → planner refuses
   with a human sentence; the same PHI shows on Map, Satellite, and the plot dossier.
        ▼
[ Don Ricardo trusts the cockpit; hands a buyer the lot dossier link. ]
```

## TUI / screen mockups (es-PA-first, glove-friendly, $0)

### Step 1 — Weigh capture (the most-used screen; offline)
```
+-- Pesaje · Tizingal-Alto (GPS ✓) --------------------------------+
|  Picker:  [ Lupita Gonzalez ]   crew: Norte                       |
|  Peso:    [   18.4  ] kg        ( • 7 8 9 )                        |
|  Madurez: ( verde )  [ MADURO ]  ( sobremaduro )                  |
|                                                                   |
|            [   CAPTURAR   ]   ·   sin señal: se guarda            |
+------------------------------------------------------------------+
   ${lot_code} ← minted by record_weigh_in (source: lot_code_seq)
```

### Step 2 — The ripple, surfaced on the same screen (proof of J1)
```
+-- Hoy ------------------------------------------------------------+
|  Lupita        18.4 kg · 1 lata        ← v_weigh_today_by_picker  |
|  Finca hoy    412.6 kg                  ← Σ pickers               |
|  ───────────────────────────────────────────────────────────     |
|  Esto también actualizó:                                          |
|   • Tablero · "Hoy" +18.4 kg            → /  (season_summary_view) |
|   • Lote JC-7NN creado                  → /lots/JC-7NN  ▸          |
|   • Costeo · JC-7NN ahora rastreado     → /costing     ▸          |
+------------------------------------------------------------------+
```

### Step 3 — Lot dossier (J2; already built, now reachable)
```
+-- Lote JC-7NN · de la cereza a la bolsa --------------------------+
|  cherry 18.4kg ─split─► Washed 9.1kg ─process─► … ─► Green 3.2kg   |
|  EUDR: ✓ libre de deforestación · 1 parcela de origen             |
|  Costo: $4.18/kg verde   ·   Cup: 86.5 (Specialty)                |
|  [ abrir parcela ▸ ]  [ ver costos ▸ ]  [ exportar dossier ▸ ]    |
+------------------------------------------------------------------+
```

## Shared-artifact registry (summary — full file: shared-artifacts-registry.md)

| `${artifact}` | Source of truth | Consumers (tabs/dossiers) | Risk |
|---|---|---|---|
| `${lot_code}` (JC-NNN) | `lot_code_seq` via `record_cherry_intake` | Weigh, Harvests, Processing, Ferment, Drying, Inventory, QC, Costing, EUDR, lot dossier, activity feed | HIGH |
| `${kg_today}` per picker | `weigh_event` → `v_weigh_today_by_picker` | Weigh tally, Harvests top-pickers, worker dossier, payroll | HIGH |
| `${season_today_kg}` | `harvests` → `season_summary_view` | Dashboard headline + KPI | HIGH |
| `${lot_cost_per_kg}` | `cost_entry` → `mv_lot_cost` | Costing, lot dossier, Inventory | MEDIUM |
| `${phi_clears_on}` per plot | `spray_application` → `v_plot_phi_status` | Plan (gate), Map, Satellite, Scouting, plot dossier | HIGH |
| `${qc_hold}` per green lot | `qc_hold` → `getQcStatus` | QC, Inventory, Dispatch, lot dossier | HIGH |

## Error paths (feed DISTILL)

- Offline at 1,700 masl → Capture queues to the S0 outbox; replay is exactly-once on
  `idempotency_key` (no double pay, no double lot).
- Double-tap / queued replay → `record_weigh_in` advisory-lock + dedup returns the same lot.
- Picker not on an active crew → friendly "este recolector no está en una cuadrilla activa hoy."
- Typed/⌘K route to a non-existent lot (`/lots/JC-999`) → `notFound()` (no fabricated dossier).
- Pick scheduled inside an active PHI window → planner refuses (fail-closed) with a human sentence.
- Dead click (the Map polygon) → **must not exist after Phase 5**; every click pays off.
