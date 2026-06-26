"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { locales, LOCALE_LABEL, type Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";

/**
 * LanguageToggle — the EN⇄ES switch in the topbar (next to the owner chip). Sets the
 * NEXT_LOCALE cookie via a server action, then router.refresh() re-renders every
 * Server Component in the new language with no full reload and no URL change.
 */
export function LanguageToggle() {
  const active = useLocale() as Locale;
  const router = useRouter();
  const t = useTranslations("layout");
  const [pending, startTransition] = useTransition();

  function choose(loc: Locale) {
    if (loc === active || pending) return;
    startTransition(async () => {
      // Server action writes the cookie; refresh re-renders the RSC tree in `loc`.
      const { setLocale } = await import("@/i18n/locale-actions");
      await setLocale(loc);
      router.refresh();
    });
  }

  return (
    <div
      role="group"
      aria-label={t("languageToggle")}
      className="inline-flex rounded-xl border border-line bg-card p-0.5"
    >
      {locales.map((loc) => (
        <button
          key={loc}
          type="button"
          onClick={() => choose(loc)}
          aria-pressed={loc === active}
          aria-label={LOCALE_LABEL[loc]}
          disabled={pending}
          className={cn(
            "rounded-lg px-2 py-1 text-[11px] font-semibold uppercase transition-colors outline-none",
            "focus-visible:ring-2 focus-visible:ring-forest/40 disabled:opacity-60",
            loc === active
              ? "bg-forest text-paper"
              : "text-muted-fg hover:text-ink",
          )}
        >
          {loc}
        </button>
      ))}
    </div>
  );
}
