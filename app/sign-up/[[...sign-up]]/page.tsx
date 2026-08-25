import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import styles from "../../auth.module.css";

export default function SignUpPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.brand} href="/" aria-label="Fiszy — strona główna">Fiszy<span>.</span></Link>
        <SignUp />
      </div>
    </main>
  );
}
