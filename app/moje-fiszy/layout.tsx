import type { ReactNode } from "react";
import { ClerkShell } from "../components/auth/ClerkShell";

export default function AccountLayout({ children }: { children: ReactNode }) {
  return <ClerkShell pwa>{children}</ClerkShell>;
}
