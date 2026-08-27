import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const restoreScript = new URL("./restore-environment-backup.mjs", import.meta.url);

async function backupFile(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "fiszy-backup-test-"));
  const payload = {
    schemaVersion: 1,
    environment: "preview",
    exportedAt: "2026-08-27T00:00:00.000Z",
    keyCount: 1,
    records: [{ key: "fiszy:preview:test", type: "string", ttlMs: -1, value: "ok" }],
    ...overrides,
  };
  const checksum = `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
  const path = join(directory, "backup.json");
  await writeFile(path, JSON.stringify({ ...payload, checksum }));
  return path;
}

function restore(path, environment = "development", args = []) {
  return spawnSync(process.execPath, [restoreScript.pathname.slice(1), ...args], {
    encoding: "utf8",
    env: { ...process.env, FISZY_BACKUP_INPUT: path, FISZY_RESTORE_ENV: environment },
  });
}

test("restore dry-run validates a complete backup without contacting Redis", async () => {
  const result = restore(await backupFile());
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).outcome, "dry_run_ok");
});

test("restore always blocks the production namespace", async () => {
  const result = restore(await backupFile(), "production", ["--apply"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Production is intentionally blocked/);
});

test("restore rejects a backup with a corrupted checksum", async () => {
  const path = await backupFile({ keyCount: 2 });
  const result = restore(path);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /key count does not match/);
});
