import { CheckCircle2, Clock, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";

import { DossierSection } from "@/components/dossier/dossier-section";
import type { DispatchCard } from "@/lib/types";

/**
 * DispatchAckSection — "ack status": did the crew lead confirm the card (the
 * #ack anchor of the /dispatch/[id] dossier).
 *
 * Presentational Server Component. An acknowledgement is EVIDENCE the card was
 * received — NEVER an action trigger. Untrusted inbound crew text can never drive
 * a write (the global no-untrusted-text-drives-action invariant). This section
 * states that plainly so the dossier never implies the ack is an automation hook.
 *
 * Glass-card; status by icon + text + token, never colour alone; AA on cream.
 * es-PA copy.
 */
export interface DispatchAckSectionProps {
  run: DispatchCard;
}

export function DispatchAckSection({ run }: DispatchAckSectionProps) {
  const t = useTranslations("dispatch");
  const acknowledged = run.status === "acknowledged";
  const sent = run.status === "sent" || acknowledged;

  return (
    <DossierSection id="ack" title={t("ack.title")}>
      <article className="glass-card rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/60 bg-white/55 text-forest shadow-sm"
          >
            {acknowledged ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : (
              <Clock className="h-5 w-5 text-muted-fg" />
            )}
          </span>
          <div>
            <p className="font-display text-base font-semibold text-ink">
              {acknowledged
                ? t("ack.confirmedTitle")
                : sent
                  ? t("ack.sentTitle")
                  : t("ack.draftTitle")}
            </p>
            <p className="mt-1 text-sm text-muted-fg">
              {acknowledged
                ? t("ack.confirmedBody")
                : sent
                  ? t("ack.sentBody")
                  : t("ack.draftBody")}
            </p>
          </div>
        </div>

        {/* The injection-safety note: the ack is evidence, never an action. */}
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-line/60 bg-paper/60 px-3.5 py-2.5 text-xs leading-relaxed text-muted-fg">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest" aria-hidden />
          <span>{t("ack.injectionNote")}</span>
        </p>
      </article>
    </DossierSection>
  );
}
