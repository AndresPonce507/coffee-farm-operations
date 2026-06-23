import { PageHeader } from "@/components/ui/page-header";
import { HarvestPlanner } from "@/components/sections/planning/harvest-planner";

/**
 * Harvest Plan — the "/plan" route for Coffee Farm Operations (P2-S8).
 *
 * Ripeness-aware harvest planning made visible: every plot's DERIVED readiness
 * (GDD + NDVI-ready phenology, never a hand-set flag) ranked most-ready-first, and
 * a pasada (harvest-pass) calendar staggered down the 1,360–1,700 masl altitude
 * gradient — the lower, warmer plots first, the high Geisha last. Scheduling a
 * pass fires a task onto the existing /tasks board; re-planning around a rain front
 * appends a new version (the plan history is auditable). This is the model the S5
 * morning dispatch card runs on.
 *
 * Server Component (no client JS on the page itself): all data flows from the
 * planning read port (v_harvest_readiness / v_pasada_calendar). The app shell is
 * provided by (app)/layout.tsx; this page renders only its inner content.
 */
export default function PlanPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Plan de Cosecha"
        subtitle="Parcelas ordenadas por madurez y un calendario de pasadas escalonado según el gradiente de altitud"
      />

      <HarvestPlanner />
    </div>
  );
}
