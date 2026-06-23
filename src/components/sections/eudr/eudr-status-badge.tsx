import { ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { EudrStatus } from "@/lib/types";

/** Verdict → tone + label-key + icon. 'no-origin' reads as the hardest red: an
 *  untraceable lot is the auditor's worst case, never softened to a warning. */
const PRESENTATION: Record<
  EudrStatus,
  { tone: BadgeTone; labelKey: string; Icon: typeof ShieldCheck }
> = {
  compliant: { tone: "ok", labelKey: "statusBadge.compliant", Icon: ShieldCheck },
  incomplete: { tone: "warn", labelKey: "statusBadge.incomplete", Icon: ShieldAlert },
  "no-origin": { tone: "danger", labelKey: "statusBadge.noOrigin", Icon: ShieldQuestion },
};

/**
 * EudrStatusBadge — the green lot's EUDR verdict as a single glance. Pure
 * presentation (props-driven, no data deps). Mirrors the authoritative
 * eudr_lot_status() verdict; the icon + tone carry the same meaning as the label
 * so the state survives a screen-reader or a color-blind read.
 */
export function EudrStatusBadge({
  status,
  className,
}: {
  status: EudrStatus;
  className?: string;
}) {
  const t = useTranslations("eudr");
  const { tone, labelKey, Icon } = PRESENTATION[status];
  // The shared Badge primitive doesn't forward data-* attributes; carry the
  // testid on a thin inline wrapper rather than forking the contract primitive.
  return (
    <span data-testid={`eudr-badge-${status}`} className={className}>
      <Badge tone={tone}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {t(labelKey)}
      </Badge>
    </span>
  );
}
