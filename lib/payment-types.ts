export const PAYMENT_PROVIDERS = ["stripe", "przelewy24", "test"] as const;

export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];

export type PaymentReference = {
  provider: PaymentProviderName;
  reference: string;
};

export function normalizePaymentProvider(value: unknown) {
  return typeof value === "string" &&
    (PAYMENT_PROVIDERS as readonly string[]).includes(value)
    ? (value as PaymentProviderName)
    : null;
}

export function storedPaymentProvider(
  value: unknown,
  hasLegacyStripeReference: boolean,
) {
  return normalizePaymentProvider(value) ??
    (hasLegacyStripeReference ? "stripe" as const : null);
}
