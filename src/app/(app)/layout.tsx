import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { LivingBackground } from "@/components/layout/living-background";

// Sections read live from Supabase at request time. Dynamic rendering keeps the
// build DB-free and always serves fresh farm data. (Swap to `revalidate` for ISR.)
export const dynamic = "force-dynamic";

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen">
      <LivingBackground />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-5 py-7 md:px-8 md:py-9">
          {children}
        </main>
      </div>
    </div>
  );
}
