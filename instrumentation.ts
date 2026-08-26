import * as Sentry from "@sentry/nextjs";
import { logEvent } from "./lib/observability";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    logEvent("application_runtime_started", {
      nodeVersion: process.version,
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
