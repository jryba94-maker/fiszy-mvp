import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { NextRequest } from "next/server.js";
import { redis } from "./local-redis-test-client.mjs";
import { autopayDate } from "../lib/payment-providers/autopay-protocol.ts";
import { createAutopaySession, expireAutopaySession } from "../lib/payment-providers/autopay.ts";
import { readAutopayIntent, readAutopayRefund, autopayRefundId, reserveAutopayIntent } from "../lib/autopay-storage.ts";
import { enqueueAuctionPurchase, readAuctionQueueStatus, readAuctionWinner, auctionConfigKey, auctionRecordKey, entryKey, winnerKey } from "../lib/auction-storage.ts";
import { reconcileAuctionTurnDeadline } from "../lib/auction-turn-deadline.ts";
import { advanceAuctionQueue } from "../lib/auction-queue.ts";
import { POST as itn } from "../app/api/payments/autopay/itn/route.ts";
import { POST as istn } from "../app/api/payments/autopay/istn/route.ts";
import { readAuctionOrder } from "../lib/order-storage.ts";
import { recordEntryServiceConsent, readEntryServiceConsent } from "../lib/entry-service-consent.ts";
Object.assign(process.env, { VERCEL_ENV: "development", STORAGE_KV_REST_API_URL: "http://autopay-redis.invalid", STORAGE_KV_REST_API_TOKEN: "test", FISZY_PAYMENT_PROVIDER: "autopay", AUTOPAY_ENVIRONMENT: "sandbox", AUTOPAY_SERVICE_ID: "12345", AUTOPAY_SHARED_KEY: "integration-fixture-key", AUTOPAY_FAST_GATEWAY_ID: "999", AUTOPAY_START_URL: "https://testpay.autopay.eu/payment-fixture", AUTOPAY_HASH_ALGORITHM: "sha256", AUTOPAY_ORDER_REUSE_BLOCKED: "true", CLERK_SECRET_KEY: "sk_test_fixture" });
const digest = values => createHash("sha256").update([...values.map(String), "integration-fixture-key"].join("|")).digest("hex");
const xml = item => `<transactionList><serviceID>12345</serviceID><transactions><transaction>${Object.entries(item).map(([k,v]) => `<${k}>${v}</${k}>`).join("")}</transaction></transactions><hash>${digest(["12345", ...Object.values(item)])}</hash></transactionList>`;
const paidTx = (intent, status = "SUCCESS", remote = intent.remoteId) => ({ orderID: intent.orderId, remoteID: remote, amount: (intent.amount/100).toFixed(2), currency: "PLN", gatewayID: "999", paymentStatus: status });
const notify = (handler, item) => handler(new NextRequest("https://fiszy.pl/api/payments/autopay/itn", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ transactions: Buffer.from(xml(item)).toString("base64") }) }));
let starts = 0, refunds = 0, status = "PENDING", ambiguousCreate = false;
let cancels = 0, cancelMode = "partial", channelMinimum = null, channelGroup = "BLIK";
let afterCancelStatus = "FAILURE", cancelClock = null;
const previousFetch = globalThis.fetch;
const originalNow = Date.now;
globalThis.fetch = async (url, init = {}) => {
  const target = String(url);
  if (target === "http://autopay-redis.invalid") return Response.json({ result: await redis(JSON.parse(init.body)) });
  if (target.startsWith("https://api.clerk.com/v1/users/")) return Response.json({ primary_email_address_id: "email", email_addresses: [{ id: "email", email_address: "fixture@example.com" }] });
  if (target.endsWith("/gatewayList/v3")) {
    const fields = JSON.parse(init.body);
    assert.equal(fields.Hash, digest([fields.ServiceID, fields.MessageID, fields.Currencies, fields.Language]));
    return Response.json({ result: "OK", serviceID: fields.ServiceID, messageID: fields.MessageID, gatewayList: [{ gatewayID: Number(process.env.AUTOPAY_FAST_GATEWAY_ID), groupType: channelGroup, state: "OK", minValidityTime: channelMinimum, currencies: [{ currency: "PLN", minAmount: 0.01, maxAmount: 100000 }] }] });
  }
  if (target.endsWith("/webapi/transactionCancel")) {
    cancels++;
    const fields = new URLSearchParams(init.body);
    assert.equal(fields.get("Hash"), digest([fields.get("ServiceID"), fields.get("MessageID"), fields.get("OrderID")]));
    if (cancelMode === "timeout") throw Error("ambiguous cancel timeout");
    const confirmation = cancelMode === "unconfirmed" ? "NOTCONFIRMED" : "CONFIRMED";
    const reason = cancelMode === "full" || cancelMode === "bad-signature" ? "CANCELED_FULLY" : cancelMode === "unconfirmed" ? "TRANSACTION_NOT_FOUND" : "CANCELED_PARTIALLY";
    if (cancelMode === "full") { status = afterCancelStatus; if (cancelClock !== null) { const completedAt = cancelClock; Date.now = () => completedAt; } }
    const values = ["12345", fields.get("MessageID"), confirmation, reason];
    return new Response(`<transaction><serviceID>${values[0]}</serviceID><messageID>${values[1]}</messageID><confirmation>${confirmation}</confirmation><reason>${reason}</reason><hash>${cancelMode === "bad-signature" ? "0".repeat(64) : digest(values)}</hash></transaction>`);
  }
  if (target === "https://testpay.autopay.eu/payment-fixture") {
    starts++;
    const params = new URLSearchParams(init.body);
    assert.equal(init.headers.BmHeader, "pay-bm-continue-transaction-url");
    assert.equal(params.get("Hash"), digest([...params].filter(([k])=> k !== "Hash").map(([,v])=>v)));
    assert.equal(params.get("GatewayID"), "999");
    assert.ok(params.get("LinkValidityTime"));
    if (params.get("Description").includes("dostep")) {
      const upperBound = autopayDate(new Date(Date.now() + 16 * 60000));
      assert.ok(params.get("LinkValidityTime") <= upperBound, "entry checkout must not stay valid for weeks until the auction starts");
      assert.ok(params.get("ValidityTime") <= upperBound);
    }
    if (!params.get("Description").includes("dostep")) assert.equal(params.get("ValidityTime"), params.get("LinkValidityTime"));
    if (ambiguousCreate) throw Error("timeout after provider accepted");
    const fields = ["PENDING", "https://testpay.autopay.eu/payment/continue/fixture", params.get("OrderID"), "remote123"];
    return new Response(`<transaction><status>${fields[0]}</status><redirecturl>${fields[1]}</redirecturl><orderID>${fields[2]}</orderID><remoteID>${fields[3]}</remoteID><hash>${digest(fields)}</hash></transaction>`);
  }
  if (target.endsWith("/webapi/transactionStatus")) {
    const params = new URLSearchParams(init.body);
    const intent = await readAutopayIntent(`ap_${params.get("OrderID")}`);
    return new Response(xml(paidTx(intent, status, intent.remoteId ?? "remote123")));
  }
  if (target.endsWith("/settlementapi/transactionRefund/v3")) {
    refunds++;
    const data = JSON.parse(init.body);
    assert.equal(data.hash, digest([data.serviceId, data.messageId, data.remoteId]));
    return Response.json({ serviceId: data.serviceId, messageId: data.messageId, hash: digest([data.serviceId, data.messageId]) });
  }
  throw Error(`Unexpected network request ${target}`);
};
const tag = randomUUID();
process.env.VERCEL_ENV = `test-autopay-${tag}`;
const namespace = `fiszy:${process.env.VERCEL_ENV}`;
const run = "run-autopay-test";
const now = Date.now();
const accounts = ["user_fixtureA", "user_fixtureB", "user_fixtureC"];
const bidders = accounts.map(a=>`clerk:${a}`);
const auctions = [];
async function seed(name, future = false) {
  const auction = `autopay-${name}-${tag}`;
  auctions.push(auction);
  const config = { schemaVersion: 2, runId: run, startsAt: new Date(now + (future ? 3600000 : -1000)).toISOString(), productName: "Fixture", productImageUrl: null, category: "other", postAuctionOffer: { enabled: false, validityDays: 7, inventory: null }, entryFee: 5, regularPrice: 100, lowestPrice30DaysBeforeAuction: 100, startPrice: 100, floorPrice: 1, durationMinutes: 10 };
  await redis(["SET", auctionConfigKey(auction), JSON.stringify(config)]);
  await redis(["SET", `${namespace}:auction:${auction}:run:${run}:config`, JSON.stringify(config)]);
  await redis(["SET", auctionRecordKey(auction), JSON.stringify({ ...config, schemaVersion: 1, auctionId: auction, state: "published", currentRunId: run, revision: 1, createdAt: config.startsAt, updatedAt: config.startsAt })]);
  if (!future) {
    for (const bidder of bidders) {
      await redis(["SET", entryKey(run, bidder, auction), "{}"]);
      assert.ok([1,2].includes(await enqueueAuctionPurchase(run, bidder, now - 1000, now + 600000, now, { bidderId: bidder, price: 95 - bidders.indexOf(bidder) * 5, clickedAt: new Date(now).toISOString() }, auction)));
    }
  }
  return auction;
}
try {
  for (const account of accounts) await redis(["SET", `${namespace}:account:${account}:profile`, JSON.stringify({ schemaVersion: 1, accountId: account, revision: 1, fullName: "Fixture User", phone: "+48123456789", address: { label: "Dom", line1: "Testowa 1", line2: null, postalCode: "00-001", city: "Warszawa", country: "PL" }, preferences: { emailAuctionStart: false, emailWin: false, emailOrderUpdates: false, marketing: false, analytics: false }, ageConfirmedAt: new Date(now).toISOString(), deletionRequestedAt: null, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() })]);
  const auction = await seed("paid");
  const head = await readAuctionWinner(run, auction);
  const input = { auctionId: auction, runId: run, bidderId: bidders[0], amount: 9500, claimToken: head.claimedAt, expiresAt: Math.floor(now/1000)+120 };
  const payment = await createAutopaySession("auction_purchase", input);
  const intent = await readAutopayIntent(payment.reference);
  assert.equal((await readAuctionQueueStatus(run,bidders[0],auction)).state,"payment_processing");
  assert.equal((await readAuctionQueueStatus(run,bidders[1],auction)).estimatedTurnAt,null);
  Date.now = () => now + 121000;
  const cancelBefore = cancels;
  await Promise.all(Array.from({length:150},()=>advanceAuctionQueue(auction,run)));
  assert.equal(cancels - cancelBefore, 1, "one cancellation for 150 simultaneous polls even when pending");
  assert.equal((await readAuctionWinner(run,auction)).bidderId,bidders[0]);
  assert.equal(await readAuctionOrder(run,auction),null);
  Date.now = ()=>now+130000;
  assert.equal((await notify(itn,paidTx(intent))).status,200);
  assert.equal((await readAuctionOrder(run,auction)).paymentProvider,"autopay");
  assert.equal((await readAuctionOrder(run,auction)).amount,95);
  const orderId=(await readAuctionOrder(run,auction)).orderId;
  assert.ok((await Promise.all(Array.from({length:10},()=>notify(itn,paidTx(intent))))).every(r=>r.status===200));
  assert.equal((await readAuctionOrder(run,auction)).orderId,orderId);
  assert.equal(refunds,0);
  // A second successful provider transaction for the same order is not a second sale.
  assert.equal((await notify(itn,paidTx(intent,"SUCCESS","remoteDuplicate"))).status,200);
  const refundId=autopayRefundId(intent.reference,"remoteDuplicate");
  assert.equal((await readAutopayRefund(refundId)).state,"submitted");
  await notify(itn,paidTx(intent,"SUCCESS","remoteDuplicate"));
  assert.equal(refunds,1);
  const settlement={isRefund:"true",orderID:intent.orderId,orderOutID:refundId,remoteID:"remoteDuplicate",remoteOutID:"out123",amount:"95.00",currency:"PLN",transferStatus:"SUCCESS",transferStatusDetails:"AUTHORIZED"};
  assert.equal((await notify(istn,settlement)).status,200);
  assert.equal((await readAutopayRefund(refundId)).state,"submitted");
  assert.equal((await notify(istn,{...settlement,transferStatusDetails:"CONFIRMED"})).status,200);
  assert.equal((await readAutopayRefund(refundId)).state,"completed");
  await notify(istn,{...settlement,transferStatus:"FAILURE"});
  assert.equal((await readAutopayRefund(refundId)).state,"completed");
  Date.now=originalNow;
  const failedAuction=await seed("failure");
  const failedHead=await readAuctionWinner(run,failedAuction);
  const failed=await createAutopaySession("auction_purchase",{...input,auctionId:failedAuction,claimToken:failedHead.claimedAt});
  status="FAILURE";
  assert.equal((await notify(itn,paidTx(await readAutopayIntent(failed.reference),"FAILURE"))).status,200);
  assert.equal((await readAuctionWinner(run,failedAuction)).bidderId,bidders[1]);
  // An ambiguous create is persisted and cannot free the product or create a new intent.
  const unknownAuction=await seed("unknown");
  const unknownHead=await readAuctionWinner(run,unknownAuction);
  const unknownInput={...input,auctionId:unknownAuction,claimToken:unknownHead.claimedAt};
  ambiguousCreate=true; status="PENDING";
  await assert.rejects(createAutopaySession("auction_purchase",unknownInput),/timeout/);
  const startsBeforeRetry=starts;
  await assert.rejects(createAutopaySession("auction_purchase",unknownInput),/reconciled/);
  assert.equal(starts,startsBeforeRetry);
  await advanceAuctionQueue(unknownAuction,run,now+121000);
  assert.equal((await readAuctionWinner(run,unknownAuction)).bidderId,bidders[0]);
  ambiguousCreate=false;
  // Every unresolved cancellation variant retains the head. Full cancellation
  // also needs a terminal status, and promotion uses completion time, not the
  // time a slow cancellation request began.
  const cutoffAuction = await seed("cutoff");
  const cutoffHead = await readAuctionWinner(run, cutoffAuction);
  const cutoff = await createAutopaySession("auction_purchase", { ...input, auctionId: cutoffAuction, claimToken: cutoffHead.claimedAt });
  const cutoffIntent = await readAutopayIntent(cutoff.reference);
  assert.equal(cutoffIntent.paymentValidUntil, cutoffIntent.expiresAt);
  assert.equal(Date.parse(cutoffIntent.expiresAt), input.expiresAt * 1000);
  const startsWhileQueued = starts;
  await assert.rejects(createAutopaySession("auction_purchase", { ...input, auctionId: cutoffAuction, bidderId: bidders[1], amount: 9000 }), /Purchase claim is no longer current/);
  assert.equal(starts, startsWhileQueued, "queued buyer must have no remote checkout");
  Date.now = () => now + 600000; // buyer #2 has already waited ten minutes
  for (const mode of ["partial", "unconfirmed", "timeout", "bad-signature"]) {
    cancelMode = mode; status = "PENDING";
    try { await advanceAuctionQueue(cutoffAuction, run); } catch (error) { assert.ok(["timeout", "bad-signature"].includes(mode)); }
    assert.equal((await readAuctionWinner(run, cutoffAuction)).bidderId, bidders[0]);
    await redis(["DEL", `${winnerKey(run, cutoffAuction)}:advancing`]); // simulate retry delay
  }
  cancelMode = "full"; afterCancelStatus = "SUCCESS"; status = "PENDING";
  await advanceAuctionQueue(cutoffAuction, run);
  assert.equal((await readAuctionWinner(run, cutoffAuction)).bidderId, bidders[0], "SUCCESS racing cancellation must keep the original claim");
  await redis(["DEL", `${winnerKey(run, cutoffAuction)}:advancing`]);
  afterCancelStatus = "PENDING"; status = "PENDING";
  await advanceAuctionQueue(cutoffAuction, run);
  assert.equal((await readAuctionWinner(run, cutoffAuction)).bidderId, bidders[0], "remaining pending blocks promotion even after full cancel ack");
  await redis(["DEL", `${winnerKey(run, cutoffAuction)}:advancing`]);
  afterCancelStatus = "FAILURE"; status = "PENDING"; cancelClock = now + 605000;
  await advanceAuctionQueue(cutoffAuction, run);
  const promoted = await readAuctionWinner(run, cutoffAuction);
  assert.equal(promoted.bidderId, bidders[1]);
  assert.equal(promoted.price, 90);
  assert.equal(promoted.claimedAt, new Date(now + 605000).toISOString(), "cancellation delay must not shorten next turn");
  assert.equal(promoted.paymentSessionId, undefined, "promotion alone does not create an operator transaction");
  assert.equal(starts, startsWhileQueued);
  status = "PENDING"; cancelClock = null;
  const secondExpiry = Math.floor(Date.parse(promoted.claimedAt) / 1000) + 120;
  const secondPayment = await createAutopaySession("auction_purchase", { ...input, auctionId: cutoffAuction, bidderId: bidders[1], amount: 9000, claimToken: promoted.claimedAt, expiresAt: secondExpiry });
  const secondIntent = await readAutopayIntent(secondPayment.reference);
  assert.equal(secondIntent.amount, 9000);
  assert.notEqual(secondIntent.orderId, cutoffIntent.orderId);
  assert.equal(secondIntent.paymentValidUntil, new Date(secondExpiry * 1000).toISOString());
  assert.ok(Date.parse(secondIntent.expiresAt) - Date.now() > 119000);
  // A server-side deadline trigger works without a browser and does not restart
  // the queued buyer's timer from their original click. Wait is virtual in tests.
  const secondHead = await readAuctionWinner(run, cutoffAuction);
  let waits = 0;
  await Promise.all(Array.from({length:150}, () => reconcileAuctionTurnDeadline(cutoffAuction, run, secondHead, async milliseconds => {
    waits++;
    assert.ok(milliseconds > 119000 && milliseconds <= 120000);
    const atDeadline = Date.now() + milliseconds;
    Date.now = () => atDeadline;
  })));
  assert.equal(waits, 1, "one server timer per turn despite duplicate requests");
  assert.equal((await readAuctionWinner(run, cutoffAuction)).bidderId, bidders[2]);
  assert.equal((await readAuctionWinner(run, cutoffAuction)).price, 85);
  // Refuse a slow or BNPL channel, never silently extend the auction deadline.
  Date.now = originalNow;
  process.env.AUTOPAY_FAST_GATEWAY_ID = "998"; channelMinimum = 60;
  const beforeSlowChannel = starts;
  await assert.rejects(createAutopaySession("auction_purchase", input), /cannot support/);
  assert.equal(starts, beforeSlowChannel);
  process.env.AUTOPAY_FAST_GATEWAY_ID = "997"; channelMinimum = null; channelGroup = "BNPL";
  await assert.rejects(createAutopaySession("auction_purchase", input), /cannot support/);
  assert.equal(starts, beforeSlowChannel);
  process.env.AUTOPAY_FAST_GATEWAY_ID = "999"; channelGroup = "BLIK";
  const entryAuction=await seed("entry",true);
  const consentInput={accountId:accounts[0],auctionId:entryAuction,runId:run,fee:5};
  const consents=await Promise.all(Array.from({length:150},()=>recordEntryServiceConsent(consentInput)));
  assert.equal(new Set(consents.map(x=>x.id)).size,1);
  const consent=await readEntryServiceConsent(consents[0].id);
  assert.match(consent.text,/pełnym wykonaniu/);assert.match(consent.contract,/14 dni/);
  const entry=await createAutopaySession("auction_entry",{auctionId:entryAuction,runId:run,bidderId:bidders[0],amount:500,entryConsentId:consent.id,expiresAt:Math.floor(now/1000)+41*86400});
  assert.equal(await redis(["GET",entryKey(run,bidders[0],entryAuction)]),null);
  assert.equal((await notify(itn,paidTx(await readAutopayIntent(entry.reference)))).status,200);
  assert.ok(await redis(["GET",entryKey(run,bidders[0],entryAuction)]));
  const messages=await redis(["KEYS",`${namespace}:message:*`]);
  // Receipt content is independently persisted as an outbox record, not a mutable web link only.
  const allKeys=await redis(["KEYS",`${namespace}:*`]);
  let foundReceipt=false;
  for (const key of allKeys.filter(k=>k.includes("outbox") && k.includes("MSG-"))) {
    const type=await redis(["TYPE",key]); if(type!=="string") continue;
    const value=await redis(["GET",key]);
    if(value?.includes(consent.version) && value.includes("Warunki usługi")) foundReceipt=true;
  }
  assert.equal(foundReceipt,true);
  console.log(JSON.stringify({outcome:"passed",concurrentAdvanceRequests:150,consentRetries:150,duplicatePaidNotifications:10,lateSuccess:"one order",ambiguousCreate:"held",failure:"next buyer",cutoff:"pending cancel + signed full close and status required",queuedWindow:"fresh 120 seconds at promotion after 10 minutes wait",slowChannels:"rejected",refund:"only bank CONFIRMED completes",entry:"only ITN grants; immutable receipt persisted",note:"Real isolated Redis/Lua; provider HTTP responses simulated. No live Autopay certification."}));
} finally {
  Date.now=originalNow;globalThis.fetch=previousFetch;
  const keys = await redis(["KEYS", `${namespace}:*`]);
  if (keys.length) await redis(["DEL", ...keys]);
}
