import { auth } from "@clerk/nextjs/server";

export async function currentAccountIdentity() {
  const { userId } = await auth();
  if (!userId) return null;
  return {
    accountId: userId,
    participantId: `clerk:${userId}`,
  };
}
