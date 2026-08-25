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

function validRecipient(value: string) {
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : null;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
  const result = await response.json() as { id?: unknown };
  if (typeof result.id !== "string" || !/^[A-Za-z0-9-]{8,100}$/.test(result.id)) {
    throw new Error("Transactional email provider returned an invalid message id.");
  }
  return result.id;
}

export type TransactionalMessageTemplate =
  | "waitlist_confirmation"
  | "entry_confirmation"
  | "auction_reminder"
  | "auction_start"
  | "auction_win"
  | "discount_available"
  | "order_confirmation"
  | "order_update"
  | "service_case_update";

export async function sendTransactionalMessage(input: {
  to: string;
  template: TransactionalMessageTemplate;
  idempotencyKey: string;
  title: string;
  text: string;
  actionLabel?: string | null;
  actionUrl?: string | null;
  scheduledAt?: string | null;
}) {
  const from = configuredSender();
  const to = validRecipient(input.to);
  const title = input.title.trim().slice(0, 160);
  const message = input.text.trim().slice(0, 4000);
  const actionLabel = input.actionLabel?.trim().slice(0, 80) || null;
  let actionUrl: string | null = null;
  if (input.actionUrl) {
    try {
      const parsed = new URL(input.actionUrl);
      if (parsed.protocol === "https:") actionUrl = parsed.toString();
    } catch {
      actionUrl = null;
    }
  }
  if (
    !from ||
    !to ||
    !title ||
    !message ||
    !/^[a-z0-9][a-z0-9_.:-]{7,200}$/i.test(input.idempotencyKey)
  ) {
    throw new Error("Transactional message is invalid or not configured.");
  }
  const scheduledAt = input.scheduledAt && Number.isFinite(Date.parse(input.scheduledAt))
    ? new Date(input.scheduledAt).toISOString()
    : null;
  const actionText = actionLabel && actionUrl ? `\n\n${actionLabel}: ${actionUrl}` : "";
  const actionHtml = actionLabel && actionUrl
    ? `<p style="margin:28px 0 0"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#7b2cff;color:#fff;text-decoration:none;font-weight:700;padding:14px 20px;border-radius:999px">${escapeHtml(actionLabel)}</a></p>`
    : "";
  return sendEmail(
    {
      from,
      to: [to],
      reply_to: "rodo@fiszy.pl",
      ...(scheduledAt ? { scheduled_at: scheduledAt } : {}),
      subject: `${title} · Fiszy`,
      text: `${title}\n\n${message}${actionText}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:40px 24px;color:#111114"><p style="font-size:28px;font-weight:700;margin:0 0 24px">Fiszy<span style="color:#7b2cff">.</span></p><h1 style="font-size:30px;line-height:1.15;margin:0 0 20px">${escapeHtml(title)}</h1><p style="font-size:17px;line-height:1.6;white-space:pre-line;margin:0">${escapeHtml(message)}</p>${actionHtml}<p style="font-size:12px;line-height:1.5;color:#6d6875;margin:36px 0 0">Wiadomość transakcyjna Fiszy · ${escapeHtml(input.template)}</p></div>`,
    },
    input.idempotencyKey,
  );
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

export async function sendOrderFulfillmentUpdate(input: {
  email: string;
  orderId: string;
  product: string;
  status: "new" | "preparing" | "shipped" | "delivered";
  revision: number;
  carrier?: string | null;
  trackingNumber?: string | null;
}) {
  const from = configuredSender();
  const to = validRecipient(input.email);
  if (!from || !to) throw new Error("Order e-mail is not configured.");
  const labels = {
    new: "Zamówienie przyjęte",
    preparing: "Przygotowujemy Twoje zamówienie",
    shipped: "Twoje zamówienie zostało wysłane",
    delivered: "Zamówienie zostało dostarczone",
  } as const;
  const label = labels[input.status];
  const tracking = input.carrier && input.trackingNumber
    ? `Przewoźnik: ${input.carrier}\nNumer przesyłki: ${input.trackingNumber}`
    : null;
  const htmlTracking = input.carrier && input.trackingNumber
    ? `<p style="font-size:15px;line-height:1.6;margin:20px 0 0"><strong>${escapeHtml(input.carrier)}</strong><br>${escapeHtml(input.trackingNumber)}</p>`
    : "";
  await sendEmail(
    {
      from,
      to: [to],
      reply_to: "rodo@fiszy.pl",
      subject: `${label} · Fiszy`,
      text: [
        label,
        "",
        input.product,
        `Zamówienie: ${input.orderId}`,
        ...(tracking ? ["", tracking] : []),
        "",
        "Aktualny status zobaczysz także w sekcji Moje Fiszy.",
      ].join("\n"),
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:40px 24px;color:#111114"><p style="font-size:28px;font-weight:700;margin:0 0 24px">Fiszy<span style="color:#7b2cff">.</span></p><h1 style="font-size:30px;line-height:1.15;margin:0 0 20px">${escapeHtml(label)}</h1><p style="font-size:17px;line-height:1.6;margin:0">${escapeHtml(input.product)}</p><p style="font-size:13px;line-height:1.5;color:#6d6875;margin:8px 0 0">Zamówienie ${escapeHtml(input.orderId)}</p>${htmlTracking}<p style="font-size:13px;line-height:1.5;color:#6d6875;margin:36px 0 0">Aktualny status zobaczysz także w sekcji Moje Fiszy.</p></div>`,
    },
    `order-fulfillment-v1-${createHash("sha256").update(`${input.orderId}\u0000${input.revision}\u0000${input.status}`).digest("hex")}`,
  );
}
