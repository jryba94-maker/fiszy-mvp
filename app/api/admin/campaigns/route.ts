import { NextRequest, NextResponse } from "next/server";
import { hasAdminPermission, hasValidAdminRequest, isAdminConfigured, isSameOriginAdminMutation } from "../../../../lib/admin-auth";
import { CampaignError, campaignAudience, campaignSendingConfigured, campaignTestRecipient, changeCampaign, listCampaigns, processCampaign, readCampaignStats, saveCampaign, testCampaign } from "../../../../lib/email-campaigns";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(payload: object, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "private, no-store" } });
}

function failure(error: unknown) {
  if (error instanceof CampaignError) return json({ outcome: error.code }, error.status);
  console.error("Campaign operation failed.");
  return json({ outcome: "storage_or_provider_error" }, 503);
}

function authorize(request: NextRequest, write: boolean) {
  if (!isAdminConfigured()) return json({ outcome: "admin_not_configured" }, 503);
  if (!hasValidAdminRequest(request)) return json({ outcome: "unauthorized" }, 401);
  if (!hasAdminPermission(request, write ? "marketing:write" : "audit:read")) return json({ outcome: "forbidden" }, 403);
  if (write && !isSameOriginAdminMutation(request)) return json({ outcome: "invalid_origin" }, 403);
  return null;
}

export async function GET(request: NextRequest) {
  const error = authorize(request, false);
  if (error) return error;
  try {
    const statsId = request.nextUrl.searchParams.get("stats");
    if (statsId !== null) return json({ outcome: "ok", stats: await readCampaignStats(statsId) });
    const segment = request.nextUrl.searchParams.get("segment");
    if (segment !== null) {
      if (segment !== "all" && segment !== "recent" && segment !== "waitlist" && segment !== "press") return json({ outcome: "invalid_segment" }, 400);
      return json({ outcome: "ok", eligible: (await campaignAudience(segment)).length });
    }
    return json({ outcome: "ok", campaigns: await listCampaigns(), sendingConfigured: campaignSendingConfigured(), testConfigured: Boolean(campaignTestRecipient()) });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  const error = authorize(request, true);
  if (error) return error;
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 48_000) return json({ outcome: "invalid_request" }, 400);
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return json({ outcome: "invalid_request" }, 400);
    body = data as Record<string, unknown>;
  } catch { return json({ outcome: "invalid_request" }, 400); }
  try {
    const id = typeof body.id === "string" ? body.id : undefined;
    if (body.action === "save") return json({ outcome: "ok", campaign: await saveCampaign(body.content, id, body.revision) });
    if (!id) return json({ outcome: "invalid_request" }, 400);
    if (body.action === "test") {
      await testCampaign(id);
      return json({ outcome: "ok" });
    }
    if (body.action === "process") return json({ outcome: "ok", campaign: await processCampaign(id) });
    if (typeof body.action !== "string" || !["queue", "pause", "resume", "cancel"].includes(body.action)) return json({ outcome: "invalid_request" }, 400);
    return json({ outcome: "ok", campaign: await changeCampaign(id, body.revision, body.action, body.scheduledAt) });
  } catch (error) { return failure(error); }
}
