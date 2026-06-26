"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ExternalLink, QrCode } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD, LABEL } from "@/components/ui/form-field";
import type { SkuCurationRow } from "./data";
import { publishProvenanceAction, unpublishProvenanceAction } from "./actions";

/**
 * CurationCard — the ONE interactive island in /(app)/provenance (the board stays a
 * Server Component). It curates a single SKU's public trace page: a publish/edit
 * dialog (slug + optional GTIN + the curated story, the only free text the public
 * ever sees) and an unpublish take-down confirm. Each action mints a client-side
 * idempotency key and calls the SECDEF RPC via the Server Action; on success the card
 * reflects the new published state optimistically (the `(app)` board also re-reads on
 * the next navigation under force-dynamic).
 */

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `pp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

export function CurationCard({ row }: { row: SkuCurationRow }) {
  const t = useTranslations("provenance");

  const [published, setPublished] = useState(row.isPublished);
  const [slug, setSlug] = useState(row.slug ?? "");
  const [gtin, setGtin] = useState(row.gtin ?? "");
  const [story, setStory] = useState(row.curatedStory ?? "");

  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const facets = [row.variety, row.process].filter(Boolean).join(" · ");

  async function onPublish() {
    setError(null);
    setPending(true);
    const result = await publishProvenanceAction({
      skuId: row.skuId,
      slug,
      gtin,
      curatedStory: story,
      idempotencyKey: newKey(),
    });
    setPending(false);
    if (result.ok) {
      setPublished(true);
      setEditOpen(false);
    } else {
      setError(result.error);
    }
  }

  async function onUnpublish() {
    setError(null);
    setPending(true);
    const result = await unpublishProvenanceAction({
      skuId: row.skuId,
      idempotencyKey: newKey(),
    });
    setPending(false);
    if (result.ok) {
      setPublished(false);
      setConfirmOpen(false);
    } else {
      setError(result.error);
    }
  }

  return (
    <div
      data-testid={`provenance-sku-${row.skuId}`}
      className="glass-card glass-hover perf-contain flex flex-col rounded-2xl p-5"
    >
      {/* header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-display text-base font-semibold text-ink">
            {row.productName ?? row.greenLotCode}
          </p>
          <p className="text-xs text-muted-fg">
            {t("admin.card.lot", { lot: row.greenLotCode })}
            {facets ? ` · ${facets}` : ""}
          </p>
        </div>
        <Badge tone={published ? "forest" : "neutral"} dot>
          {published ? t("admin.card.publishedTag") : t("admin.card.draftTag")}
        </Badge>
      </div>

      {/* slug / gtin line */}
      <div className="mt-3 space-y-1">
        {published && slug ? (
          <Link
            href={`/p/${encodeURIComponent(slug)}`}
            className="inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-forest transition-colors hover:text-forest-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
          >
            <span className="tabular-nums">{t("admin.card.slug", { slug })}</span>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </Link>
        ) : (
          <p className="text-sm text-muted-fg tabular-nums">
            {slug ? t("admin.card.slug", { slug }) : "—"}
          </p>
        )}
        <p className="flex items-center gap-1.5 text-xs text-muted-fg tabular-nums">
          <QrCode className="h-3.5 w-3.5" aria-hidden />
          {row.gtin ? row.gtin : t("admin.card.noGtin")}
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
        >
          {error}
        </p>
      )}

      {/* actions */}
      <div className="mt-4 flex items-center justify-end gap-2">
        {published && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirmOpen(true)}
          >
            {t("admin.card.unpublish")}
          </Button>
        )}
        <Button type="button" size="sm" onClick={() => setEditOpen(true)}>
          {published ? t("admin.card.edit") : t("admin.card.publish")}
        </Button>
      </div>

      {/* publish / edit dialog */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} title={t("admin.form.title")}>
        <div className="space-y-4">
          <p className="text-xs text-muted-fg">{t("admin.form.lot", { lot: row.greenLotCode })}</p>

          <div className="space-y-1">
            <label className={LABEL} htmlFor={`slug-${row.skuId}`}>
              {t("admin.form.slug")}
            </label>
            <input
              id={`slug-${row.skuId}`}
              type="text"
              className={FIELD}
              placeholder={t("admin.form.slugPlaceholder")}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
            <p className="text-xs text-muted-fg">{t("admin.form.slugHint")}</p>
          </div>

          <div className="space-y-1">
            <label className={LABEL} htmlFor={`gtin-${row.skuId}`}>
              {t("admin.form.gtin")}
            </label>
            <input
              id={`gtin-${row.skuId}`}
              type="text"
              inputMode="numeric"
              className={FIELD}
              placeholder={t("admin.form.gtinPlaceholder")}
              value={gtin}
              onChange={(e) => setGtin(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className={LABEL} htmlFor={`story-${row.skuId}`}>
              {t("admin.form.story")}
            </label>
            <textarea
              id={`story-${row.skuId}`}
              rows={3}
              className="w-full rounded-xl border border-line bg-white/70 px-3 py-2 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100"
              placeholder={t("admin.form.storyPlaceholder")}
              value={story}
              onChange={(e) => setStory(e.target.value)}
            />
            <p className="text-xs text-muted-fg">{t("admin.form.storyHint")}</p>
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
              {t("admin.form.cancel")}
            </Button>
            <Button type="button" disabled={pending || slug.trim() === ""} onClick={onPublish}>
              {pending ? t("admin.form.submitting") : t("admin.form.submit")}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* unpublish confirm */}
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t("admin.form.unpublishTitle")}
      >
        <div className="space-y-4">
          <p className="text-sm text-ink">{t("admin.form.unpublishBody")}</p>
          {error && (
            <p role="alert" className="rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              {t("admin.form.cancel")}
            </Button>
            <Button type="button" variant="secondary" disabled={pending} onClick={onUnpublish}>
              {pending ? t("admin.form.unpublishing") : t("admin.form.unpublishConfirm")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
