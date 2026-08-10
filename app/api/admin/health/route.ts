import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const adminSecretConfigured = Boolean(process.env.FISZY_ADMIN_SECRET);
  const redisUrlConfigured = Boolean(
    process.env.STORAGE_KV_REST_API_URL ||
      process.env.KV_REST_API_URL ||
      process.env.UPSTASH_REDIS_REST_URL,
  );
  const redisTokenConfigured = Boolean(
    process.env.STORAGE_KV_REST_API_TOKEN ||
      process.env.KV_REST_API_TOKEN ||
      process.env.UPSTASH_REDIS_REST_TOKEN,
  );

  return NextResponse.json(
    {
      environment: process.env.VERCEL_ENV ?? "unknown",
      adminSecretConfigured,
      redisConfigured: redisUrlConfigured && redisTokenConfigured,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
