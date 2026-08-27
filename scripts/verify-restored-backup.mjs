import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

function firstValue(names) {
  return names.map((name) => process.env[name]).find(Boolean);
}

function fail(message) {
  throw new Error(message);
}

const inputValue = process.env.FISZY_BACKUP_INPUT;
const targetEnvironment = process.env.FISZY_RESTORE_ENV;
const cleanup = process.argv.includes("--cleanup");
if (!inputValue || !isAbsolute(inputValue)) fail("FISZY_BACKUP_INPUT must be an explicit absolute path.");
if (!targetEnvironment || !/^[a-z0-9-]+$/.test(targetEnvironment) || targetEnvironment === "production") fail("A non-production FISZY_RESTORE_ENV is required.");

const redisUrl = firstValue(["STORAGE_KV_REST_API_URL", "KV_REST_API_URL", "UPSTASH_REDIS_REST_URL"]);
const redisToken = firstValue(["STORAGE_KV_REST_API_TOKEN", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN"]);
if (!redisUrl || !redisToken) fail("Redis REST configuration is missing.");

async function command(parts) {
  const response = await fetch(redisUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${redisToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(parts),
  });
  if (!response.ok) fail(`Redis verification request failed with ${response.status}.`);
  const body = await response.json();
  if (body.error) fail("Redis rejected a verification command.");
  return body.result;
}

const backup = JSON.parse(await readFile(resolve(inputValue), "utf8"));
if (!Array.isArray(backup.records) || typeof backup.environment !== "string") fail("Invalid backup format.");
const sourcePrefix = `fiszy:${backup.environment}:`;
const targetPrefix = `fiszy:${targetEnvironment}:`;

async function readValue(key, type) {
  if (type === "string") return command(["GET", key]);
  if (type === "zset") return command(["ZRANGE", key, 0, -1, "WITHSCORES"]);
  if (type === "set") return (await command(["SMEMBERS", key])).sort();
  if (type === "hash") return command(["HGETALL", key]);
  if (type === "list") return command(["LRANGE", key, 0, -1]);
  fail(`Unsupported Redis type in verification: ${type}.`);
}

const targetKeys = [];
for (const record of backup.records) {
  if (!record.key.startsWith(sourcePrefix)) fail("Backup key is outside its source namespace.");
  const targetKey = `${targetPrefix}${record.key.slice(sourcePrefix.length)}`;
  const actualType = await command(["TYPE", targetKey]);
  if (actualType !== record.type) fail(`Type mismatch for ${targetKey}.`);
  const expected = record.type === "set" ? [...record.value].sort() : record.value;
  const actual = await readValue(targetKey, record.type);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`Value mismatch for ${targetKey}.`);
  const actualTtl = Number(await command(["PTTL", targetKey]));
  if (record.ttlMs === -1 && actualTtl !== -1) fail(`Unexpected TTL for ${targetKey}.`);
  if (record.ttlMs > 0 && (actualTtl <= 0 || actualTtl > record.ttlMs)) fail(`TTL mismatch for ${targetKey}.`);
  targetKeys.push(targetKey);
}

if (cleanup && targetKeys.length) await command(["DEL", ...targetKeys]);
if (cleanup) {
  const result = await command(["SCAN", "0", "MATCH", `${targetPrefix}*`, "COUNT", 100]);
  if (!Array.isArray(result) || !Array.isArray(result[1]) || result[1].length) fail("Test namespace cleanup was incomplete.");
}

console.log(JSON.stringify({ outcome: cleanup ? "verified_and_cleaned" : "verified", targetEnvironment, keyCount: targetKeys.length }));
