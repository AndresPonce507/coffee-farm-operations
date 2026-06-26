"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD, LABEL } from "@/components/ui/form-field";
import { createAuctionAction } from "./actions";
import type { AuctionPlatform } from "./data";

/**
 * NewAuctionButton — the one client island on the board. Opens a glass dialog to
 * start an auction (platform + name + deadlines), commits via create_auction, and on
 * success routes to the fresh auction's workspace. A header carries no inventory, so
 * there's no money-shaped confirm here — just the create.
 */

const PLATFORMS: AuctionPlatform[] = [
  "best_of_panama",
  "cup_of_excellence",
  "algrano",
  "private",
];

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `a_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

export function NewAuctionButton() {
  const t = useTranslations("auctions");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<AuctionPlatform>("best_of_panama");
  const [name, setName] = useState("");
  const [entryDeadline, setEntryDeadline] = useState("");
  const [scoringDeadline, setScoringDeadline] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCreate() {
    setError(null);
    setPending(true);
    const result = await createAuctionAction({
      platform,
      name,
      entryDeadline: entryDeadline.trim() === "" ? null : entryDeadline,
      scoringDeadline: scoringDeadline.trim() === "" ? null : scoringDeadline,
      idempotencyKey: newKey(),
    });
    setPending(false);
    if (result.ok) {
      setOpen(false);
      setName("");
      router.push(`/sales/auctions/${result.auctionId}`);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden />
        {t("new.open")}
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title={t("new.title")}>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className={LABEL} htmlFor="na-platform">
              {t("new.platformLabel")}
            </label>
            <select
              id="na-platform"
              className={FIELD}
              value={platform}
              onChange={(e) => setPlatform(e.target.value as AuctionPlatform)}
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {t(`platform.${p}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className={LABEL} htmlFor="na-name">
              {t("new.nameLabel")}
            </label>
            <input
              id="na-name"
              type="text"
              className={FIELD}
              placeholder={t("new.namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className={LABEL} htmlFor="na-entry">
                {t("new.entryDeadlineLabel")}
              </label>
              <input
                id="na-entry"
                type="date"
                className={FIELD}
                value={entryDeadline}
                onChange={(e) => setEntryDeadline(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className={LABEL} htmlFor="na-scoring">
                {t("new.scoringDeadlineLabel")}
              </label>
              <input
                id="na-scoring"
                type="date"
                className={FIELD}
                value={scoringDeadline}
                onChange={(e) => setScoringDeadline(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
            >
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("new.cancel")}
            </Button>
            <Button
              type="button"
              disabled={pending || name.trim() === ""}
              onClick={onCreate}
            >
              {pending ? t("new.creating") : t("new.create")}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
