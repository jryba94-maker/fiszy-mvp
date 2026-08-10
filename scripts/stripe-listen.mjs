import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";

const ENV_FILES = [".env.local", ".env.development.local"].map((name) =>
  path.join(process.cwd(), name),
);
const FORWARD_TO = "http://127.0.0.1:3000/api/stripe/webhook";
const EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.expired",
];
const require = createRequire(import.meta.url);

function parseEnvValue(rawValue) {
  const value = rawValue.trim();

  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }

  return value;
}

function readLocalEnvironment() {
  if (!existsSync(ENV_FILES[0])) {
    throw new Error("Missing .env.local. Run `vercel env pull .env.local` first.");
  }

  const values = {};

  for (const envFile of ENV_FILES) {
    if (!existsSync(envFile)) continue;

    for (const rawLine of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const separator = line.indexOf("=");
      if (separator <= 0) continue;

      const key = line.slice(0, separator).trim();
      values[key] = parseEnvValue(line.slice(separator + 1));
    }
  }

  return values;
}

function stripeCliBinary() {
  const wrapperDirectory = path.dirname(
    require.resolve("@stripe/cli/package.json"),
  );
  const platforms = JSON.parse(
    readFileSync(path.join(wrapperDirectory, "platforms.json"), "utf8"),
  );
  const platform = platforms[`${process.platform}-${process.arch}`];

  if (!platform) {
    throw new Error(
      `Stripe CLI does not support ${process.platform}-${process.arch}.`,
    );
  }

  const platformDirectory = path.dirname(
    require.resolve(`${platform.pkg}/package.json`),
  );
  return path.join(platformDirectory, "bin", platform.bin);
}

function redactSecrets(line) {
  return line
    .replace(/whsec_[A-Za-z0-9]+/g, "whsec_[REDACTED]")
    .replace(/sk_(?:test|live)_[A-Za-z0-9]+/g, "sk_[REDACTED]");
}

function pipeRedactedLines(stream, output) {
  const lines = createInterface({ input: stream });
  lines.on("line", (line) => output.write(`${redactSecrets(line)}\n`));
}

const localEnvironment = readLocalEnvironment();
const apiKey = localEnvironment.STRIPE_SECRET_KEY;
const configuredWebhookSecret = localEnvironment.STRIPE_WEBHOOK_SECRET;

if (localEnvironment.VERCEL_ENV !== "development") {
  throw new Error("Stripe listener is locked to VERCEL_ENV=development.");
}

if (!apiKey?.startsWith("sk_test_")) {
  throw new Error("STRIPE_SECRET_KEY must be a Stripe test key.");
}

if (!configuredWebhookSecret?.startsWith("whsec_")) {
  throw new Error("STRIPE_WEBHOOK_SECRET is missing or invalid.");
}

const stripeBinary = stripeCliBinary();
const stripeEnvironment = {
  ...process.env,
  NO_COLOR: "1",
  STRIPE_API_KEY: apiKey,
};

const secretCheck = spawnSync(
  stripeBinary,
  ["listen", "--print-secret", "--skip-update"],
  {
    encoding: "utf8",
    env: stripeEnvironment,
    windowsHide: true,
  },
);

const detectedWebhookSecret = `${secretCheck.stdout ?? ""}\n${secretCheck.stderr ?? ""}`
  .match(/whsec_[A-Za-z0-9]+/)?.[0];

if (secretCheck.status !== 0 || detectedWebhookSecret !== configuredWebhookSecret) {
  throw new Error(
    "The local Stripe webhook secret does not match this Development sandbox.",
  );
}

console.log(`Stripe test listener forwarding to ${FORWARD_TO}`);
console.log(`Events: ${EVENTS.join(", ")}`);

const listener = spawn(
  stripeBinary,
  [
    "listen",
    "--skip-update",
    "--events",
    EVENTS.join(","),
    "--forward-to",
    FORWARD_TO,
  ],
  {
    env: stripeEnvironment,
    stdio: ["inherit", "pipe", "pipe"],
    windowsHide: true,
  },
);

pipeRedactedLines(listener.stdout, process.stdout);
pipeRedactedLines(listener.stderr, process.stderr);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => listener.kill(signal));
}

listener.on("exit", (code, signal) => {
  if (signal) {
    process.exitCode = 0;
    return;
  }

  process.exitCode = code ?? 1;
});
