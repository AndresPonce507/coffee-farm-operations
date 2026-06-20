import { PageHeader } from "@/components/ui/page-header";
import { WorkerSummary } from "@/components/sections/workers/worker-summary";
import { AttendanceCard } from "@/components/sections/workers/attendance-card";
import { CrewBoard } from "@/components/sections/workers/crew-board";
import { WorkerRosterTable } from "@/components/sections/workers/worker-roster-table";
import { AddWorkerButton } from "@/components/sections/workers/worker-actions";

/**
 * Workers route ("/workers") — crews, daily attendance and payroll for the farm.
 * Server component: the (app) layout supplies the sidebar, topbar and padded
 * <main>, so this returns only the inner section content.
 */
export default function WorkersPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Workers"
        subtitle="Crews, attendance and daily payroll"
      >
        <AddWorkerButton />
      </PageHeader>

      <WorkerSummary />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <AttendanceCard />
        <div className="lg:col-span-2">
          <CrewBoard />
        </div>
      </div>

      <WorkerRosterTable />
    </div>
  );
}
