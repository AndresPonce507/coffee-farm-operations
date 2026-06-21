import { PageHeader } from "@/components/ui/page-header";
import { DryingBoard } from "@/components/sections/drying/drying-board";
import { StationOccupancyBoard } from "@/components/sections/drying/station-occupancy-board";
import {
  getDryingLots,
  getStationOccupancy,
  getDryingWeatherRisk,
} from "@/lib/db/drying";

/**
 * Drying — the "/drying" route for Coffee Farm Operations (P2-S4).
 *
 * Where the pipeline used to treat drying as a single flat field, this surface
 * makes the REST (the reposo) a first-class, protected process control: every lot
 * resting before the mill shows its moisture curve converging on the 10.5–11.5%
 * target band, the days it has rested, and THE REPOSO GATE verdict — red "resting"
 * until it is rest-stable, then green "clear to mill". The advance-to-mill button
 * is disabled with the gate's exact reason until then — but the real enforcement
 * is in the database: a lot physically cannot advance drying→milled until moisture
 * is stable AND the minimum rest-days are met (the precondition inside
 * advance_processing_stage + the BEFORE-UPDATE trigger backstop on `lots`).
 *
 * Below the resting board, a stations board tracks each drying station's committed
 * vs available capacity (a fail-closed `prevent_overcapacity` trigger makes a bed
 * impossible to oversubscribe) and surfaces a weather-coupled "cover the beds"
 * alert when rain is forecast for an open-air station.
 *
 * Server component: awaits the three derived reads in parallel and composes the
 * header above the boards. No client JS. The app shell comes from (app)/layout.tsx.
 */
export default async function DryingPage() {
  const [lots, stations, weatherRisk] = await Promise.all([
    getDryingLots(),
    getStationOccupancy(),
    getDryingWeatherRisk(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Drying & reposo"
        subtitle="The rest that defines the cup — moisture, stations, and the reposo gate"
      />

      <DryingBoard lots={lots} />

      <StationOccupancyBoard stations={stations} weatherRisk={weatherRisk} />
    </div>
  );
}
