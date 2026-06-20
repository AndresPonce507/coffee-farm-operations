import { PageHeader } from "@/components/ui/page-header";
import { getPlots } from "@/lib/db/plots";
import { getWorkers } from "@/lib/db/workers";
import { TaskSummary } from "@/components/sections/tasks/task-summary";
import { TaskBoard } from "@/components/sections/tasks/task-board";
import { TaskTable } from "@/components/sections/tasks/task-table";
import { AddTaskButton } from "@/components/sections/tasks/task-actions";

/**
 * /tasks — Agronomy work across the Janson Coffee farm.
 *
 * Server component: fetches the plot + worker lists once (for the create/edit
 * forms) and composes the header (with the live "New task" action), summary
 * tiles, kanban board, and the editable task table.
 */
export default async function TasksPage() {
  const [plots, workers] = await Promise.all([getPlots(), getWorkers()]);

  return (
    <div className="space-y-6">
      <PageHeader title="Tasks" subtitle="Agronomy work across the farm">
        <AddTaskButton plots={plots} workers={workers} />
      </PageHeader>

      <TaskSummary />
      <TaskBoard />
      <TaskTable plots={plots} workers={workers} />
    </div>
  );
}
