import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/data-table";
import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EntityLink } from "@/components/ui/entity-link";
import { getWorkers } from "@/lib/db/workers";
import { getCrews } from "@/lib/db/people";
import { usd } from "@/lib/utils";
import type { AttendanceStatus } from "@/lib/types";
import { WorkerRowActions } from "./worker-actions";

/** Attendance status → badge tone + human label (static maps; no class interpolation). */
const ATTENDANCE_TONE: Record<AttendanceStatus, BadgeTone> = {
  present: "ok",
  "rest-day": "warn",
  absent: "danger",
};

const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  present: "Presente",
  "rest-day": "Día de descanso",
  absent: "Ausente",
};

/**
 * WorkerRosterTable — full labor roster for Janson Coffee.
 * Server component: static display only, no hooks or handlers.
 */
export async function WorkerRosterTable() {
  const [workers, crews] = await Promise.all([getWorkers(), getCrews()]);
  // Crew names for the inline edit form's crew picker (live, mock-free).
  const crewNames = crews
    .map((c) => c.crewName)
    .filter((n): n is string => Boolean(n));

  // Build a name→id map so the crew column cell can be wired to the crew dossier.
  const crewNameToId = new Map(
    crews
      .filter((c): c is typeof c & { crewName: string; crewId: string } =>
        Boolean(c.crewName) && Boolean(c.crewId)
      )
      .map((c) => [c.crewName, c.crewId])
  );

  return (
    <Card className="animate-rise overflow-hidden">
      <CardHeader>
        <div>
          <CardTitle>Nómina</CardTitle>
          <CardDescription>
            {workers.length} integrantes de cuadrilla en la finca
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="cv-auto px-0 pb-0 pt-4">
        <Table className="border-0">
          <THead>
            <TR className="hover:bg-transparent">
              <TH className="pl-5">Trabajador/a</TH>
              <TH>Rol</TH>
              <TH>Cuadrilla</TH>
              <TH className="text-right">Desde</TH>
              <TH className="text-right">Tarifa diaria</TH>
              <TH className="text-right">Hoy</TH>
              <TH className="text-right">Asistencia</TH>
              <TH className="pr-5 text-right">Acciones</TH>
            </TR>
          </THead>
          <TBody>
            {workers.length === 0 && (
              <TR className="hover:bg-transparent">
                <TD colSpan={8} className="px-5 py-10 text-center">
                  <span className="inline-block rounded-xl border border-dashed border-line bg-white/40 px-4 py-3 text-sm text-muted-fg">
                    Aún no hay trabajadores.
                  </span>
                </TD>
              </TR>
            )}
            {workers.map((worker) => (
              <TR key={worker.id}>
                <TD className="pl-5">
                  <EntityLink
                    kind="worker"
                    id={worker.id}
                    className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-1 transition hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
                  >
                    <Avatar name={worker.name} size="md" />
                    <span className="font-medium text-ink">{worker.name}</span>
                  </EntityLink>
                </TD>
                <TD className="text-muted-fg">{worker.role}</TD>
                <TD className="text-muted-fg">
                  {(() => {
                    const crewId = worker.crew
                      ? crewNameToId.get(worker.crew) ?? null
                      : null;
                    return crewId ? (
                      <EntityLink kind="crew" id={crewId}>
                        {worker.crew}
                      </EntityLink>
                    ) : (
                      worker.crew
                    );
                  })()}
                </TD>
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
                    <span className="text-muted-fg" aria-label="No se recogieron cerezas hoy">
                      —
                    </span>
                  )}
                </TD>
                <TD className="text-right">
                  <Badge tone={ATTENDANCE_TONE[worker.attendance]} dot>
                    {ATTENDANCE_LABEL[worker.attendance]}
                  </Badge>
                </TD>
                <TD className="pr-5 text-right">
                  <WorkerRowActions worker={worker} crews={crewNames} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  );
}
