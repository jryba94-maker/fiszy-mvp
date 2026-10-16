import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { autopayConfiguration, autopayHash, verifyAutopayHash, verifyAutopayTransactions, autopayAcknowledgement, parseAutopayXml, autopayDate } from "../lib/payment-providers/autopay-protocol.ts";
import { isPaymentProviderConfigured } from "../lib/payment-provider.ts";
import { parseAuctionDefinition, parseStoredAuctionDefinition, auctionPublishIssues, defaultAuctionDefinition } from "../lib/auction.ts";

Object.assign(process.env, { AUTOPAY_SERVICE_ID: "12345", AUTOPAY_SHARED_KEY: "unit-fixture-key", AUTOPAY_FAST_GATEWAY_ID: "999", AUTOPAY_START_URL: "https://testpay.autopay.eu/payment-fixture", AUTOPAY_ENVIRONMENT: "sandbox", AUTOPAY_HASH_ALGORITHM: "sha256" });
const digest = values => createHash("sha256").update([...values, "unit-fixture-key"].join("|")).digest("hex");
const tx = { orderID: "a".repeat(32), remoteID: "remote123", amount: "5.00", currency: "PLN", gatewayID: "999", paymentDate: "20261016220000", paymentStatus: "SUCCESS" };
const signed = (item = tx) => `<transactionList><serviceID>12345</serviceID><transactions><transaction>${Object.entries(item).map(([key, value]) => `<${key}>${value}</${key}>`).join("")}</transaction></transactions><hash>${digest(["12345", ...Object.values(item)])}</hash></transactionList>`;

test("Autopay signing omits empty optional values, verifies constant length and supports agreed SHA512", () => {
  assert.equal(autopayHash(["12345", "", null, undefined, "5.00"]), digest(["12345", "5.00"]));
  assert.doesNotThrow(() => verifyAutopayHash(["a"], digest(["a"]).toUpperCase()));
  assert.throws(() => verifyAutopayHash(["a"], "0".repeat(64)));
  assert.throws(() => verifyAutopayHash(["a"], "0".repeat(62)));
  process.env.AUTOPAY_HASH_ALGORITHM = "sha512";
  assert.equal(autopayHash(["a"]), createHash("sha512").update("a|unit-fixture-key").digest("hex"));
  process.env.AUTOPAY_HASH_ALGORITHM = "sha256";
});
test("ITN rejects tampering, foreign service, duplicates, unknown fields, malformed amounts and XML entities", () => {
  assert.deepEqual(verifyAutopayTransactions(signed()), [tx]);
  for (const xml of [signed().replace("5.00", "9.00"), signed().replace("<serviceID>12345", "<serviceID>98765"), signed().replace("<amount>5.00</amount>", "<amount>5.00</amount><amount>9.00</amount>"), signed().replace("</transaction>", "<ignored>value</ignored></transaction>"), signed({ ...tx, amount: "5" }), '<!DOCTYPE root [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + signed(), signed().replace("<amount>5.00</amount>", "<amount><![CDATA[5.00]]></amount>")]) assert.throws(() => verifyAutopayTransactions(xml));
  assert.throws(() => parseAutopayXml("x".repeat(131073)));
  // Signature order is the specified canonical field order, not attacker-controlled tag order.
  const moved = signed().replace("<amount>5.00</amount>", "").replace("</transaction>", "<amount>5.00</amount></transaction>");
  assert.deepEqual(verifyAutopayTransactions(moved), [tx]);
  assert.match(autopayAcknowledgement([tx, tx]), new RegExp(digest(["12345", tx.orderID, "CONFIRMED"])));
});
test("ISTN has a separate canonical signature and acknowledgement keyed by remoteOutID", () => {
  const item = { isRefund: "true", orderID: tx.orderID, orderOutID: "b".repeat(32), remoteID: tx.remoteID, remoteOutID: "out123", amount: "5.00", currency: "PLN", transferStatus: "SUCCESS", transferStatusDetails: "CONFIRMED" };
  assert.deepEqual(verifyAutopayTransactions(signed(item), true), [item]);
  assert.throws(() => verifyAutopayTransactions(signed(item)));
  assert.match(autopayAcknowledgement([item], true), /<remoteOutID>out123<\/remoteOutID>/);
});
test("production activation fails closed without sandbox verification, real seller data and order reuse protection", () => {
  process.env.FISZY_PAYMENT_PROVIDER = "autopay";
  delete process.env.AUTOPAY_ORDER_REUSE_BLOCKED;
  assert.equal(isPaymentProviderConfigured(), false);
  process.env.AUTOPAY_ORDER_REUSE_BLOCKED = "true";
  assert.equal(isPaymentProviderConfigured(), true);
  process.env.AUTOPAY_ENVIRONMENT = "production";
  process.env.AUTOPAY_START_URL = "https://pay.autopay.eu/payment-fixture";
  delete process.env.AUTOPAY_INTEGRATION_VERIFIED;
  assert.equal(isPaymentProviderConfigured(), false);
  process.env.AUTOPAY_INTEGRATION_VERIFIED = "true";
  delete process.env.FISZY_SELLER_ADDRESS;
  assert.equal(isPaymentProviderConfigured(), false);
  process.env.FISZY_SELLER_ADDRESS = "fixture address";
  process.env.FISZY_CONTACT_PHONE = "+48123456789";
  assert.equal(isPaymentProviderConfigured(), true);
  process.env.AUTOPAY_START_URL = "https://pay.autopay.eu.attacker.invalid/pay";
  assert.equal(autopayConfiguration().credentialsConfigured, false);
  assert.equal(isPaymentProviderConfigured(), false);
  process.env.AUTOPAY_START_URL = "https://pay.autopay.eu/pay?key=secret";
  assert.equal(autopayConfiguration().credentialsConfigured, false);
});
test("Warsaw validity date and immutable price history keep independent meaning", () => {
  assert.equal(autopayDate(new Date("2026-10-16T20:00:00Z")), "2026-10-16 22:00:00");
  const definition = { ...defaultAuctionDefinition(), lowestPrice30DaysBeforeAuction: 899 };
  assert.equal(parseAuctionDefinition(definition).lowestPrice30DaysBeforeAuction, 899);
  assert.equal(parseStoredAuctionDefinition(definition).lowestPrice30DaysBeforeAuction, 899);
  assert.equal(parseAuctionDefinition({ ...definition, lowestPrice30DaysBeforeAuction: -1 }), null);
  assert.ok(auctionPublishIssues(defaultAuctionDefinition()).includes("lowest_price_history_missing"));
  assert.equal(parseStoredAuctionDefinition(defaultAuctionDefinition()).lowestPrice30DaysBeforeAuction, undefined);
});
