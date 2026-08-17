import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  type AuctionConfig,
  type AuctionRecord,
  normalizeAuctionId,
  parseAuctionDefinition,
} from "../../../../lib/auction";
import {
  createAuctionRecord,
  createAuctionWithRun,
} from "../../../../lib/auction-storage";
import { listAdminAuctions } from "../../../../lib/auction-view";
import {
  hasValidAdminRequest,
  isAdminConfigured,
  isSameOriginAdminMutation,
} from "../../../../lib/admin-auth";
import { recordSuccessfulAdminAudit } from "../../../../lib/admin-audit";
import { errorDetails, logEvent } from "../../../../lib/observability";
import { looksLikeSortedSetCursor } from "../../../../lib/sorted-set-pagination";

export const dynamic = "force-dynamic";

const START_DELAY_MS = 60_000;

function unauthorized(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { outcome: "admin_not_configured" },
      { status: 503 },
    );
  }
  if (!hasValidAdminRequest(request)) {
    return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const authError = unauthorized(request);
  if (authError) return authError;

  const cursor = request.nextUrl.searchParams.get("cursor");
  const limitValue = request.nextUrl.searchParams.get("limit");
  const limit = limitValue === null ? 20 : Number(limitValue);
  if (
    (cursor !== null && !looksLikeSortedSetCursor(cursor)) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50
  ) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  try {
    const page = await listAdminAuctions({ cursor, limit });
    if (!page) {
      return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    }
    return NextResponse.json(
      { outcome: "ok", ...page },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logEvent("admin_auction_list_failed", errorDetails(error), "error");
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const authError = unauthorized(request);
  if (authError) return authError;
  if (!isSameOriginAdminMutation(request)) {
    return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  const definition = parseAuctionDefinition(body);
  const hasStartsAt =
    body.startsAt !== undefined && body.startsAt !== null && body.startsAt !== "";
  const requestedState = body.state ?? (hasStartsAt ? "published" : "draft");
  if (
    !definition ||
    (requestedState !== "draft" && requestedState !== "published")
  ) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  let startsAt: Date | null = null;
  if (hasStartsAt) {
    if (typeof body.startsAt !== "string") {
      return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    }
    startsAt = new Date(body.startsAt);
    if (!Number.isFinite(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
      return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    }
  } else if (requestedState === "published") {
    startsAt = new Date(Date.now() + START_DELAY_MS);
  }

  const requestedId = body.auctionId ?? body.slug;
  const auctionId =
    requestedId === undefined || requestedId === null || requestedId === ""
      ? randomUUID()
      : normalizeAuctionId(requestedId);
  if (!auctionId) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const runId = startsAt ? randomUUID() : null;
  const record: AuctionRecord = {
    schemaVersion: 1,
    auctionId,
    state: requestedState,
    currentRunId: runId,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    ...definition,
  };

  try {
    let result: number | null;
    let config: AuctionConfig | null = null;
    if (startsAt && runId) {
      config = {
        schemaVersion: 2,
        runId,
        startsAt: startsAt.toISOString(),
        ...definition,
      };
      result = await createAuctionWithRun(record, config);
    } else {
      result = await createAuctionRecord(record);
    }

    if (result === 0) {
      return NextResponse.json({ outcome: "auction_exists" }, { status: 409 });
    }
    if (result !== 1) {
      return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
    }

    logEvent("admin_auction_created", {
      auctionId,
      state: record.state,
      scheduled: Boolean(config),
    });
    const auditEventId = await recordSuccessfulAdminAudit(request, {
      action: "auction.created",
      resourceType: "auction",
      resourceId: auctionId,
      details: {
        state: record.state,
        scheduled: Boolean(config),
        revision: record.revision,
      },
    });

    return NextResponse.json(
      { outcome: "created", record, config, auditEventId },
      { status: 201 },
    );
  } catch (error) {
    logEvent("admin_auction_create_failed", errorDetails(error), "error");
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
