"use server";

import { cookies } from "next/headers";

import { isLocale, LOCALE_COOKIE, type Locale } from "./config";

/**
 * Persist the chosen UI language to the NEXT_LOCALE cookie. The toggle calls this and
 * then `router.refresh()`s, so every Server Component re-renders in the new locale
 * with no full reload and no URL change. One year, lax, httpOnly off (no secret — the
 * client toggle reads it to show the active state).
 */
export async function setLocale(locale: Locale): Promise<void> {
  if (!isLocale(locale)) return;
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
