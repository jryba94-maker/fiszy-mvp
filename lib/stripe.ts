import { createHmac, timingSafeEqual } from "node:crypto";

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const WEBHOOK_TOLERANCE_SECONDS = 300;

export type StripeAddress = {
  city: string | null;
  country: string | null;
  line1: string | null;
  line2: string | null;
  postal_code: string | null;
  state: string | null;
};

export type StripeCheckoutSession = {
  id: string;
  url: string | null;
  mode: string | null;
  payment_status: string | null;
  amount_total: number | null;
  currency: string | null;
  metadata: Record<string, string> | null;
  status?: string | null;
  customer_details?: {
    address: StripeAddress | null;
    email: string | null;
    name: string | null;
    individual_name?: string | null;
    phone: string | null;
  } | null;
  collected_information?: {
    individual_name?: string | null;
    shipping_details?: {
      name: string;
      address: StripeAddress;
    } | null;
  } | null;
};

type StripeEvent = {
  id: string;
  type: string;
  data: {
    object: StripeCheckoutSession;
  };
};

function stripeSecretKey() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured.");
  return key;
}

export function stripeWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not configured.");
  return secret;
}

async function createCheckoutSession(body: URLSearchParams) {
  const response = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecretKey()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });

  const data = (await response.json()) as StripeCheckoutSession & {
    error?: { message?: string };
  };

  if (!response.ok || !data.id || !data.url) {
    throw new Error(data.error?.message ?? "Unable to create Stripe Checkout Session.");
  }

  return data;
}

export async function createEntryCheckoutSession(input: {
  origin: string;
  auctionId: string;
  runId: string;
  bidderId: string;
  amount: number;
}) {
  const body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("success_url", `${input.origin}/?payment=success`);
  body.set("cancel_url", `${input.origin}/?payment=cancelled`);
  body.set("payment_method_types[0]", "card");
  body.set("line_items[0][price_data][currency]", "pln");
  body.set("line_items[0][price_data][unit_amount]", String(input.amount));
  body.set(
    "line_items[0][price_data][product_data][name]",
    "Wejście do aukcji Fiszy",
  );
  body.set("line_items[0][quantity]", "1");
  body.set("metadata[kind]", "auction_entry");
  body.set("metadata[auctionId]", input.auctionId);
  body.set("metadata[runId]", input.runId);
  body.set("metadata[bidderId]", input.bidderId);

  return createCheckoutSession(body);
}

export async function createPurchaseCheckoutSession(input: {
  origin: string;
  auctionId: string;
  runId: string;
  bidderId: string;
  amount: number;
  expiresAt: number;
}) {
  const body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("success_url", `${input.origin}/?purchase=success`);
  body.set("cancel_url", `${input.origin}/?purchase=cancelled`);
  body.set("payment_method_types[0]", "card");
  body.set("expires_at", String(input.expiresAt));
  body.set("shipping_address_collection[allowed_countries][0]", "PL");
  body.set("phone_number_collection[enabled]", "true");
  body.set("name_collection[individual][enabled]", "true");
  body.set("line_items[0][price_data][currency]", "pln");
  body.set("line_items[0][price_data][unit_amount]", String(input.amount));
  body.set(
    "line_items[0][price_data][product_data][name]",
    "AirPods Pro — wygrana aukcji Fiszy",
  );
  body.set("line_items[0][quantity]", "1");
  body.set("metadata[kind]", "auction_purchase");
  body.set("metadata[auctionId]", input.auctionId);
  body.set("metadata[runId]", input.runId);
  body.set("metadata[bidderId]", input.bidderId);

  return createCheckoutSession(body);
}

export async function expireCheckoutSession(sessionId: string) {
  const response = await fetch(
    `${STRIPE_API_BASE}/checkout/sessions/${encodeURIComponent(sessionId)}/expire`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey()}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(),
      cache: "no-store",
    },
  );

  const data = (await response.json()) as StripeCheckoutSession & {
    error?: { message?: string };
  };

  if (!response.ok || !data.id) {
    throw new Error(data.error?.message ?? "Unable to expire Stripe Checkout Session.");
  }

  return data;
}

function parseStripeSignature(header: string) {
  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t") timestamp = Number(value);
    if (key === "v1" && value) signatures.push(value);
  }

  if (!timestamp || signatures.length === 0) return null;
  return { timestamp, signatures };
}

export function verifyStripeWebhook(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): StripeEvent {
  const parsed = parseStripeSignature(signatureHeader);
  if (!parsed) throw new Error("Invalid Stripe-Signature header.");

  const age = Math.abs(Math.floor(Date.now() / 1000) - parsed.timestamp);
  if (age > WEBHOOK_TOLERANCE_SECONDS) {
    throw new Error("Stripe webhook timestamp is outside tolerance.");
  }

  const expected = createHmac("sha256", secret)
    .update(`${parsed.timestamp}.${rawBody}`)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  const valid = parsed.signatures.some((signature) => {
    try {
      const actualBuffer = Buffer.from(signature, "hex");
      return (
        actualBuffer.length === expectedBuffer.length &&
        timingSafeEqual(actualBuffer, expectedBuffer)
      );
    } catch {
      return false;
    }
  });

  if (!valid) throw new Error("Stripe webhook signature verification failed.");

  return JSON.parse(rawBody) as StripeEvent;
}
