import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Fiszy | Aukcje, w których cena spada",
    template: "%s | Fiszy",
  },
  description: "Wejdź do aukcji, obserwuj spadającą cenę i kup jednym kliknięciem.",
  applicationName: "Fiszy",
  robots:
    process.env.VERCEL_ENV === "production"
      ? { index: true, follow: true }
      : { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pl">
      <body>
        <ClerkProvider>{children}</ClerkProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
