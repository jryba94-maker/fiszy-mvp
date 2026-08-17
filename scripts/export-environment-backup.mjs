import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

function firstValue(names) {
  return names.map((name) => process.env[name]).find(Boolean);
}

const environment = process.env.VERCEL_ENV ?? "local";
const outputValue = process.env.FISZY_BACKUP_OUTPUT;
if (!outputValue || !isAbsolute(outputValue)) {
  throw new Error("FISZY_BACKUP_OUTPUT must be an explicit absolute path outside the repository.");
}
if (environment === "production" && !process.argv.includes("--allow-production-read")) {
  throw new Error("Production export is read-only but requires --allow-production-read.");
}

const redisUrl = firstValue(["STORAGE_KV_REST_API_URL", "KV_REST_API_URL", "UPSTASH_REDIS_REST_URL"]);
const redisToken = firstValue(["STORAGE_KV_REST_API_TOKEN", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN"]);
if (!redisUrl || !redisToken) throw new Error("Redis REST configuration is missing.");

async function command(parts) {
  const response = await fetch(redisUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${redisToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(parts),
  });
  if (!response.ok) throw new Error(`Redis backup request failed with ${response.status}.`);
  const body = await response.json();
  if (body.error) throw new Error("Redis rejected a backup command.");
  return body.result;
}

async function allKeys() {
  const found = [];
  let cursor = "0";
  do {
    const result = await command(["SCAN", cursor, "MATCH", `fiszy:${environment}:*`, "COUNT", 250]);
    if (!Array.isArray(result) || result.length !== 2 || !Array.isArray(result[1])) throw new Error("Redis returned an invalid SCAN page.");
    cursor = String(result[0]);
    found.push(...result[1]);
  } while (cursor !== "0");
  return [...new Set(found)].sort();
}

async function readKey(key) {
  const [type, ttl] = await Promise.all([command(["TYPE", key]), command(["PTTL", key])]);
  let value;
  if (type === "string") value = await command(["GET", key]);
  else if (type === "zset") value = await command(["ZRANGE", key, 0, -1, "WITHSCORES"]);
  else if (type === "set") value = await command(["SMEMBERS", key]);
  else if (type === "hash") value = await command(["HGETALL", key]);
  else if (type === "list") value = await command(["LRANGE", key, 0, -1]);
  else if (type === "none") value = null;
  else throw new Error(`Unsupported Redis type in backup: ${type}.`);
  return { key, type, ttlMs: Number(ttl), value };
}

const keys = await allKeys();
const records = [];
for (const key of keys) records.push(await readKey(key));

const output = resolve(outputValue);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ schemaVersion: 1, environment, exportedAt: new Date().toISOString(), keyCount: records.length, records }, null, 2), { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({ outcome: "ok", environment, keyCount: records.length, output }));
