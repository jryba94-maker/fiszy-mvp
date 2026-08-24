import type { ReactNode } from "react";
import { ClerkShell } from "../components/auth/ClerkShell";

export default function SignInLayout({ children }: { children: ReactNode }) {
  return <ClerkShell>{children}</ClerkShell>;
}
