import { NextResponse } from "next/server";
import { redisCommand } from "../../../lib/redis";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  let storage = "unavailable" as "ready" | "unavailable";

  try {
    if ((await redisCommand<string>(["PING"])) === "PONG") {
      storage = "ready";
    }
  } catch {
    // Public health response intentionally contains no infrastructure details.
  }

  const healthy = storage === "ready";
  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      storage,
      responseTimeMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store, max-age=0" },
    },
  );
}
