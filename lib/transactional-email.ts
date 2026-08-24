import { createHash } from "node:crypto";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";

function configuredSender() {
  const value = process.env.FISZY_EMAIL_FROM?.trim();
  return value && value.length <= 320 && !/[\r\n]/.test(value) ? value : null;
}

function configuredApiKey() {
  const value = process.env.RESEND_API_KEY?.trim();
  return value?.startsWith("re_") ? value : null;
}

function configuredAlertRecipient() {
  const value = process.env.FISZY_ALERT_EMAIL?.trim().toLowerCase();
  return value && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    ? value
    : null;
}

export function transactionalEmailConfigured() {
  return Boolean(configuredApiKey() && configuredSender());
}

export function systemAlertsConfigured() {
  return Boolean(
    transactionalEmailConfigured() &&
      configuredAlertRecipient() &&
      process.env.CRON_SECRET?.trim(),
  );
}

async function sendEmail(payload: Record<string, unknown>, idempotencyKey: string) {
  const apiKey = configuredApiKey();
  if (!apiKey) throw new Error("Transactional email is not configured.");

  const response = await fetch(RESEND_EMAILS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`Transactional email provider returned ${response.status}.`);
  }
}

export async function sendWaitlistConfirmation(email: string) {
  const apiKey = configuredApiKey();
  const from = configuredSender();
  if (!apiKey || !from) throw new Error("Transactional email is not configured.");

  const recipientHash = createHash("sha256").update(email).digest("hex");
  await sendEmail(
    {
      from,
      to: [email],
      reply_to: "rodo@fiszy.pl",
      subject: "Jesteś na liście Fiszy",
      text: [
        "Jesteś na liście.",
        "",
        "Damy Ci znać przed startem pierwszej aukcji Fiszy.",
        "",
        "Fiszy — przywracamy emocje zakupów.",
      ].join("\n"),
      html: "<div style=\"font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:40px 24px;color:#111114\"><p style=\"font-size:28px;font-weight:700;margin:0 0 24px\">Fiszy<span style=\"color:#7b2cff\">.</span></p><h1 style=\"font-size:32px;line-height:1.1;margin:0 0 20px\">Jesteś na liście.</h1><p style=\"font-size:17px;line-height:1.6;margin:0\">Damy Ci znać przed startem pierwszej aukcji Fiszy.</p><p style=\"font-size:13px;line-height:1.5;color:#6d6875;margin:40px 0 0\">Fiszy — przywracamy emocje zakupów.</p></div>",
    },
    `waitlist-confirmation-v1-${recipientHash}`,
  );
}

export async function sendSystemAlert(issues: string[], checkedAt: string) {
  const from = configuredSender();
  const to = configuredAlertRecipient();
  if (!from || !to || !issues.length) throw new Error("System alerts are not configured.");

  const day = checkedAt.slice(0, 10);
  const safeIssues = issues.map((issue) => issue.replace(/[^a-z0-9_.-]/gi, "").slice(0, 80));
  await sendEmail(
    {
      from,
      to: [to],
      reply_to: "rodo@fiszy.pl",
      subject: "Fiszy: system wymaga uwagi",
      text: `Automatyczna diagnostyka wykryła problemy:\n\n${safeIssues.map((issue) => `- ${issue}`).join("\n")}\n\nCzas kontroli: ${checkedAt}`,
    },
    `system-health-v1-${day}-${createHash("sha256").update(safeIssues.join("|")).digest("hex")}`,
  );
}
