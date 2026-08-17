import { clerkMiddleware } from "@clerk/nextjs/server";

// Logowanie jest dostępne w całym portalu, ale nie blokuje jeszcze aukcji ani
// istniejącego panelu administracyjnego. Ich bezpieczne powiązanie z kontem
// użytkownika będzie osobnym etapem migracji danych.
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
