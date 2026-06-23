import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { JansonMark } from "@/components/layout/logo";
import { LoginForm } from "@/components/auth/login-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return {
    title: t("loginPage.metaTitle"),
  };
}

export default async function LoginPage() {
  const t = await getTranslations("auth");
  return (
    <main className="grid min-h-screen place-items-center bg-gradient-to-b from-forest-50 to-paper px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-forest text-paper shadow-[0_8px_24px_-8px_rgba(0,41,29,0.45)]">
            <JansonMark className="h-8 w-8" />
          </span>
          <h1 className="mt-4 font-display text-xl font-bold text-ink">
            Janson Coffee
          </h1>
          <p className="mt-1 text-sm text-muted-fg">
            {t("loginPage.tagline")}
          </p>
        </div>

        <div className="rounded-2xl border border-white/60 bg-white/70 p-6 shadow-[0_12px_40px_-12px_rgba(0,41,29,0.22)] backdrop-blur-xl">
          <LoginForm />
        </div>

        <p className="mt-6 text-center text-[11px] text-muted-fg">
          {t("loginPage.footer")}
        </p>
      </div>
    </main>
  );
}
