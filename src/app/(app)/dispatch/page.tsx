import { PageHeader } from "@/components/ui/page-header";
import { DispatchBoard } from "@/components/sections/dispatch/dispatch-board";

/**
 * Morning Dispatch — the "/dispatch" route for Coffee Farm Operations (P2-S5).
 *
 * The closed loop from the maturation model to the picker's morning: at 5:30am the
 * manager opens this board, sees a ripeness-aware plan auto-drafted from the S8
 * harvest model ("Crew Norte → plots ready today, in pasada order"), and shares the
 * bilingual (es / ngäbere) card into the crew-lead WhatsApp group with one tap — via
 * the device's native share sheet (the $0 web-share adapter; the WhatsApp Cloud API
 * is a dormant, flagged drop-in). Generation never sends — sharing is a deliberate,
 * owner-initiated outbound action.
 *
 * 🚨 Injection-safe: dispatch is OWNER-INITIATED OUTBOUND ONLY. An inbound crew-lead
 * acknowledgement is recorded as EVIDENCE, never an action trigger — untrusted text
 * can never drive a write (the global no-untrusted-text-drives-action invariant).
 *
 * Server Component (no client JS on the page itself): all data flows from the
 * dispatch + people read ports. The app shell is provided by (app)/layout.tsx; this
 * page renders only its inner content. The write islands (generate / share) live
 * inside the board, wired to the route's Server Actions.
 */
export default function DispatchPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Despacho Matutino"
        subtitle="Planes por cuadrilla según la madurez, compartidos como tarjeta bilingüe — iniciado por el dueño"
      />

      <DispatchBoard />
    </div>
  );
}
