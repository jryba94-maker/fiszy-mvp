import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ClerkProvider } from "@clerk/nextjs";
import { plPL } from "@clerk/localizations/pl-PL";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { siteUrl } from "../lib/site";
import { clerkAppearance } from "../lib/clerk-appearance";
import { PwaManager } from "./components/pwa/PwaManager";
import "./globals.css";

const fiszyLocalization = {
  ...plPL,
  signIn: {
    ...plPL.signIn,
    start: {
      ...plPL.signIn?.start,
      title: "Witaj ponownie",
      subtitle: "Zaloguj się do swojego konta Fiszy.",
    },
  },
  signUp: {
    ...plPL.signUp,
    start: {
      ...plPL.signUp?.start,
      title: "Dołącz do Fiszy",
      subtitle: "Załóż konto i zachowaj swoją historię aukcji.",
    },
  },
};

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
    <html lang="pl" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className={GeistSans.className}>
        <ClerkProvider localization={fiszyLocalization} appearance={clerkAppearance}>
          {children}
          <PwaManager />
        </ClerkProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
