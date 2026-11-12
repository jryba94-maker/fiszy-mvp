import { redisCommand } from "./redis";

const metrics = ["delivered", "bounced", "failed", "suppressed", "complained", "opened", "clicked"] as const;
const campaignIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const providerIdPattern = /^[A-Za-z0-9-]{8,100}$/;
const prefix = () => `fiszy:${process.env.VERCEL_ENV ?? "local"}:marketing:campaigns`;
const statsKey = (id: string) => `${prefix()}:stats:${id}`;

export async function readCampaignDelivery(id: string) {
  const values = await redisCommand<Array<string | number | null>>(["HMGET", statsKey(id), ...metrics]);
  return Object.fromEntries(metrics.map((metric, index) => [metric, Number(values?.[index] ?? 0)])) as Record<typeof metrics[number], number>;
}

export async function recordCampaignDelivery(input: { campaignId: unknown; providerMessageId: string; type: string }) {
  const { campaignId, providerMessageId, type } = input;
  const metric = metrics.find((item) => `email.${item}` === type);
  if (typeof campaignId !== "string" || !campaignIdPattern.test(campaignId) || !providerIdPattern.test(providerMessageId) || !metric) return false;
  const result = await redisCommand<number>(["EVAL", `
if redis.call("EXISTS", KEYS[1]) == 0 then return 0 end
if redis.call("HSETNX", KEYS[2], ARGV[1], 1) == 1 then
  redis.call("HINCRBY", KEYS[2], ARGV[2], 1)
end
return 1
`, 2, `${prefix()}:item:${campaignId}`, statsKey(campaignId), `${metric}:${providerMessageId}`, metric]);
  return result === 1;
}
