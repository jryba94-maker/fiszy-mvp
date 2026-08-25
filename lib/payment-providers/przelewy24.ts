export function przelewy24Configuration() {
  const merchantId = process.env.P24_MERCHANT_ID?.trim() ?? "";
  const posId = process.env.P24_POS_ID?.trim() ?? "";
  const crc = process.env.P24_CRC?.trim() ?? "";
  const apiKey = process.env.P24_API_KEY?.trim() ?? "";
  const sandbox = process.env.P24_SANDBOX?.trim().toLowerCase() !== "false";
  const credentialsConfigured = /^\d{1,12}$/.test(merchantId) && /^\d{1,12}$/.test(posId) && crc.length >= 8 && apiKey.length >= 8;
  return { merchantId, posId, sandbox, credentialsConfigured } as const;
}

// The provider contract is intentionally present before activation. Network
// calls stay disabled until P24 credentials, webhook verification and payment
// regression tests are approved together.
export const przelewy24AdapterReady = false;
