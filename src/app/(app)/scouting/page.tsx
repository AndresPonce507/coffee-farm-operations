import { PageHeader } from "@/components/ui/page-header";
import { IpmBoard } from "@/components/sections/ipm/ipm-board";

/**
 * Scouting — the "/scouting" route for Coffee Farm Operations (P2-S12).
 *
 * The closed-loop IPM cockpit: a scouting board that runs the economic-threshold
 * engine (pest incidence vs the published action threshold → recommend or hold, and
 * a control task fired onto the board when it crosses), a CERT-GATED spray-log form
 * that refuses an uncertified applicator (the gate is in the database; the form
 * makes it visible), and the active PHI/REI safety windows that block a pick or
 * re-entry. Agronomy as a safety-respecting closed loop.
 *
 * Server Component (the page itself); the spray form is the one client island.
 * Data flows from the remote-sensing + applicator read ports.
 */
export default function ScoutingPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Monitoreo"
        subtitle="Monitoreo MIP por umbral económico + un registro de aplicaciones certificado y seguro según PHI/REI"
      />
      <IpmBoard />
    </div>
  );
}
