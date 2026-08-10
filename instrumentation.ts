import { logEvent } from "./lib/observability";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    logEvent("application_runtime_started", {
      nodeVersion: process.version,
    });
  }
}
