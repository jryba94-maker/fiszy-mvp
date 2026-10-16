import {
  createEntryCheckoutSession,
  createDiscountPurchaseCheckoutSession,
  createPurchaseCheckoutSession,
  expireCheckoutSession,
  refundCheckoutSessionPayment,
  retrieveCheckoutSession,
  type StripeCheckoutSession,
} from "./stripe";
import type {
  PaymentProviderName,
  PaymentReference,
} from "./payment-types";
import { przelewy24AdapterReady, przelewy24Configuration } from "./payment-providers/przelewy24";
import { autopayConfiguration } from "./payment-providers/autopay-protocol";
import { sellerReady } from "./seller";
import { createAutopaySession, expireAutopaySession, retrieveAutopaySession, refundAutopayPayment } from "./payment-providers/autopay";

export type { PaymentProviderName, PaymentReference } from "./payment-types";

export type PaymentSessionState = "open" | "processing" | "paid" | "expired" | "unknown";
export type PaymentSession = {
  provider: PaymentProviderName;
  reference: string;
  checkoutUrl: string | null;
  state: PaymentSessionState;
};

function stripeSessionState(session: StripeCheckoutSession): PaymentSessionState {
  if (session.payment_status === "paid") return "paid";
  if (session.status === "complete") return "processing";
  if (session.status === "open") return "open";
  if (session.status === "expired") return "expired";
  return "unknown";
}

function fromStripeSession(session: StripeCheckoutSession): PaymentSession {
  return { provider: "stripe", reference: session.id, checkoutUrl: session.url ?? null, state: stripeSessionState(session) };
}

export function configuredPaymentProvider(): PaymentProviderName {
  if (process.env.FISZY_PAYMENT_PROVIDER?.trim().toLowerCase() === "autopay") return "autopay";
  return process.env.FISZY_PAYMENT_PROVIDER?.trim().toLowerCase() === "przelewy24"
    ? "przelewy24"
    : "stripe";
}

export function isPaymentProviderConfigured() {
  if (configuredPaymentProvider() === "autopay") {
    const config = autopayConfiguration();
    return config.credentialsConfigured && config.orderReuseBlocked && (config.sandbox || (config.verified && sellerReady()));
  }
  return configuredPaymentProvider() === "stripe" && Boolean(process.env.STRIPE_SECRET_KEY);
}

export function paymentProviderHealth(environment = process.env.VERCEL_ENV ?? "local") {
  const provider = configuredPaymentProvider();
  if (provider === "autopay") {
    const config = autopayConfiguration();
    return { provider, configured: isPaymentProviderConfigured(), credentialsConfigured: config.credentialsConfigured,
      adapterReady: true, testMode: config.sandbox, liveMode: !config.sandbox, webhookConfigured: config.verified,
      modeMatchesEnvironment: isPaymentProviderConfigured() && (environment === "production" ? !config.sandbox : config.sandbox) };
  }
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const p24 = przelewy24Configuration();
  const configured = provider === "stripe" ? Boolean(secretKey) : p24.credentialsConfigured && przelewy24AdapterReady;
  const credentialsConfigured = provider === "stripe" ? Boolean(secretKey) : p24.credentialsConfigured;
  const testMode = provider === "stripe" ? secretKey?.startsWith("sk_test_") ?? false : p24.sandbox;
  const liveMode = provider === "stripe" ? secretKey?.startsWith("sk_live_") ?? false : !p24.sandbox;
  const webhookConfigured = provider === "stripe" ? Boolean(process.env.STRIPE_WEBHOOK_SECRET) : false;
  const modeMatchesEnvironment =
    environment === "production"
      ? configured && liveMode
      : configured && testMode;

  return {
    provider,
    configured,
    credentialsConfigured,
    adapterReady: provider === "stripe" || przelewy24AdapterReady,
    testMode,
    liveMode,
    webhookConfigured,
    modeMatchesEnvironment,
  } as const;
}

// Keep provider-specific creation behind this boundary. Legacy references continue
// to dispatch to their original provider after an operator switch.
function requireStripeAdapter() {
  if (configuredPaymentProvider() !== "stripe") throw new Error("Selected payment provider adapter is not active.");
}

export async function createEntryPaymentSession(input: Parameters<typeof createEntryCheckoutSession>[0]) {
  if (configuredPaymentProvider() === "autopay") return createAutopaySession("auction_entry", input);
  requireStripeAdapter();
  return fromStripeSession(await createEntryCheckoutSession(input));
}
export async function createPurchasePaymentSession(input: Parameters<typeof createPurchaseCheckoutSession>[0]) {
  if (configuredPaymentProvider() === "autopay") return createAutopaySession("auction_purchase", input);
  requireStripeAdapter();
  return fromStripeSession(await createPurchaseCheckoutSession(input));
}
export async function createDiscountPurchasePaymentSession(input: Parameters<typeof createDiscountPurchaseCheckoutSession>[0]) {
  if (configuredPaymentProvider() === "autopay") return createAutopaySession("post_auction_purchase", input);
  requireStripeAdapter();
  return fromStripeSession(await createDiscountPurchaseCheckoutSession(input));
}
export async function expirePaymentSession(reference: string) {
  if (reference.startsWith("ap_")) return expireAutopaySession(reference);
  return fromStripeSession(await expireCheckoutSession(reference));
}
export async function retrievePaymentSession(reference: string) {
  if (reference.startsWith("ap_")) return retrieveAutopaySession(reference);
  return fromStripeSession(await retrieveCheckoutSession(reference));
}
export async function refundPaymentSession(session: StripeCheckoutSession) {
  if (session.id.startsWith("ap_")) return refundAutopayPayment(session.id);
  await refundCheckoutSessionPayment(session);
  return { state: "completed" as const };
}

export function stripePaymentReference(reference: string): PaymentReference {
  return { provider: "stripe", reference };
}
