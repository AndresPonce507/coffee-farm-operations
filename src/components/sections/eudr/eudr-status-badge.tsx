import { ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { EudrStatus } from "@/lib/types";

/** Verdict → tone + label + icon. 'no-origin' reads as the hardest red: an
 *  untraceable lot is the auditor's worst case, never softened to a warning. */
const PRESENTATION: Record<
  EudrStatus,
  { tone: BadgeTone; label: string; Icon: typeof ShieldCheck }
> = {
  compliant: { tone: "ok", label: "EUDR compliant", Icon: ShieldCheck },
  incomplete: { tone: "warn", label: "Incomplete", Icon: ShieldAlert },
  "no-origin": { tone: "danger", label: "Origin unverified", Icon: ShieldQuestion },
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
  const { tone, label, Icon } = PRESENTATION[status];
  // The shared Badge primitive doesn't forward data-* attributes; carry the
  // testid on a thin inline wrapper rather than forking the contract primitive.
  return (
    <span data-testid={`eudr-badge-${status}`} className={className}>
      <Badge tone={tone}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </Badge>
    </span>
  );
}
