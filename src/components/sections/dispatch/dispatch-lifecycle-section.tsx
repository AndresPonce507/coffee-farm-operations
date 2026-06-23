import { Check, Hash } from "lucide-react";

import { DossierSection } from "@/components/dossier/dossier-section";
import { cn } from "@/lib/utils";
import type { DispatchCard, DispatchStatus } from "@/lib/types";

/**
 * DispatchLifecycleSection — "lifecycle": the run's outbound lifecycle as a stage
 * rail (the #lifecycle anchor of the /dispatch/[id] dossier).
 *
 * Presentational Server Component. Renders the four-stage lifecycle
 * (borrador → enviado → confirmado, with superseded as history) and marks how far
 * THIS run has reached, plus the channel it was shared through and the
 * idempotency key (the exactly-once anchor). State is conveyed by a filled marker +
 * text + token, never colour alone; AA on the cream canvas; es-PA copy.
 */
export interface DispatchLifecycleSectionProps {
  run: DispatchCard;
}

/** The ordered, non-superseded lifecycle stages with es-PA labels. */
const STAGES: { key: DispatchStatus; label: string; hint: string }[] = [
  { key: "draft", label: "Borrador", hint: "Generado al amanecer" },
  { key: "sent", label: "Enviado", hint: "Compartido con la cuadrilla" },
  { key: "acknowledged", label: "Confirmado", hint: "Recibido por el líder" },
];

/** How far down the rail this status has reached (superseded counts as sent-level
 *  history so the rail still reads sensibly for an archived run). */
function reachedIndex(status: DispatchStatus): number {
  switch (status) {
    case "draft":
      return 0;
    case "sent":
    case "superseded":
      return 1;
    case "acknowledged":
      return 2;
  }
}

export function DispatchLifecycleSection({
  run,
}: DispatchLifecycleSectionProps) {
  const reached = reachedIndex(run.status);

  return (
    <DossierSection id="lifecycle" title="Ciclo de vida">
      <article className="glass-card rounded-2xl p-5">
        <ol className="space-y-3">
          {STAGES.map((stage, i) => {
            const done = i <= reached;
            const current = i === reached;
            return (
              <li
                key={stage.key}
                className="flex items-start gap-3"
                aria-current={current ? "step" : undefined}
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-semibold",
                    done
                      ? "border-forest bg-forest text-white"
                      : "border-line bg-white/55 text-muted-fg",
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <div>
                  <p
                    className={cn(
                      "font-medium",
                      current ? "text-forest" : done ? "text-ink" : "text-muted-fg",
                    )}
                  >
                    {stage.label}
                    {current && stage.key === "sent" && run.sentChannel && (
                      <span className="ml-1.5 text-xs font-normal text-muted-fg">
                        vía {run.sentChannel}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-fg">{stage.hint}</p>
                </div>
              </li>
            );
          })}
        </ol>

        {run.status === "superseded" && (
          <p className="mt-4 rounded-xl border border-line/60 bg-paper/60 px-3.5 py-2 text-xs text-muted-fg">
            Este despacho fue reemplazado por uno más reciente (historial).
          </p>
        )}

        {/* The exactly-once anchor — the idempotency key that guards re-drafts. */}
        {run.idempotencyKey && (
          <p className="mt-4 flex items-center gap-1.5 border-t border-line/70 pt-3 text-xs text-muted-fg">
            <Hash className="h-3 w-3" aria-hidden />
            <span className="font-medium">Clave única:</span>
            <code className="font-mono">{run.idempotencyKey}</code>
          </p>
        )}
      </article>
    </DossierSection>
  );
}
