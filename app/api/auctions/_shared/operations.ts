import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  ENTRY_FEE,
  LEGACY_AUCTION_ID,
  getAuctionEndsAt,
  getTimedAuctionState,
  normalizeAuctionId,
  normalizeRunId,
} from "../../../../lib/auction";
import {
  attachAuctionWinnerCheckout,
  claimAuctionWinnerIfCurrent,
  readAuctionEntry,
  readAuctionRecord,
  readAuctionWinner,
  readOptionalAuctionConfig,
  releaseAuctionWinner,
  type AuctionWinner,
} from "../../../../lib/auction-storage";
import { getCheckoutOrigin } from "../../../../lib/request-origin";
import { consumeEntryCheckoutRateLimit } from "../../../../lib/public-rate-limit";
import {
  createEntryPaymentSession,
  createPurchasePaymentSession,
  configuredPaymentProvider,
  expirePaymentSession,
  isPaymentProviderConfigured,
} from "../../../../lib/payment-provider";
import { ensureAccountProfile, isAccountBlocked } from "../../../../lib/portal-storage";

const ENTRY_FEE_GROSZE = ENTRY_FEE * 100;
const PURCHASE_CHECKOUT_WINDOW_SECONDS = 31 * 60;

type BidderRequest = { expectedPrice?: unknown };

async function authenticatedBidder() {
  const { userId } = await auth();
  if (!userId) return null;
  let blocked: boolean | null = null;
  try {
    [, blocked] = await Promise.all([
      ensureAccountProfile(userId),
      isAccountBlocked(userId),
    ]);
  } catch {
    // Account policy must fail closed when its storage cannot be verified.
  }
  return {
    bidderId: `clerk:${userId}`,
    blocked,
  };
}

async function activeRun(
  auctionIdValue: string,
  expectedRunIdValue?: string | null,
) {
  const auctionId = normalizeAuctionId(auctionIdValue);
  const expectedRunId = expectedRunIdValue
    ? normalizeRunId(expectedRunIdValue)
    : null;
  if (!auctionId || (expectedRunIdValue && !expectedRunId)) return null;

  const [record, config] = await Promise.all([
    readAuctionRecord(auctionId),
    readOptionalAuctionConfig(auctionId),
  ]);
  if (!record || record.state !== "published" || !config) return null;
  if (
    auctionId !== LEGACY_AUCTION_ID &&
    record.currentRunId !== config.runId
  ) {
    return null;
  }

  return {
    auctionId,
    config,
    runMatches: !expectedRunId || config.runId === expectedRunId,
  };
}

async function parseBidderBody(request: NextRequest) {
  try {
    const body = (await request.json()) as BidderRequest;
    if (
      body.expectedPrice !== undefined &&
      (!Number.isInteger(body.expectedPrice) ||
        (body.expectedPrice as number) < 0)
    ) {
      return null;
    }
    return {
      expectedPrice: body.expectedPrice as number | undefined,
    };
  } catch {
    return null;
  }
}

export async function handleEntryGet(
  request: NextRequest,
  auctionIdValue: string,
  expectedRunId?: string | null,
) {
  const bidder = await authenticatedBidder();
  if (!bidder) {
    return NextResponse.json({ outcome: "sign_in_required" }, { status: 401 });
  }
  if (bidder.blocked === null) return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  if (bidder.blocked) return NextResponse.json({ outcome: "account_blocked" }, { status: 403 });
  const { bidderId } = bidder;

  try {
    const active = await activeRun(auctionIdValue, expectedRunId);
    if (!active) {
      return NextResponse.json({ outcome: "not_found" }, { status: 404 });
    }
    if (!active.runMatches) {
      return NextResponse.json(
        { outcome: "run_changed", runId: active.config.runId },
        { status: 409 },
      );
    }

    const entry = await readAuctionEntry(
      active.config.runId,
      bidderId,
      active.auctionId,
    );
    return NextResponse.json({
      outcome: "ok",
      auctionId: active.auctionId,
      runId: active.config.runId,
      hasEntry: Boolean(entry),
      entryFee: ENTRY_FEE,
      grantedAt: entry?.grantedAt ?? null,
    });
  } catch (error) {
    console.error("Unable to read auction entry from Redis.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}

export async function handleEntryPost(
  request: NextRequest,
  auctionIdValue: string,
  expectedRunId?: string | null,
) {
  const bidderRequest = await parseBidderBody(request);
  if (!bidderRequest) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }
  const bidder = await authenticatedBidder();
  if (!bidder) {
    return NextResponse.json({ outcome: "sign_in_required" }, { status: 401 });
  }
  if (bidder.blocked === null) return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  if (bidder.blocked) return NextResponse.json({ outcome: "account_blocked" }, { status: 403 });
  const { bidderId } = bidder;
  if (!isPaymentProviderConfigured()) {
    return NextResponse.json(
      { outcome: "stripe_not_configured" },
      { status: 503 },
    );
  }

  try {
    const active = await activeRun(auctionIdValue, expectedRunId);
    if (!active) {
      return NextResponse.json({ outcome: "not_found" }, { status: 404 });
    }
    if (!active.runMatches) {
      return NextResponse.json(
        { outcome: "run_changed", runId: active.config.runId },
        { status: 409 },
      );
    }

    const existingEntry = await readAuctionEntry(
      active.config.runId,
      bidderId,
      active.auctionId,
    );
    if (existingEntry) {
      return NextResponse.json({
        outcome: "already_granted",
        auctionId: active.auctionId,
        runId: active.config.runId,
        hasEntry: true,
        entryFee: ENTRY_FEE,
      });
    }

    const winner = await readAuctionWinner(
      active.config.runId,
      active.auctionId,
    );
    const timedState = getTimedAuctionState(Date.now(), active.config);
    if (winner || timedState.status === "ended") {
      return NextResponse.json(
        {
          outcome: "auction_unavailable",
          auctionId: active.auctionId,
          runId: active.config.runId,
        },
        { status: 409 },
      );
    }

    const rateLimit = await consumeEntryCheckoutRateLimit(
      request,
      active.auctionId,
      active.config.runId,
      bidderId,
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { outcome: "rate_limited" },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfter) },
        },
      );
    }

    const session = await createEntryPaymentSession({
      origin: getCheckoutOrigin(request),
      auctionId: active.auctionId,
      runId: active.config.runId,
      bidderId,
      amount: ENTRY_FEE_GROSZE,
      productName: active.config.productName,
    });
    return NextResponse.json({
      outcome: "checkout",
      auctionId: active.auctionId,
      runId: active.config.runId,
      checkoutUrl: session.url,
      entryFee: ENTRY_FEE,
    });
  } catch (error) {
    console.error("Unable to create entry Checkout Session.", error);
    return NextResponse.json({ outcome: "payment_error" }, { status: 503 });
  }
}

export async function handleBuyPost(
  request: NextRequest,
  auctionIdValue: string,
  expectedRunId?: string | null,
) {
  const bidderRequest = await parseBidderBody(request);
  if (!bidderRequest) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }
  const bidder = await authenticatedBidder();
  if (!bidder) {
    return NextResponse.json({ outcome: "sign_in_required" }, { status: 401 });
  }
  if (bidder.blocked === null) return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  if (bidder.blocked) return NextResponse.json({ outcome: "account_blocked" }, { status: 403 });
  const { bidderId } = bidder;
  const { expectedPrice } = bidderRequest;
  if (!isPaymentProviderConfigured()) {
    return NextResponse.json(
      { outcome: "stripe_not_configured" },
      { status: 503 },
    );
  }

  try {
    const active = await activeRun(auctionIdValue, expectedRunId);
    if (!active) {
      return NextResponse.json({ outcome: "not_found" }, { status: 404 });
    }
    if (!active.runMatches) {
      return NextResponse.json(
        { outcome: "run_changed", runId: active.config.runId },
        { status: 409 },
      );
    }

    const now = Date.now();
    const timedState = getTimedAuctionState(now, active.config);
    if (timedState.status !== "live") {
      return NextResponse.json(
        {
          outcome: "not_live",
          status: timedState.status,
          currentPrice: timedState.currentPrice,
        },
        { status: 409 },
      );
    }
    if (
      expectedPrice !== undefined &&
      expectedPrice !== timedState.currentPrice
    ) {
      return NextResponse.json(
        {
          outcome: "price_changed",
          currentPrice: timedState.currentPrice,
        },
        { status: 409 },
      );
    }

    const entry = await readAuctionEntry(
      active.config.runId,
      bidderId,
      active.auctionId,
    );
    if (!entry) {
      return NextResponse.json(
        {
          outcome: "entry_required",
          auctionId: active.auctionId,
          runId: active.config.runId,
        },
        { status: 403 },
      );
    }

    const winner: AuctionWinner = {
      bidderId,
      price: timedState.currentPrice,
      claimedAt: new Date(now).toISOString(),
      paymentStatus: "pending",
      paymentProvider: configuredPaymentProvider(),
    };

    const checkoutResponse = (claimedWinner: AuctionWinner, checkoutUrl: string) =>
      NextResponse.json({
        outcome: "checkout",
        auctionId: active.auctionId,
        runId: active.config.runId,
        price: claimedWinner.price,
        claimedAt: claimedWinner.claimedAt,
        checkoutUrl,
      });

    const expireUnreturnedCheckout = async (sessionId: string) => {
      try {
        await expirePaymentSession(sessionId);
      } catch (error) {
        console.error("Unable to expire unattached Checkout Session.", error);
      }
    };

    const waitForAttachedCheckout = async (claimedWinner: AuctionWinner) => {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const recovered = await readAuctionWinner(
          active.config.runId,
          active.auctionId,
        );
        const sameClaim =
          recovered?.bidderId === claimedWinner.bidderId &&
          recovered.claimedAt === claimedWinner.claimedAt;
        if (!sameClaim) return recovered;
        if (recovered.paymentSessionId && recovered.paymentCheckoutUrl) {
          return recovered;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return readAuctionWinner(active.config.runId, active.auctionId);
    };

    const releaseExactClaim = async (claimedWinner: AuctionWinner) => {
      try {
        await releaseAuctionWinner(
          active.config.runId,
          claimedWinner.bidderId,
          undefined,
          active.auctionId,
          claimedWinner.claimedAt,
        );
      } catch (error) {
        console.error("Unable to release winner after Checkout failure.", error);
      }
    };

    const recoverAttachment = async (
      session: { id: string; url: string | null },
      claimedWinner: AuctionWinner,
    ) => {
      let recovered: AuctionWinner | null;
      try {
        recovered = await waitForAttachedCheckout(claimedWinner);
      } catch (error) {
        console.error("Unable to verify ambiguous Checkout attachment.", error);
        return null;
      }

      const sameClaim =
        recovered?.bidderId === claimedWinner.bidderId &&
        recovered.claimedAt === claimedWinner.claimedAt;
      if (sameClaim && recovered?.paymentSessionId && recovered.paymentCheckoutUrl) {
        if (recovered.paymentSessionId !== session.id) {
          await expireUnreturnedCheckout(session.id);
        }
        return checkoutResponse(recovered, recovered.paymentCheckoutUrl);
      }

      if (!sameClaim) await expireUnreturnedCheckout(session.id);
      return null;
    };

    const finishWinnerCheckout = async (claimedWinner: AuctionWinner) => {
      const claimedAtMs = Date.parse(claimedWinner.claimedAt);
      if (!Number.isFinite(claimedAtMs)) {
        await releaseExactClaim(claimedWinner);
        return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
      }
      const expiresAt =
        Math.floor(claimedAtMs / 1000) + PURCHASE_CHECKOUT_WINDOW_SECONDS;
      let session;

      try {
        session = await createPurchasePaymentSession({
          origin: getCheckoutOrigin(request),
          auctionId: active.auctionId,
          runId: active.config.runId,
          bidderId: claimedWinner.bidderId,
          amount: claimedWinner.price * 100,
          expiresAt,
          productName: active.config.productName,
          claimToken: claimedWinner.claimedAt,
        });
      } catch (error) {
        try {
          const recovered = await waitForAttachedCheckout(claimedWinner);
          if (
            recovered?.bidderId === claimedWinner.bidderId &&
            recovered.claimedAt === claimedWinner.claimedAt &&
            recovered.paymentCheckoutUrl
          ) {
            return checkoutResponse(recovered, recovered.paymentCheckoutUrl);
          }
        } catch (recoveryError) {
          console.error("Unable to recover winner after Stripe failure.", recoveryError);
        }
        console.error("Unable to create winner Checkout Session.", error);
        return NextResponse.json({ outcome: "payment_error" }, { status: 503 });
      }

      let attached: number | null;
      try {
        attached = await attachAuctionWinnerCheckout(
          active.config.runId,
          claimedWinner.bidderId,
          session.id,
          session.url!,
          new Date(expiresAt * 1000).toISOString(),
          active.auctionId,
          claimedWinner.claimedAt,
          claimedWinner.paymentProvider ?? configuredPaymentProvider(),
        );
      } catch (error) {
        console.error("Checkout attachment returned an ambiguous error.", error);
        const recoveredResponse = await recoverAttachment(session, claimedWinner);
        if (recoveredResponse) return recoveredResponse;
        return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
      }

      if (attached !== 1) {
        const recoveredResponse = await recoverAttachment(session, claimedWinner);
        if (recoveredResponse) return recoveredResponse;
        return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
      }

      return checkoutResponse(claimedWinner, session.url!);
    };

    let result: number | null;
    try {
      result = await claimAuctionWinnerIfCurrent(
        active.config.runId,
        bidderId,
        new Date(active.config.startsAt).getTime(),
        getAuctionEndsAt(active.config).getTime(),
        now,
        winner,
        active.auctionId,
      );
    } catch (error) {
      console.error("Winner claim returned an ambiguous error.", error);
      try {
        const recovered = await readAuctionWinner(
          active.config.runId,
          active.auctionId,
        );
        if (
          recovered?.bidderId === bidderId &&
          recovered.paymentStatus === "pending"
        ) {
          if (recovered.paymentCheckoutUrl) {
            return checkoutResponse(recovered, recovered.paymentCheckoutUrl);
          }
          return finishWinnerCheckout(recovered);
        }
        if (recovered) {
          return NextResponse.json(
            {
              outcome: "lost",
              auctionId: active.auctionId,
              runId: active.config.runId,
              winnerPrice: recovered.price,
            },
            { status: 409 },
          );
        }
      } catch (recoveryError) {
        console.error("Unable to recover ambiguous winner claim.", recoveryError);
      }
      return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
    }

    if (result === 1) {
      return finishWinnerCheckout(winner);
    }

    if (result === -2) {
      return NextResponse.json(
        {
          outcome: "entry_required",
          auctionId: active.auctionId,
          runId: active.config.runId,
        },
        { status: 403 },
      );
    }
    if (result === -1) {
      return NextResponse.json(
        { outcome: "not_live", status: "ended" },
        { status: 409 },
      );
    }
    if (result === -3) {
      return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
    }

    const existingWinner = await readAuctionWinner(
      active.config.runId,
      active.auctionId,
    );
    if (
      existingWinner?.bidderId === bidderId &&
      existingWinner.paymentStatus === "pending"
    ) {
      return existingWinner.paymentCheckoutUrl
        ? checkoutResponse(existingWinner, existingWinner.paymentCheckoutUrl)
        : finishWinnerCheckout(existingWinner);
    }

    return NextResponse.json(
      {
        outcome: "lost",
        auctionId: active.auctionId,
        runId: active.config.runId,
        winnerPrice: existingWinner?.price ?? null,
      },
      { status: 409 },
    );
  } catch (error) {
    console.error("Unable to claim auction in Redis.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}

export async function handleCancelPost(
  request: NextRequest,
  auctionIdValue: string,
  requestedRunId?: string | null,
) {
  const auctionId = normalizeAuctionId(auctionIdValue);
  const explicitRunId = requestedRunId ? normalizeRunId(requestedRunId) : null;
  const bidderRequest = await parseBidderBody(request);
  const bidder = await authenticatedBidder();
  if (!bidder) {
    return NextResponse.json({ outcome: "sign_in_required" }, { status: 401 });
  }
  if (bidder.blocked === null) return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  if (bidder.blocked) return NextResponse.json({ outcome: "account_blocked" }, { status: 403 });
  const { bidderId } = bidder;
  if (!auctionId || (requestedRunId && !explicitRunId)) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  try {
    const config = await readOptionalAuctionConfig(auctionId);
    const runId = explicitRunId ?? config?.runId;
    if (!runId) {
      return NextResponse.json({ outcome: "not_found" }, { status: 404 });
    }

    const winner = await readAuctionWinner(runId, auctionId);
    if (!winner || winner.bidderId !== bidderId) {
      return NextResponse.json({ outcome: "nothing_to_cancel" });
    }
    if (winner.paymentStatus !== "pending") {
      return NextResponse.json({ outcome: "already_paid" }, { status: 409 });
    }

    if (!winner.paymentSessionId) {
      const released = await releaseAuctionWinner(
        runId,
        bidderId,
        undefined,
        auctionId,
        winner.claimedAt,
      );
      return NextResponse.json({
        outcome: released === 1 ? "cancelled" : "nothing_to_cancel",
      });
    }

    if (!isPaymentProviderConfigured()) {
      return NextResponse.json(
        { outcome: "stripe_not_configured" },
        { status: 503 },
      );
    }

    try {
      await expirePaymentSession(winner.paymentSessionId);
    } catch (error) {
      console.error("Unable to expire cancelled Checkout Session.", error);
      return NextResponse.json({ outcome: "cannot_cancel" }, { status: 409 });
    }

    const released = await releaseAuctionWinner(
      runId,
      bidderId,
      winner.paymentSessionId,
      auctionId,
      winner.claimedAt,
    );
    return NextResponse.json({
      outcome: released === 1 ? "cancelled" : "nothing_to_cancel",
    });
  } catch (error) {
    console.error("Unable to cancel winner payment.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
