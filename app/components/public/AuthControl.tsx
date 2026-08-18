"use client";

import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import styles from "./public.module.css";

export function AuthControl() {
  return (
    <div className={styles.authControl}>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button className={styles.signInButton} type="button">Zaloguj się</button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <UserButton appearance={{ elements: { avatarBox: styles.userAvatar } }} />
      </Show>
    </div>
  );
}
