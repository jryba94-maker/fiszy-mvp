import { createHash } from "node:crypto";
import type { AuctionConfig } from "./auction";
import { listRunParticipants, type AuctionWinner } from "./auction-storage";
import { accountIdFromParticipantId, readClerkAccountEmail } from "./account-email";
import {
  issuePostAuctionDiscount,
  preparePostAuctionDiscount,
  type PostAuctionDiscount,
} from "./discount-storage";
import { enqueueTransactionalMessage } from "./message-outbox";
import type { AuctionOrder } from "./order-storage";
import { readAccountProfile } from "./portal-storage";
import { absoluteSiteUrl } from "./site";

function money(value: number) {
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
  }).format(value);
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Warsaw",
  }).format(new Date(value));
}

function ref(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 40);
}

async function recipientForParticipant(participantId: string, fallback?: string | null) {
  const accountId = accountIdFromParticipantId(participantId);
  if (!accountId) return null;
  const email = fallback?.trim().toLowerCase() || await readClerkAccountEmail(accountId);
  return email ? { accountId, email } : null;
}

export async function queueEntryAndReminderEmails(input: {
  auctionId: string;
  participantId: string;
  recipient?: string | null;
  config: AuctionConfig;
}) {
  const recipient = await recipientForParticipant(input.participantId, input.recipient);
  if (!recipient) return { queued: 0 };
  const auctionUrl = absoluteSiteUrl(`/aukcje/${encodeURIComponent(input.auctionId)}`);
  let queued = 0;
  const confirmation = await enqueueTransactionalMessage({
    dedupeKey: `entry.confirmation.v1.${ref(`${input.auctionId}\0${input.config.runId}\0${recipient.accountId}`)}`,
    accountId: recipient.accountId,
    recipient: recipient.email,
    template: "entry_confirmation",
    title: "Masz wejście na aukcję",
    text: `${input.config.productName}\nOpłata za wejście: ${money(input.config.entryFee)}\nStart: ${dateTime(input.config.startsAt)}`,
    actionLabel: "Zobacz aukcję",
    actionUrl: auctionUrl,
  });
  if (confirmation.created) queued += 1;

  const profile = await readAccountProfile(recipient.accountId);
  if (profile?.preferences.emailAuctionStart === false) return { queued };
  const startsAt = Date.parse(input.config.startsAt);
  const now = Date.now();
  for (const leadMinutes of [60, 10]) {
    const scheduledAt = startsAt - leadMinutes * 60_000;
    if (scheduledAt <= now + 60_000 || scheduledAt > now + 30 * 86_400_000) continue;
    const reminder = await enqueueTransactionalMessage({
      dedupeKey: `auction.reminder.v1.${leadMinutes}.${ref(`${input.auctionId}\0${input.config.runId}\0${recipient.accountId}`)}`,
      accountId: recipient.accountId,
      recipient: recipient.email,
      template: "auction_reminder",
      title: leadMinutes === 60 ? "Aukcja startuje za godzinę" : "Aukcja startuje za 10 minut",
      text: `${input.config.productName}\nStart: ${dateTime(input.config.startsAt)}\nPrzygotuj swój moment.`,
      actionLabel: "Przejdź do aukcji",
      actionUrl: auctionUrl,
      scheduledAt: new Date(scheduledAt).toISOString(),
    });
    if (reminder.created) queued += 1;
  }
  return { queued };
}

export async function queueWinnerEmail(input: {
  participantId: string;
  auctionId: string;
  runId: string;
  product: string;
  price: number;
  paymentExpiresAt?: string | null;
}) {
  const recipient = await recipientForParticipant(input.participantId);
  if (!recipient) return { queued: false };
  const profile = await readAccountProfile(recipient.accountId);
  if (profile?.preferences.emailWin === false) return { queued: false };
  const result = await enqueueTransactionalMessage({
    dedupeKey: `auction.win.v1.${ref(`${input.auctionId}\0${input.runId}\0${recipient.accountId}`)}`,
    accountId: recipient.accountId,
    recipient: recipient.email,
    template: "auction_win",
    title: "Wygrywasz aukcję",
    text: `${input.product}\nWygrana cena: ${money(input.price)}${input.paymentExpiresAt ? `\nDokończ zakup do ${dateTime(input.paymentExpiresAt)}.` : ""}`,
    actionLabel: "Dokończ zakup",
    actionUrl: absoluteSiteUrl(`/aukcje/${encodeURIComponent(input.auctionId)}`),
  });
  return { queued: result.created };
}

export async function queueOrderConfirmationEmail(order: AuctionOrder) {
  const recipient = await recipientForParticipant(order.bidderId, order.customer.email);
  if (!recipient) return { queued: false };
  const result = await enqueueTransactionalMessage({
    dedupeKey: `order.confirmation.v1.${ref(order.orderId)}`,
    accountId: recipient.accountId,
    recipient: recipient.email,
    template: "order_confirmation",
    title: "Płatność przyjęta — zamówienie potwierdzone",
    text: `${order.product}\nKwota: ${money(order.amount)}\nNumer zamówienia: ${order.orderId}`,
    actionLabel: "Zobacz zamówienie",
    actionUrl: absoluteSiteUrl("/moje-fiszy#historia"),
  });
  return { queued: result.created };
}

export async function queueDiscountAvailableEmail(discount: PostAuctionDiscount) {
  const recipient = await recipientForParticipant(discount.participantId);
  if (!recipient || discount.state !== "available") return { queued: false };
  const result = await enqueueTransactionalMessage({
    dedupeKey: `discount.available.v1.${ref(discount.discountId)}`,
    accountId: recipient.accountId,
    recipient: recipient.email,
    template: "discount_available",
    title: `Masz rabat ${money(discount.discountAmount)}`,
    text: `${discount.product}\nCena regularna: ${money(discount.regularPrice)}\nCena z rabatem: ${money(discount.finalPrice)}\nRabat jest ważny do ${dateTime(discount.expiresAt)}.`,
    actionLabel: "Kup z rabatem",
    actionUrl: absoluteSiteUrl("/moje-fiszy#rabaty"),
  });
  return { queued: result.created };
}

export async function issueAndQueueRunDiscountEmails(input: {
  auctionId: string;
  config: AuctionConfig;
  winner: AuctionWinner | null;
  order?: AuctionOrder | null;
  maxParticipants?: number;
}) {
  const maxParticipants = Math.min(Math.max(input.maxParticipants ?? 200, 1), 500);
  let cursor: string | null = null;
  let processed = 0;
  let issued = 0;
  let queued = 0;
  do {
    const page = await listRunParticipants({
      auctionId: input.auctionId,
      runId: input.config.runId,
      cursor,
      limit: Math.min(50, maxParticipants - processed),
    });
    if (!page) break;
    for (const participant of page.participants) {
      const accountId = accountIdFromParticipantId(participant.participantId);
      if (!accountId) continue;
      const prepared = preparePostAuctionDiscount({
        accountId,
        participant,
        config: input.config,
        winner: input.winner,
        order: input.order,
      });
      if (!prepared) continue;
      const discount = await issuePostAuctionDiscount(prepared);
      issued += 1;
      if ((await queueDiscountAvailableEmail(discount)).queued) queued += 1;
    }
    processed += page.participants.length;
    cursor = page.nextCursor;
  } while (cursor && processed < maxParticipants);
  return { processed, issued, queued, hasMore: Boolean(cursor) };
}
