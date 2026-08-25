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

export type { PaymentProviderName, PaymentReference } from "./payment-types";

export type PaymentSessionState = "open" | "paid" | "expired" | "unknown";
export type PaymentSession = {
  provider: PaymentProviderName;
  reference: string;
  checkoutUrl: string | null;
  state: PaymentSessionState;
};

function stripeSessionState(session: StripeCheckoutSession): PaymentSessionState {
  if (session.payment_status === "paid" || session.status === "complete") return "paid";
  if (session.status === "open") return "open";
  if (session.status === "expired") return "expired";
  return "unknown";
}

function fromStripeSession(session: StripeCheckoutSession): PaymentSession {
  return { provider: "stripe", reference: session.id, checkoutUrl: session.url ?? null, state: stripeSessionState(session) };
}

export function configuredPaymentProvider(): PaymentProviderName {
  return process.env.FISZY_PAYMENT_PROVIDER?.trim().toLowerCase() === "przelewy24"
    ? "przelewy24"
    : "stripe";
}

export function isPaymentProviderConfigured() {
  return configuredPaymentProvider() === "stripe" && Boolean(process.env.STRIPE_SECRET_KEY);
}

export function paymentProviderHealth(environment = process.env.VERCEL_ENV ?? "local") {
  const provider = configuredPaymentProvider();
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

// Current adapter delegates to Stripe without changing checkout or webhook behavior.
// Przelewy24 can implement this same boundary when payment work resumes.
function requireStripeAdapter() {
  if (configuredPaymentProvider() !== "stripe") throw new Error("Selected payment provider adapter is not active.");
}

export async function createEntryPaymentSession(input: Parameters<typeof createEntryCheckoutSession>[0]) {
  requireStripeAdapter();
  return fromStripeSession(await createEntryCheckoutSession(input));
}
export async function createPurchasePaymentSession(input: Parameters<typeof createPurchaseCheckoutSession>[0]) {
  requireStripeAdapter();
  return fromStripeSession(await createPurchaseCheckoutSession(input));
}
export async function createDiscountPurchasePaymentSession(input: Parameters<typeof createDiscountPurchaseCheckoutSession>[0]) {
  requireStripeAdapter();
  return fromStripeSession(await createDiscountPurchaseCheckoutSession(input));
}
export async function expirePaymentSession(reference: string) {
  requireStripeAdapter();
  return fromStripeSession(await expireCheckoutSession(reference));
}
export async function retrievePaymentSession(reference: string) {
  requireStripeAdapter();
  return fromStripeSession(await retrieveCheckoutSession(reference));
}
export const refundPaymentSession = refundCheckoutSessionPayment;

export function stripePaymentReference(reference: string): PaymentReference {
  return { provider: "stripe", reference };
}
