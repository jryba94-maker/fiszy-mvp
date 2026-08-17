import { NextRequest, NextResponse } from "next/server";
import { currentAccountIdentity } from "../../../../lib/account-auth";
import {
  consumeAccountRateLimit,
  createSupportTicket,
  listAccountTickets,
  normalizeSupportTicketInput,
} from "../../../../lib/portal-storage";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const identity = await currentAccountIdentity();
  if (!identity) return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  const cursor = request.nextUrl.searchParams.get("cursor");
  try {
    const page = await listAccountTickets({ accountId: identity.accountId, cursor, limit: 20 });
    if (!page) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    return NextResponse.json(
      { outcome: "ok", ...page },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    console.error("Unable to read account support tickets.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const identity = await currentAccountIdentity();
  if (!identity) return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  try {
    if (!(await consumeAccountRateLimit({ accountId: identity.accountId, action: "support", limit: 5, windowSeconds: 600 }))) {
      return NextResponse.json({ outcome: "rate_limited" }, { status: 429, headers: { "Retry-After": "600" } });
    }
  } catch {
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }
  const input = normalizeSupportTicketInput(body);
  if (!input) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  try {
    const ticket = await createSupportTicket({ accountId: identity.accountId, ...input });
    return NextResponse.json({ outcome: "created", ticket }, { status: 201 });
  } catch (error) {
    console.error("Unable to create account support ticket.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
