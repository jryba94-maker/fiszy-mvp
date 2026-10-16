import { createHash, randomUUID } from "node:crypto";
import { redisCommand } from "./redis";
import { ENTRY_SERVICE_CONSENT_VERSION, ENTRY_SERVICE_CONSENT_TEXT } from "./entry-service-terms";
import { entryContractText } from "./legal-content";
export type EntryServiceConsent = { id: string; accountId: string; auctionId: string; runId: string; fee: number; acceptedAt: string; version: string; text: string; contract: string };
function key(id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error("Invalid service consent id.");
  return `fiszy:${process.env.VERCEL_ENV ?? "local"}:entry-service-consent:${id}`;
}
export async function recordEntryServiceConsent(input: Pick<EntryServiceConsent, "accountId" | "auctionId" | "runId" | "fee">) {
  const consent: EntryServiceConsent = { ...input, id: randomUUID().replaceAll("-", ""), acceptedAt: new Date().toISOString(), version: ENTRY_SERVICE_CONSENT_VERSION, text: ENTRY_SERVICE_CONSENT_TEXT, contract: entryContractText() };
  const identity = createHash("sha256").update(JSON.stringify([input, consent.version, consent.contract])).digest("hex");
  const raw = await redisCommand<string>(["EVAL", `
local old = redis.call("GET", KEYS[1])
if old then return old end
redis.call("SET", KEYS[1], ARGV[1])
redis.call("SET", KEYS[2], ARGV[1])
return ARGV[1]
`, 2, `fiszy:${process.env.VERCEL_ENV ?? "local"}:entry-service-consent-index:${identity}`, key(consent.id), JSON.stringify(consent)]);
  if (!raw) throw new Error("Unable to record entry service consent.");
  return JSON.parse(raw) as EntryServiceConsent;
}
export async function readEntryServiceConsent(id: string): Promise<EntryServiceConsent | null> {
  const raw = await redisCommand<string>(["GET", key(id)]);
  return raw ? JSON.parse(raw) as EntryServiceConsent : null;
}
