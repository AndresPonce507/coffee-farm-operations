import { ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * QcHoldBanner — the prominent red glass QC-HOLD banner (P2-S6). A held green lot
 * is physically un-sellable (the `_prevent_held_lot_commit` DB trigger fails
 * closed); this banner makes that quarantine state impossible to miss wherever a
 * held lot appears. Server Component (no hooks). Reduced-motion safe (no animation).
 */
export function QcHoldBanner({
  lotCode,
  reason,
}: {
  lotCode: string;
  reason: string | null;
}) {
  const t = useTranslations("qc");
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-2xl border border-cherry-100 bg-cherry-100/70 px-4 py-3 text-cherry shadow-[0_12px_32px_-18px_rgba(122,18,30,0.45)]"
    >
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-semibold">
          <span className="font-mono">{lotCode}</span> {t("holdBanner.onHold")}
        </p>
        <p className="mt-0.5 truncate text-xs text-cherry">
          {reason ? reason : t("holdBanner.quarantined")}
        </p>
      </div>
    </div>
  );
}
