"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { CloudOff, RotateCw } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary for the /dispatch/[id] dossier.
 *
 * The dossier getter throws when Supabase is unreachable (the free-tier project
 * auto-pauses after inactivity). This renders INSIDE the (app) layout so the farm
 * shows a calm, on-brand "couldn't load" card with a retry — never a raw stack
 * trace. An unknown run id is handled by notFound() in the page (a real 404), not
 * here; this boundary is only for read failures.
 */
export default function DispatchDossierError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");
  useEffect(() => {
    console.error("/dispatch/[id] dossier error:", error);
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
            {t("error.dispatch.title")}
          </h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-fg">
            {t("error.dispatch.body")}
          </p>

          <div className="mt-6 flex items-center justify-center">
            <Button onClick={() => reset()}>
              <RotateCw className="h-4 w-4" />
              {t("error.dispatch.retry")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
