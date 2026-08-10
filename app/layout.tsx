import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Fiszy",
  description: "Fiszy MVP w budowie",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}

