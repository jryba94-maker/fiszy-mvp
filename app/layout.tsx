import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { siteUrl } from "../lib/site";
import "./globals.css";

const brandDescription =
  "Fiszy to platforma zakupowa oparta na aukcjach holenderskich, w których cena produktu spada w czasie, a pierwsza osoba, która zdecyduje się kupić po aktualnej cenie, wygrywa aukcję.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: "Fiszy — aukcje, w których cena spada",
    template: "%s | Fiszy",
  },
  description: brandDescription,
  applicationName: "Fiszy",
  keywords: [
    "Fiszy",
    "aukcja holenderska",
    "aukcje holenderskie",
    "aukcja ze spadającą ceną",
    "aukcje z malejącą ceną",
  ],
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Fiszy",
  },
  openGraph: {
    type: "website",
    locale: "pl_PL",
    siteName: "Fiszy",
    title: "Fiszy — aukcje, w których cena spada",
    description: brandDescription,
  },
  twitter: {
    card: "summary_large_image",
    title: "Fiszy — aukcje, w których cena spada",
    description: brandDescription,
  },
  robots:
    process.env.VERCEL_ENV === "production"
      ? { index: true, follow: true }
      : { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${siteUrl()}/#organization`,
        name: "Fiszy",
        url: siteUrl(),
        description: brandDescription,
        sameAs: ["https://www.instagram.com/fiszy.pl/"],
      },
      {
        "@type": "WebSite",
        "@id": `${siteUrl()}/#website`,
        url: siteUrl(),
        name: "Fiszy",
        inLanguage: "pl-PL",
        publisher: { "@id": `${siteUrl()}/#organization` },
        description: brandDescription,
      },
    ],
  };

  return (
    <html lang="pl" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className={GeistSans.className}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
