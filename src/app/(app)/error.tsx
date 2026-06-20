"use client";

import { useEffect } from "react";
import { CloudOff, RotateCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary for the (app) shell.
 *
 * The app is `force-dynamic` and every src/lib/db/*.ts getter throws when
 * Supabase is unreachable — a free-tier project auto-pauses after ~7 days of
 * inactivity, which would otherwise drop the bare unstyled Next.js 500 page on
 * the whole route. This renders INSIDE the (app) layout (sidebar/topbar stay),
 * so the farm just shows a calm, on-brand "couldn't load" card with a retry —
 * never a raw stack trace.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Keep the detail in the console for us; never surface it to the farmer.
    console.error("(app) route error:", error);
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
            We couldn&apos;t load the farm data right now
          </h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-fg">
            The connection to the farm records dropped for a moment. This is
            usually temporary — give it another try.
          </p>

          <div className="mt-6 flex items-center justify-center">
            <Button onClick={() => reset()}>
              <RotateCw className="h-4 w-4" />
              Try again
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
