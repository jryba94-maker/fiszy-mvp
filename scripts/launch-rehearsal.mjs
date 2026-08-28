import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import process from "node:process";

const withRuntime = process.argv.includes("--with-runtime");
const commands = [
  ["typecheck", ["run", "typecheck"]],
  ["portal-unit", ["run", "test:portal:unit"]],
  ["operations-unit", ["run", "test:operations:unit"]],
  ["admin-unit", ["run", "test:admin:unit"]],
  ["history-unit", ["run", "test:history:unit"]],
  ["faults-unit", ["run", "test:faults:unit"]],
  ["production-build", ["run", "build"]],
  ...(withRuntime ? [
    ["portal-runtime", ["run", "test:portal"]],
    ["race-runtime", ["run", "test:race"]],
  ] : []),
];

function run(args) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
    const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", "npm", ...args] : args;
    const child = spawn(command, commandArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); process.stdout.write(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); process.stderr.write(chunk); });
    child.on("close", (code) => resolve({ code: code ?? 1, durationMs: Date.now() - startedAt, output: output.slice(-6000) }));
  });
}

const startedAt = new Date().toISOString();
const checks = [];
for (const [name, args] of commands) {
  process.stdout.write(`\n=== ${name} ===\n`);
  const result = await run(args);
  checks.push({ name, ...result, status: result.code === 0 ? "passed" : "failed" });
  if (result.code !== 0) break;
}

const report = {
  schemaVersion: 1,
  startedAt,
  finishedAt: new Date().toISOString(),
  mode: withRuntime ? "runtime" : "offline",
  status: checks.length === commands.length && checks.every((item) => item.code === 0) ? "ready" : "blocked",
  checks,
};
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/launch-rehearsal-latest.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`\nPróba generalna: ${report.status.toUpperCase()}\nRaport: artifacts/launch-rehearsal-latest.json\n`);
process.exitCode = report.status === "ready" ? 0 : 1;
