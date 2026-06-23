import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { defaultLocale, isLocale, LOCALE_COOKIE, NAMESPACES, type Locale } from "./config";

/**
 * next-intl request config — resolves the active locale from the NEXT_LOCALE cookie
 * (falling back to the default) and assembles the per-namespace message tree.
 *
 * The dynamic `import()` paths are statically analyzable (constant prefix/suffix), so
 * the bundler builds a context over messages/{en,es}/*.json. Every namespace file in
 * NAMESPACES must exist on disk (even as `{}`) or the import throws.
 */
export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieValue = store.get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(cookieValue) ? cookieValue : defaultLocale;

  const entries = await Promise.all(
    NAMESPACES.map(async (ns) => {
      const mod = await import(`../../messages/${locale}/${ns}.json`);
      return [ns, mod.default] as const;
    }),
  );

  return { locale, messages: Object.fromEntries(entries) };
});
