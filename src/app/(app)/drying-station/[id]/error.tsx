"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { CloudOff, RotateCw } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * /drying-station/[id] — dossier-scoped error boundary (P7). A section getter throw
 * surfaces a calm retry card inside the (app) shell rather than a raw stack trace.
 * Anchor-not-found is `notFound()` (a separate 404 path), never this boundary.
 */
export default function DryingStationDossierError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");
  useEffect(() => {
    console.error("/drying-station/[id] dossier error:", error);
  }, [error]);

  return (
    <div className="grid min-h-[60vh] place-items-center">
      <Card className="animate-rise w-full max-w-md text-center">
        <CardContent className="px-6 py-8">
          <div
            aria-hidden="true"
            className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-white/60 bg-white/55 text-muted-fg shadow-sm"
          >
            <CloudOff className="h-6 w-6" />
          </div>

          <h2 className="mt-4 font-display text-lg font-semibold text-ink">
            {t("error.dryingStation.title")}
          </h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-fg">
            {t("error.dryingStation.body")}
          </p>

          <div className="mt-6 flex items-center justify-center">
            <Button onClick={() => reset()}>
              <RotateCw className="h-4 w-4" />
              {t("error.dryingStation.retry")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
