import { NextRequest } from "next/server";

function validOrigin(value?: string) {
  if (!value) return null;

  try {
    const origin = new URL(value.trim());
    if (origin.protocol !== "http:" && origin.protocol !== "https:") return null;
    return origin.origin;
  } catch {
    return null;
  }
}

export function checkoutOriginConfiguration() {
  const environment = process.env.VERCEL_ENV ?? "local";
  const configuredDefault = validOrigin(
    process.env.FISZY_DEFAULT_CHECKOUT_ORIGIN,
  );
  const vercelOrigin = process.env.VERCEL_URL
    ? validOrigin(`https://${process.env.VERCEL_URL}`)
    : null;
  const productionReady =
    environment !== "production" || configuredDefault?.startsWith("https://") === true;

  return {
    environment,
    configuredDefault,
    vercelOrigin,
    productionReady,
  };
}

export function getCheckoutOrigin(request: NextRequest) {
  const { environment, configuredDefault, vercelOrigin, productionReady } =
    checkoutOriginConfiguration();
  if (!productionReady) {
    throw new Error(
      "Production Checkout requires an explicit HTTPS FISZY_DEFAULT_CHECKOUT_ORIGIN.",
    );
  }

  const fallbackOrigin =
    configuredDefault ?? vercelOrigin ?? request.nextUrl.origin;
  const allowedOrigins = new Set([
    fallbackOrigin,
    ...(process.env.FISZY_ALLOWED_CHECKOUT_ORIGINS ?? "")
      .split(",")
      .map((value) => validOrigin(value))
      .filter(
        (value): value is string =>
          Boolean(value) &&
          (environment !== "production" || value!.startsWith("https://")),
      ),
  ]);
  const browserOrigin = validOrigin(request.headers.get("origin") ?? undefined);

  return browserOrigin && allowedOrigins.has(browserOrigin)
    ? browserOrigin
    : fallbackOrigin;
}

export function hasSameOrigin(request: NextRequest) {
  const origin = validOrigin(request.headers.get("origin") ?? undefined);
  return origin !== null && origin === request.nextUrl.origin;
}
