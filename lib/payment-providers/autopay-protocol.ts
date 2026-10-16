import { createHash, timingSafeEqual } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";

// Official protocol: https://developers.autopay.pl/online/dokumentacja
export function autopayConfiguration() {
  const sandbox = process.env.AUTOPAY_ENVIRONMENT !== "production";
  const host = sandbox ? "https://testpay.autopay.eu" : "https://pay.autopay.eu";
  let startUrl: string | null = null;
  try {
    const url = new URL(process.env.AUTOPAY_START_URL ?? "");
    if (url.origin === host && !url.username && !url.password && !url.search && !url.hash) startUrl = url.toString();
  } catch { /* Missing configuration keeps the adapter disabled. */ }
  const serviceId = process.env.AUTOPAY_SERVICE_ID ?? "";
  const gatewayId = process.env.AUTOPAY_FAST_GATEWAY_ID ?? "";
  const key = process.env.AUTOPAY_SHARED_KEY ?? "";
  const algorithm = process.env.AUTOPAY_HASH_ALGORITHM ?? "sha256";
  const credentialsConfigured = /^\d{1,10}$/.test(serviceId) && /^\d{1,5}$/.test(gatewayId) && Number(gatewayId) > 0 && Boolean(key) && Boolean(startUrl) && ["sha256", "sha512"].includes(algorithm);
  return { sandbox, host, startUrl, serviceId, gatewayId, key, algorithm, credentialsConfigured,
    orderReuseBlocked: process.env.AUTOPAY_ORDER_REUSE_BLOCKED === "true",
    verified: process.env.AUTOPAY_INTEGRATION_VERIFIED === "true" };
}

export function autopayHash(values: Array<string | number | null | undefined>) {
  const config = autopayConfiguration();
  if (!config.key || !["sha256", "sha512"].includes(config.algorithm)) throw new Error("Autopay signing is not configured.");
  return createHash(config.algorithm).update([...values.filter(value => value !== null && value !== undefined && String(value) !== "").map(String), config.key].join("|"), "utf8").digest("hex");
}

export function verifyAutopayHash(values: Array<string | number | null | undefined>, received: unknown) {
  const expected = autopayHash(values);
  if (typeof received !== "string" || !/^[a-fA-F0-9]+$/.test(received) || received.length !== expected.length ||
      !timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"))) throw new Error("Invalid Autopay signature.");
}

type XmlRecord = Record<string, unknown>;
export function xmlRecord(value: unknown): XmlRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Autopay XML structure.");
  return value as XmlRecord;
}
export function xmlField(node: XmlRecord, key: string, required = true): string {
  const value = node[key];
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || (required && !value)) throw new Error(`Invalid Autopay XML field: ${key}`);
  return value;
}
export function parseAutopayXml(xml: string) {
  if (Buffer.byteLength(xml, "utf8") > 131072 || /<!DOCTYPE|<!ENTITY|<!\[CDATA\[|\0/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error("Invalid Autopay XML.");
  const parser = new XMLParser({ ignoreAttributes: false, ignoreDeclaration: true, parseTagValue: false, trimValues: true, processEntities: true });
  return xmlRecord(parser.parse(xml));
}
function onlyFields(node: XmlRecord, fields: string[]) {
  if (Object.keys(node).some(key => !fields.includes(key))) throw new Error("Unsupported Autopay XML field.");
}

const ITN_FIELDS = ["orderID", "remoteID", "amount", "currency", "gatewayID", "paymentDate", "paymentStatus", "paymentStatusDetails"];
const ISTN_FIELDS = ["isRefund", "productID", "orderID", "orderOutID", "remoteID", "remoteOutID", "amount", "currency", "transferDate", "transferStatus", "transferStatusDetails", "title", "receiverBank", "receiverNRB", "receiverName", "receiverAddress", "senderBank", "senderNRB"];
export type AutopayTransaction = Record<string, string>;

export function verifyAutopayTransactions(xml: string, settlement = false): AutopayTransaction[] {
  const root = parseAutopayXml(xml);
  onlyFields(root, ["transactionList"]);
  const list = xmlRecord(root.transactionList);
  onlyFields(list, ["serviceID", "transactions", "hash"]);
  const serviceId = xmlField(list, "serviceID");
  if (serviceId !== autopayConfiguration().serviceId) throw new Error("Wrong Autopay service.");
  const container = xmlRecord(list.transactions);
  onlyFields(container, ["transaction"]);
  const raw = Array.isArray(container.transaction) ? container.transaction : [container.transaction];
  if (!raw.length || raw.length > 50) throw new Error("Invalid Autopay transaction count.");
  const fields = settlement ? ISTN_FIELDS : ITN_FIELDS;
  const values: string[] = [serviceId];
  const transactions = raw.map(value => {
    const node = xmlRecord(value);
    onlyFields(node, fields);
    const item: AutopayTransaction = {};
    for (const key of fields) {
      const field = xmlField(node, key, false);
      if (field) { values.push(field); item[key] = field; }
    }
    if (!/^\d+\.\d{2}$/.test(item.amount ?? "") || item.currency !== "PLN") throw new Error("Invalid Autopay money.");
    const status = item[settlement ? "transferStatus" : "paymentStatus"];
    if (!["PENDING", "SUCCESS", "FAILURE"].includes(status)) throw new Error("Invalid Autopay payment status.");
    if (!settlement && (!/^[A-Za-z0-9_-]{1,32}$/.test(item.orderID ?? "") || !/^[A-Za-z0-9]{1,20}$/.test(item.remoteID ?? ""))) throw new Error("Invalid Autopay transaction identity.");
    return item;
  });
  verifyAutopayHash(values, xmlField(list, "hash"));
  return transactions;
}

export function autopayAcknowledgement(transactions: AutopayTransaction[], settlement = false) {
  const serviceId = autopayConfiguration().serviceId;
  const field = settlement ? "remoteOutID" : "orderID";
  const ids = [...new Set(transactions.map(tx => tx[field]))];
  if (ids.some(id => !/^[A-Za-z0-9_-]{1,32}$/.test(id ?? ""))) throw new Error("Invalid Autopay acknowledgement.");
  const hash = autopayHash([serviceId, ...ids.flatMap(id => [id, "CONFIRMED"])]);
  return `<?xml version="1.0" encoding="UTF-8"?><confirmationList><serviceID>${serviceId}</serviceID><transactionsConfirmations>${ids.map(id => `<transactionConfirmed><${field}>${id}</${field}><confirmation>CONFIRMED</confirmation></transactionConfirmed>`).join("")}</transactionsConfirmations><hash>${hash}</hash></confirmationList>`;
}

export async function autopayPost(path: string, fields: Record<string, string>, continuation = false) {
  const config = autopayConfiguration();
  const response = await fetch(continuation ? config.startUrl! : `${config.host}${path}`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", BmHeader: continuation ? "pay-bm-continue-transaction-url" : "pay-bm" },
    body: new URLSearchParams({ ...fields, Hash: autopayHash(Object.values(fields)) }),
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Autopay request failed.");
  return response.text();
}

export function autopayDate(date: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
