import type { ReactNode } from "react";
import { ClerkShell } from "../components/auth/ClerkShell";

export default function SignUpLayout({ children }: { children: ReactNode }) {
  return <ClerkShell>{children}</ClerkShell>;
}
