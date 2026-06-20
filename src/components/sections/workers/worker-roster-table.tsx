import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/data-table";
import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { workers } from "@/lib/data/workers";
import { usd } from "@/lib/utils";
import type { AttendanceStatus } from "@/lib/types";

/** Attendance status → badge tone + human label (static maps; no class interpolation). */
const ATTENDANCE_TONE: Record<AttendanceStatus, BadgeTone> = {
  present: "ok",
  "rest-day": "warn",
  absent: "danger",
};

const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  present: "Present",
  "rest-day": "Rest day",
  absent: "Absent",
};

/**
 * WorkerRosterTable — full labor roster for Janson Coffee.
 * Server component: static display only, no hooks or handlers.
 */
export function WorkerRosterTable() {
  return (
    <Card className="animate-rise overflow-hidden">
      <CardHeader>
        <div>
          <CardTitle>Roster</CardTitle>
          <CardDescription>
            {workers.length} crew members across the farm
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="cv-auto px-0 pb-0 pt-4">
        <Table className="border-0">
          <THead>
            <TR className="hover:bg-transparent">
              <TH className="pl-5">Worker</TH>
              <TH>Role</TH>
              <TH>Crew</TH>
              <TH className="text-right">Since</TH>
              <TH className="text-right">Day rate</TH>
              <TH className="text-right">Today</TH>
              <TH className="pr-5 text-right">Attendance</TH>
            </TR>
          </THead>
          <TBody>
            {workers.map((worker) => (
              <TR key={worker.id}>
                <TD className="pl-5">
                  <div className="flex items-center gap-3">
                    <Avatar name={worker.name} size="md" />
                    <span className="font-medium text-ink">{worker.name}</span>
                  </div>
                </TD>
                <TD className="text-muted-fg">{worker.role}</TD>
                <TD className="text-muted-fg">{worker.crew}</TD>
                <TD className="text-right tabular-nums text-muted-fg">
                  {worker.startedYear}
                </TD>
                <TD className="text-right font-medium tabular-nums">
                  {usd(worker.dailyRateUsd)}
                </TD>
                <TD className="text-right tabular-nums">
                  {worker.todayKg > 0 ? (
                    <span className="font-medium text-ink">{worker.todayKg} kg</span>
                  ) : (
                    <span className="text-muted-fg" aria-label="No cherries picked today">
                      —
                    </span>
                  )}
                </TD>
                <TD className="pr-5 text-right">
                  <Badge tone={ATTENDANCE_TONE[worker.attendance]} dot>
                    {ATTENDANCE_LABEL[worker.attendance]}
                  </Badge>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  );
}
