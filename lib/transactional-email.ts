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

export function transactionalEmailConfigured() {
  return Boolean(configuredApiKey() && configuredSender());
}

export async function sendWaitlistConfirmation(email: string) {
  const apiKey = configuredApiKey();
  const from = configuredSender();
  if (!apiKey || !from) throw new Error("Transactional email is not configured.");

  const recipientHash = createHash("sha256").update(email).digest("hex");
  const response = await fetch(RESEND_EMAILS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `waitlist-confirmation-v1-${recipientHash}`,
    },
    body: JSON.stringify({
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
    }),
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`Transactional email provider returned ${response.status}.`);
  }
}
