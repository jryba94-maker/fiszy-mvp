import { randomUUID } from "node:crypto";
import { redisCommand } from "./redis";

export type MarketingAgent = "Creative" | "A/B" | "Performance";

export type MarketingWorkflow = {
  id: string;
  brief: string;
  motive: string;
  audience: string;
  cta: string;
  createdAt: string;
  messages: Array<{ agent: MarketingAgent; content: string }>;
};

const RETENTION_SECONDS = 90 * 24 * 60 * 60;
const MAX_WORKFLOWS = 30;

function key() {
  return `fiszy:${process.env.VERCEL_ENV ?? "local"}:marketing:workflows:v1`;
}

function asWorkflow(value: unknown): MarketingWorkflow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (![item.id, item.brief, item.motive, item.audience, item.cta, item.createdAt].every((field) => typeof field === "string")) return null;
  if (!Array.isArray(item.messages)) return null;
  const messages = item.messages.flatMap((message) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return [];
    const record = message as Record<string, unknown>;
    if ((record.agent !== "Creative" && record.agent !== "A/B" && record.agent !== "Performance") || typeof record.content !== "string") return [];
    return [{ agent: record.agent, content: record.content } as MarketingWorkflow["messages"][number]];
  });
  return messages.length === item.messages.length ? { id: item.id as string, brief: item.brief as string, motive: item.motive as string, audience: item.audience as string, cta: item.cta as string, createdAt: item.createdAt as string, messages } : null;
}

async function readWorkflows() {
  const raw = await redisCommand<string>(["GET", key()]);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.flatMap((item) => {
      const workflow = asWorkflow(item);
      return workflow ? [workflow] : [];
    }) : [];
  } catch {
    return [];
  }
}

export async function latestMarketingWorkflow() {
  return (await readWorkflows())[0] ?? null;
}

export async function saveMarketingWorkflow(input: Omit<MarketingWorkflow, "id" | "createdAt">) {
  const workflow: MarketingWorkflow = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
  const next = [workflow, ...(await readWorkflows())].slice(0, MAX_WORKFLOWS);
  await redisCommand<string>(["SET", key(), JSON.stringify(next), "EX", RETENTION_SECONDS]);
  return workflow;
}
