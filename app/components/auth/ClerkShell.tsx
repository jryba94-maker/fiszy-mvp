import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { plPL } from "@clerk/localizations/pl-PL";
import { clerkAppearance } from "../../../lib/clerk-appearance";
import { PwaManager } from "../pwa/PwaManager";

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

export function ClerkShell({
  children,
  pwa = false,
}: {
  children: ReactNode;
  pwa?: boolean;
}) {
  return (
    <ClerkProvider localization={fiszyLocalization} appearance={clerkAppearance}>
      {children}
      {pwa ? <PwaManager /> : null}
    </ClerkProvider>
  );
}
