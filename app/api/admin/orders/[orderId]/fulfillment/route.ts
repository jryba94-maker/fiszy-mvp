import { NextRequest, NextResponse } from "next/server";
import {
  hasAdminPermission,
  hasValidAdminRequest,
  isAdminConfigured,
  isSameOriginAdminMutation,
  verifiedAdminActorType,
} from "../../../../../../lib/admin-auth";
import {
  fulfillmentResponse,
  listFulfillmentHistory,
  prepareFulfillmentPatch,
  readOrderFulfillment,
  updateOrderFulfillment,
} from "../../../../../../lib/fulfillment-storage";
import {
  normalizeOrderId,
  readAuctionOrderById,
} from "../../../../../../lib/order-storage";
import { errorDetails, logEvent } from "../../../../../../lib/observability";
import { looksLikeSortedSetCursor } from "../../../../../../lib/sorted-set-pagination";
import { readAccountProfile } from "../../../../../../lib/portal-storage";
import { enqueueTransactionalMessage, processMessageOutbox } from "../../../../../../lib/message-outbox";
import { absoluteSiteUrl } from "../../../../../../lib/site";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ orderId: string }> };

function authError(request: NextRequest) {
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

function actorType(request: NextRequest) {
  const actor = verifiedAdminActorType(request);
  if (!actor) throw new Error("Admin request is no longer authenticated.");
  return actor;
}

async function requestedOrderId(context: Context) {
  const { orderId: rawOrderId } = await context.params;
  return normalizeOrderId(rawOrderId);
}

export async function GET(request: NextRequest, context: Context) {
  const error = authError(request);
  if (error) return error;

  const orderId = await requestedOrderId(context);
  const historyCursor = request.nextUrl.searchParams.get("historyCursor");
  const historyLimitValue = request.nextUrl.searchParams.get("historyLimit");
  const historyLimit = historyLimitValue === null ? 20 : Number(historyLimitValue);
  if (
    !orderId ||
    (historyCursor !== null && !looksLikeSortedSetCursor(historyCursor)) ||
    !Number.isInteger(historyLimit) ||
    historyLimit < 1 ||
    historyLimit > 50
  ) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  try {
    const order = await readAuctionOrderById(orderId);
    if (!order) {
      return NextResponse.json({ outcome: "not_found" }, { status: 404 });
    }
    const [fulfillment, historyPage] = await Promise.all([
      readOrderFulfillment(order),
      listFulfillmentHistory({
        orderId,
        cursor: historyCursor,
        limit: historyLimit,
      }),
    ]);
    if (!historyPage) {
      return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    }

    return NextResponse.json(
      {
        outcome: "ok",
        orderId,
        fulfillment: fulfillmentResponse(fulfillment),
        history: historyPage.history,
        nextHistoryCursor: historyPage.nextCursor,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (caught) {
    logEvent("admin_order_fulfillment_read_failed", errorDetails(caught), "error");
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const error = authError(request);
  if (error) return error;
  if (!hasAdminPermission(request, "orders:write")) {
    return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  }
  if (!isSameOriginAdminMutation(request)) {
    return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  }

  const orderId = await requestedOrderId(context);
  if (!orderId) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  try {
    const order = await readAuctionOrderById(orderId);
    if (!order) {
      return NextResponse.json({ outcome: "not_found" }, { status: 404 });
    }
    const current = await readOrderFulfillment(order);
    const prepared = prepareFulfillmentPatch(current, body);
    if (!prepared.ok) {
      if (prepared.outcome === "fulfillment_changed") {
        return NextResponse.json(
          {
            outcome: prepared.outcome,
            fulfillment: fulfillmentResponse(current),
          },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { outcome: prepared.outcome },
        { status: prepared.outcome === "invalid_transition" ? 409 : 400 },
      );
    }

    const result = await updateOrderFulfillment({
      order,
      current,
      patch: prepared.value,
      actorType: actorType(request),
    });
    if (result.outcome === "updated") {
      logEvent("admin_order_fulfillment_updated", {
        orderId,
        status: result.fulfillment.status,
        revision: result.fulfillment.revision,
      });
      let emailNotification: "sent" | "queued" | "skipped" | "failed" = "skipped";
      const accountId = order.bidderId.startsWith("clerk:")
        ? order.bidderId.slice("clerk:".length)
        : null;
      const recipient = order.customer.email;
      if (accountId && recipient) {
        try {
          const profile = await readAccountProfile(accountId);
          if (profile?.preferences.emailOrderUpdates !== false) {
            const labels = {
              new: "Zamówienie przyjęte",
              preparing: "Przygotowujemy Twoje zamówienie",
              shipped: "Twoje zamówienie zostało wysłane",
              delivered: "Zamówienie zostało dostarczone",
            } as const;
            const tracking = result.fulfillment.tracking
              ? `\nPrzewoźnik: ${result.fulfillment.tracking.carrier}\nNumer przesyłki: ${result.fulfillment.tracking.trackingNumber}`
              : "";
            await enqueueTransactionalMessage({
              dedupeKey: `order.fulfillment.${order.orderId}.${result.fulfillment.revision}`,
              accountId,
              recipient,
              template: "order_update",
              title: labels[result.fulfillment.status],
              text: `${order.product}\nZamówienie: ${order.orderId}${tracking}`,
              actionLabel: "Sprawdź zamówienie",
              actionUrl: absoluteSiteUrl("/moje-fiszy#historia"),
            });
            const processed = await processMessageOutbox({ limit: 10 });
            emailNotification = processed?.delivered ? "sent" : "queued";
          }
        } catch (emailError) {
          emailNotification = "failed";
          logEvent("order_fulfillment_email_failed", {
            orderId,
            status: result.fulfillment.status,
            ...errorDetails(emailError),
          }, "warning");
        }
      }
      return NextResponse.json({
        outcome: "updated",
        fulfillment: fulfillmentResponse(result.fulfillment),
        auditEventId: result.auditEvent.eventId,
        emailNotification,
      });
    }
    if (result.outcome === "not_found") {
      return NextResponse.json({ outcome: "not_found" }, { status: 404 });
    }
    if (result.outcome === "fulfillment_changed") {
      const latest = await readOrderFulfillment(order);
      return NextResponse.json(
        {
          outcome: "fulfillment_changed",
          fulfillment: fulfillmentResponse(latest),
        },
        { status: 409 },
      );
    }

    logEvent("admin_order_fulfillment_update_failed", {
      orderId,
      outcome: result.outcome,
    }, "error");
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  } catch (caught) {
    logEvent(
      "admin_order_fulfillment_update_failed",
      errorDetails(caught),
      "error",
    );
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
