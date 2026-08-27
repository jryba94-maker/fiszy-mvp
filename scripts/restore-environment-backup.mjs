import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

function firstValue(names) {
  return names.map((name) => process.env[name]).find(Boolean);
}

function fail(message) {
  throw new Error(message);
}

const inputValue = process.env.FISZY_BACKUP_INPUT;
const targetEnvironment = process.env.FISZY_RESTORE_ENV ?? "development";
const apply = process.argv.includes("--apply");

if (!inputValue || !isAbsolute(inputValue)) fail("FISZY_BACKUP_INPUT must be an explicit absolute path.");
if (!/^[a-z0-9-]+$/.test(targetEnvironment)) fail("FISZY_RESTORE_ENV is invalid.");
if (targetEnvironment === "production") fail("Restoring to Production is intentionally blocked.");

const backup = JSON.parse(await readFile(resolve(inputValue), "utf8"));
if (backup.schemaVersion !== 1 || !Array.isArray(backup.records)) fail("Unsupported backup format.");
if (backup.keyCount !== backup.records.length) fail("Backup key count does not match its records.");

const { checksum, ...payload } = backup;
const calculatedChecksum = `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
if (typeof checksum !== "string" || checksum !== calculatedChecksum) fail("Backup checksum verification failed.");

const sourcePrefix = `fiszy:${backup.environment}:`;
const targetPrefix = `fiszy:${targetEnvironment}:`;
const supportedTypes = new Set(["string", "zset", "set", "hash", "list"]);
const records = backup.records.map((record) => {
  if (!record || typeof record.key !== "string" || !record.key.startsWith(sourcePrefix)) fail("Backup contains a key outside its environment namespace.");
  if (!supportedTypes.has(record.type)) fail(`Unsupported Redis type in restore: ${record.type}.`);
  if (!Number.isInteger(record.ttlMs) || record.ttlMs < -1) fail(`Invalid TTL for ${record.key}.`);
  return { ...record, targetKey: `${targetPrefix}${record.key.slice(sourcePrefix.length)}` };
});

if (!apply) {
  console.log(JSON.stringify({ outcome: "dry_run_ok", sourceEnvironment: backup.environment, targetEnvironment, keyCount: records.length, checksum }));
  process.exit(0);
}

const redisUrl = firstValue(["STORAGE_KV_REST_API_URL", "KV_REST_API_URL", "UPSTASH_REDIS_REST_URL"]);
const redisToken = firstValue(["STORAGE_KV_REST_API_TOKEN", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN"]);
if (!redisUrl || !redisToken) fail("Redis REST configuration is missing.");

async function command(parts) {
  const response = await fetch(redisUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${redisToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(parts),
  });
  if (!response.ok) fail(`Redis restore request failed with ${response.status}.`);
  const body = await response.json();
  if (body.error) fail("Redis rejected a restore command.");
  return body.result;
}

let cursor = "0";
do {
  const result = await command(["SCAN", cursor, "MATCH", `${targetPrefix}*`, "COUNT", 100]);
  if (!Array.isArray(result) || result.length !== 2 || !Array.isArray(result[1])) fail("Redis returned an invalid SCAN page.");
  if (result[1].length > 0) fail(`Target namespace ${targetEnvironment} is not empty; restore aborted before writing.`);
  cursor = String(result[0]);
} while (cursor !== "0");

for (const record of records) {
  if (record.type === "string") await command(["SET", record.targetKey, record.value]);
  else if (record.type === "list" && record.value.length) await command(["RPUSH", record.targetKey, ...record.value]);
  else if (record.type === "set" && record.value.length) await command(["SADD", record.targetKey, ...record.value]);
  else if (record.type === "hash" && record.value.length) await command(["HSET", record.targetKey, ...record.value]);
  else if (record.type === "zset" && record.value.length) {
    const members = [];
    for (let index = 0; index < record.value.length; index += 2) members.push(record.value[index + 1], record.value[index]);
    await command(["ZADD", record.targetKey, ...members]);
  }
  if (record.ttlMs > 0) await command(["PEXPIRE", record.targetKey, record.ttlMs]);
}

console.log(JSON.stringify({ outcome: "restored", sourceEnvironment: backup.environment, targetEnvironment, keyCount: records.length, checksum }));
