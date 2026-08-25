const CLERK_API_BASE = "https://api.clerk.com/v1";
const ACCOUNT_ID_PATTERN = /^user_[A-Za-z0-9_-]{5,100}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ClerkEmailAddress = {
  id?: unknown;
  email_address?: unknown;
};

type ClerkUser = {
  primary_email_address_id?: unknown;
  email_addresses?: unknown;
};

function validEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

export function accountIdFromParticipantId(participantId: string) {
  const accountId = participantId.startsWith("clerk:")
    ? participantId.slice("clerk:".length)
    : "";
  return ACCOUNT_ID_PATTERN.test(accountId) ? accountId : null;
}

export async function readClerkAccountEmail(accountIdValue: string) {
  const accountId = accountIdValue.trim();
  const secret = process.env.CLERK_SECRET_KEY?.trim();
  if (!ACCOUNT_ID_PATTERN.test(accountId) || !secret?.startsWith("sk_")) return null;

  const response = await fetch(
    `${CLERK_API_BASE}/users/${encodeURIComponent(accountId)}`,
    {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (!response.ok) return null;

  const user = (await response.json()) as ClerkUser;
  const addresses = Array.isArray(user.email_addresses)
    ? (user.email_addresses as ClerkEmailAddress[])
    : [];
  const primaryId = typeof user.primary_email_address_id === "string"
    ? user.primary_email_address_id
    : null;
  const primary = primaryId
    ? addresses.find((address) => address.id === primaryId)
    : addresses[0];
  return validEmail(primary?.email_address);
}
