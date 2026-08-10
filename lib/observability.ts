type LogLevel = "info" | "warning" | "error";

type LogDetails = Record<
  string,
  string | number | boolean | null | undefined
>;

export function errorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      errorName: error.name.slice(0, 120),
      errorMessage: error.message.slice(0, 500),
    };
  }

  return { errorName: "UnknownError", errorMessage: "Unknown error" };
}

export function logEvent(
  event: string,
  details: LogDetails = {},
  level: LogLevel = "info",
) {
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    service: "fiszy-web",
    environment: process.env.VERCEL_ENV ?? "local",
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
    event,
    ...details,
  });

  if (level === "error") {
    console.error(payload);
  } else if (level === "warning") {
    console.warn(payload);
  } else {
    console.info(payload);
  }
}
