import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ClerkProvider } from "@clerk/nextjs";
import { siteUrl } from "../lib/site";
import { PwaManager } from "./components/pwa/PwaManager";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: "Fiszy | Pierwsza aukcja nadchodzi",
    template: "%s | Fiszy",
  },
  description: "Zostaw e-mail i dowiedz się jako pierwszy, kiedy wystartuje pierwsza aukcja Fiszy.",
  applicationName: "Fiszy",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Fiszy",
  },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "pl_PL",
    siteName: "Fiszy",
    title: "Fiszy | Pierwsza aukcja nadchodzi",
    description: "Coś zacznie spadać. Zostaw e-mail i dowiedz się pierwszy.",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Fiszy | Pierwsza aukcja nadchodzi",
    description: "Coś zacznie spadać. Zostaw e-mail i dowiedz się pierwszy.",
  },
  robots:
    process.env.VERCEL_ENV === "production"
      ? { index: true, follow: true }
      : { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pl">
      <body>
        <ClerkProvider>
          {children}
          <PwaManager />
        </ClerkProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
