import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { TaskSummary } from "@/components/sections/tasks/task-summary";
import { TaskBoard } from "@/components/sections/tasks/task-board";
import { TaskTable } from "@/components/sections/tasks/task-table";

/**
 * /tasks — Agronomy work across the Janson Coffee farm.
 *
 * Server component: composes the page header, the at-a-glance summary tiles,
 * the kanban-style task board, and the full task table. All sections render
 * over static mock data and require no props. The "New task" action in the
 * header is decorative for this build.
 */
export default function TasksPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Tasks" subtitle="Agronomy work across the farm">
        <Button variant="primary">New task</Button>
      </PageHeader>

      <TaskSummary />
      <TaskBoard />
      <TaskTable />
    </div>
  );
}
