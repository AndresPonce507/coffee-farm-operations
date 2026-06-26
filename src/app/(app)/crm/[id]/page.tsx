import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  ArrowLeft,
  Beaker,
  Building2,
  FileText,
  Globe,
  Handshake,
  Inbox,
  Mail,
  MessageSquare,
  Phone,
  Send,
  ShieldAlert,
  ShieldCheck,
  ThumbsUp,
  Users,
} from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, longDate, num } from "@/lib/utils";
import {
  getContactSheet,
  type ContactEventKind,
  type ContactSheet,
  type ContactStatus,
  type SampleDispatchRow,
} from "../data";
import { ContactActions } from "./contact-sheet.client";

/**
 * /crm/[id] — the contact sheet (P3-S18 CRM backbone).
 *
 * Server Component. 404s on an unknown id (never a fabricated sheet). The header carries
 * the chain-verified stamp (verify_chain('contact:<id>')), so the human sees at a glance
 * that the relationship ledger is tamper-evident. The left rail is the append-only
 * timeline (a glass vertical timeline) + the read-only sample pipeline; the right rail is
 * the one interactive island where the human logs a touchpoint, dispatches a sample (the
 * money-shaped, human-confirmed write), or records a buyer's cup verdict.
 */

const STATUS_TONE: Record<ContactStatus, BadgeTone> = {
  lead: "neutral",
  prospect: "sky",
  active: "forest",
  dormant: "warn",
  lost: "danger",
};

const EVENT_ICON: Record<
  ContactEventKind,
  React.ComponentType<{ className?: string }>
> = {
  inquiry: MessageSquare,
  sample_requested: Inbox,
  sample_sent: Send,
  sample_feedback: ThumbsUp,
  quote_sent: FileText,
  meeting: Users,
  call: Phone,
  note: FileText,
  consent_granted: ShieldCheck,
  consent_withdrawn: ShieldAlert,
};

type CrmT = Awaited<ReturnType<typeof getTranslations<"crm">>>;

export default async function ContactSheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const contactId = Number(decodeURIComponent(id));
  const t = await getTranslations("crm");

  if (!Number.isInteger(contactId) || contactId <= 0) {
    notFound();
  }

  const sheet = await getContactSheet(contactId).catch(() => null);
  if (!sheet) {
    notFound();
  }

  const { contact, email, phone, timeline, samples, chainVerified, sampleableLots } =
    sheet;

  return (
    <div className="space-y-6">
      <Link
        href="/crm"
        className="inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted-fg transition-colors hover:text-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t("sheet.back")}
      </Link>

      {/* header */}
      <div className="animate-rise relative mb-2 pb-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-fg">
          {t("sheet.eyebrow")}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
            {contact.name}
          </h1>
          <Badge tone="forest">{t(`kind.${contact.kind}`)}</Badge>
          <Badge tone={STATUS_TONE[contact.status]} dot>
            {t(`status.${contact.status}`)}
          </Badge>
          <span data-testid="chain-badge">
            <Badge tone={chainVerified ? "ok" : "warn"} dot>
              <span className="inline-flex items-center gap-1">
                {chainVerified ? (
                  <ShieldCheck className="h-3 w-3" aria-hidden />
                ) : (
                  <ShieldAlert className="h-3 w-3" aria-hidden />
                )}
                {chainVerified ? t("sheet.chainVerified") : t("sheet.chainBroken")}
              </span>
            </Badge>
          </span>
        </div>

        {/* fact strip */}
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-fg">
          {email && <Fact icon={Mail} value={email} />}
          {phone && <Fact icon={Phone} value={phone} />}
          {contact.countryCode && (
            <Fact icon={Globe} value={contact.countryCode} />
          )}
          {contact.buyerName && (
            <Fact icon={Building2} value={t("sheet.buyer") + ": " + contact.buyerName} />
          )}
          <Fact
            icon={Handshake}
            value={
              contact.consentMarketing && contact.unsubscribedAt == null
                ? t("sheet.consentOn")
                : t("sheet.consentOff")
            }
          />
        </div>

        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        {/* left rail: append-only timeline + read-only sample pipeline */}
        <div className="space-y-6">
          <section
            data-testid="contact-timeline"
            className="glass-card rounded-2xl p-5"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-display text-base font-semibold text-ink">
                {t("sheet.timelineTitle")}
              </h2>
              <span className="text-xs text-muted-fg">{t("sheet.timelineSub")}</span>
            </div>

            {timeline.length === 0 ? (
              <p className="mt-4 text-sm text-muted-fg">{t("sheet.timelineEmpty")}</p>
            ) : (
              <ol className="mt-4 space-y-0">
                {timeline.map((e, i) => {
                  const Icon = EVENT_ICON[e.kind] ?? FileText;
                  const note =
                    typeof e.payload?.note === "string" ? e.payload.note : null;
                  const lot =
                    typeof e.payload?.green_lot_code === "string"
                      ? e.payload.green_lot_code
                      : null;
                  return (
                    <li key={e.eventUid} className="relative flex gap-3 pb-5 last:pb-0">
                      {/* connector spine */}
                      {i < timeline.length - 1 && (
                        <span
                          aria-hidden
                          className="absolute left-[0.9375rem] top-8 bottom-0 w-px bg-line"
                        />
                      )}
                      <span className="z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/60 bg-forest-100/70 text-forest shadow-sm">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1 pt-0.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-sm font-medium text-ink">
                            {t(`event.${e.kind}`)}
                          </p>
                          <time className="shrink-0 text-xs tabular-nums text-muted-fg">
                            {longDate(e.occurredAt)}
                          </time>
                        </div>
                        {note && (
                          <p className="mt-0.5 truncate text-xs text-muted-fg">{note}</p>
                        )}
                        {lot && (
                          <p className="mt-0.5 text-xs tabular-nums text-forest">{lot}</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section
            data-testid="sample-pipeline"
            className="glass-card rounded-2xl p-5"
          >
            <h2 className="font-display text-base font-semibold text-ink">
              {t("sheet.samplesTitle")}
            </h2>
            {samples.length === 0 ? (
              <EmptyState
                icon={Beaker}
                title={t("sheet.samplesEmpty")}
                className="py-8"
              />
            ) : (
              <ul className="mt-4 space-y-3">
                {samples.map((s) => (
                  <SampleRow key={s.sampleId} sample={s} t={t} />
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* right rail: the one interactive island */}
        <ContactActions
          contactId={contact.contactId}
          samples={samples}
          sampleableLots={sampleableLots}
        />
      </div>
    </div>
  );
}

function Fact({
  icon: Icon,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">{value}</span>
    </span>
  );
}

const VERDICT_TONE: Record<string, BadgeTone> = {
  approved: "ok",
  rejected: "danger",
  counter: "warn",
};

function SampleRow({ sample, t }: { sample: SampleDispatchRow; t: CrmT }) {
  const verdict = sample.latestVerdict;
  const verdictKey =
    verdict === "approved"
      ? "sample.verdictApproved"
      : verdict === "rejected"
        ? "sample.verdictRejected"
        : verdict === "counter"
          ? "sample.verdictCounter"
          : "sample.verdictPending";
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl bg-paper/70 px-3 py-2.5">
      <div className="min-w-0">
        <p className="font-display text-sm font-semibold tabular-nums text-ink">
          {sample.greenLotCode}
        </p>
        <p className="text-xs text-muted-fg">
          <span className="tabular-nums">{t("sample.grams", { grams: num(sample.grams) })}</span>
          {" · "}
          {sample.scaGrade ?? t("sample.noGrade")}
          {sample.courier ? ` · ${sample.courier}` : ""}
        </p>
      </div>
      <Badge tone={verdict ? (VERDICT_TONE[verdict] ?? "neutral") : "neutral"} dot>
        {t(verdictKey)}
      </Badge>
    </li>
  );
}
