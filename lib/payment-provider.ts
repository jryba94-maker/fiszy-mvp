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

export type { PaymentProviderName, PaymentReference } from "./payment-types";

export type PaymentSession = StripeCheckoutSession;

export function configuredPaymentProvider(): PaymentProviderName {
  return "stripe";
}

export function isPaymentProviderConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function paymentProviderHealth(environment = process.env.VERCEL_ENV ?? "local") {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const configured = isPaymentProviderConfigured();
  const testMode = secretKey?.startsWith("sk_test_") ?? false;
  const liveMode = secretKey?.startsWith("sk_live_") ?? false;
  const webhookConfigured = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
  const modeMatchesEnvironment =
    environment === "production"
      ? configured && liveMode
      : configured && testMode;

  return {
    provider: configuredPaymentProvider(),
    configured,
    testMode,
    liveMode,
    webhookConfigured,
    modeMatchesEnvironment,
  } as const;
}

// Current adapter delegates to Stripe without changing checkout or webhook behavior.
// Przelewy24 can implement this same boundary when payment work resumes.
export const createEntryPaymentSession = createEntryCheckoutSession;
export const createPurchasePaymentSession = createPurchaseCheckoutSession;
export const createDiscountPurchasePaymentSession =
  createDiscountPurchaseCheckoutSession;
export const expirePaymentSession = expireCheckoutSession;
export const retrievePaymentSession = retrieveCheckoutSession;
export const refundPaymentSession = refundCheckoutSessionPayment;

export function stripePaymentReference(reference: string): PaymentReference {
  return { provider: "stripe", reference };
}
