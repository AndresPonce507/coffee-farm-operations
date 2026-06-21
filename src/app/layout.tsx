import type { Metadata, Viewport } from "next";
import { Inter, Quicksand } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegistrar } from "@/components/layout/sw-register";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const quicksand = Quicksand({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-quicksand",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Janson Coffee — Farm Operations",
  description:
    "Operations console for Janson Coffee, Volcán, Chiriquí — plots, harvests, processing, labor and tasks. From our farm to your cup since 1990.",
  // PWA manifest (P2-S0) — makes the app installable + field-trustworthy offline.
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Janson Coffee",
  },
  icons: {
    icon: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

// The installed-app theme + safe-area viewport (P2-S0).
export const viewport: Viewport = {
  themeColor: "#00291d",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${quicksand.variable}`}>
      <body>
        <ServiceWorkerRegistrar />
        {children}
      </body>
    </html>
  );
}
