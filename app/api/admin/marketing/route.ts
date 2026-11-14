import { NextRequest, NextResponse } from "next/server";
import { hasAdminPermission, isAdminConfigured, isSameOriginAdminMutation } from "../../../../lib/admin-auth";
import { runMarketingAgents } from "../../../../lib/marketing-agents";
import { latestMarketingWorkflow, saveMarketingWorkflow } from "../../../../lib/marketing-agent-storage";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAdminConfigured()) return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  if (!hasAdminPermission(request, "audit:read")) return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  try {
    return NextResponse.json({ outcome: "ok", workflow: await latestMarketingWorkflow() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (!isAdminConfigured()) return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  if (!hasAdminPermission(request, "audit:read")) return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  if (!isSameOriginAdminMutation(request)) return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const fields = ["brief", "motive", "audience", "cta", "auctionProduct", "auctionStartsAt", "communityNotes"] as const;
    const input = Object.fromEntries(fields.map((field) => [field, typeof body[field] === "string" ? body[field].trim() : ""])) as Record<(typeof fields)[number], string>;
    if (["brief", "motive", "audience", "cta"].some((field) => !input[field as keyof typeof input]) || fields.some((field) => input[field].length > 1600)) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    const messages = await runMarketingAgents(input);
    const workflow = await saveMarketingWorkflow({ ...input, messages });
    return NextResponse.json({ outcome: "ok", workflow });
  } catch (error) {
    console.error("Unable to run marketing workflow.", error);
    return NextResponse.json({ outcome: "marketing_agent_error", message: error instanceof Error ? error.message : "Nie udało się uruchomić obiegu." }, { status: 503 });
  }
}
