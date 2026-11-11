import { NextRequest, NextResponse } from "next/server";
import { applyResendDeliveryEvent, type OutboxMessage } from "../../../../lib/message-outbox";
import { recordCampaignDelivery } from "../../../../lib/campaign-delivery";
import { verifyResendWebhook } from "../../../../lib/resend-webhook";

export const dynamic = "force-dynamic";
const TYPES: Record<string, NonNullable<OutboxMessage["deliveryStatus"]>> = {
  "email.sent": "sent", "email.delivered": "delivered", "email.delivery_delayed": "delayed",
  "email.bounced": "bounced", "email.failed": "failed", "email.suppressed": "suppressed", "email.complained": "complained",
};

export async function POST(request: NextRequest) {
  const payload = await request.text();
  const id = request.headers.get("svix-id") ?? "";
  const timestamp = request.headers.get("svix-timestamp") ?? "";
  const signature = request.headers.get("svix-signature") ?? "";
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim() ?? "";
  if (!verifyResendWebhook({ payload, id, timestamp, signature, secret })) return NextResponse.json({ outcome: "invalid_signature" }, { status: 400 });
  let event: unknown;
  try { event = JSON.parse(payload); } catch { return NextResponse.json({ outcome: "invalid_payload" }, { status: 400 }); }
  const value = event as { type?: unknown; created_at?: unknown; data?: { email_id?: unknown; tags?: { fiszy_campaign?: unknown } } };
  const status = typeof value.type === "string" ? TYPES[value.type] : null;
  const campaignId = value.data?.tags?.fiszy_campaign;
  if (!status && !campaignId) return NextResponse.json({ outcome: "ignored" });
  if (typeof value.created_at !== "string" || typeof value.data?.email_id !== "string") return NextResponse.json({ outcome: "invalid_payload" }, { status: 400 });
  try {
    if (campaignId && typeof value.type === "string" && await recordCampaignDelivery({ campaignId, providerMessageId: value.data.email_id, type: value.type })) {
      return NextResponse.json({ outcome: "campaign_updated" });
    }
    if (!status) return NextResponse.json({ outcome: "ignored" });
    const result = await applyResendDeliveryEvent({ eventId: id, providerMessageId: value.data.email_id, status, occurredAt: value.created_at });
    return NextResponse.json({ outcome: result?.outcome ?? "invalid_payload" }, { status: result ? 200 : 400 });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "resend_webhook_failed", eventId: id, error: error instanceof Error ? error.message : String(error) }));
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
