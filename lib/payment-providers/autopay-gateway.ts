import { randomUUID } from "node:crypto";
import { autopayConfiguration, autopayHash } from "./autopay-protocol";

type Gateway = { gatewayID?: number; groupType?: string; state?: string; minValidityTime?: number | null; currencies?: Array<{ currency?: string; minAmount?: number; maxAmount?: number }> };
let cached: { key: string; expiresAt: number; gateway: Gateway } | null = null;
let loading: { key: string; promise: Promise<Gateway> } | null = null;

// Public merchant channel configuration only; never cache payment status here.
export async function requireAutopayAuctionGateway(amount: number, deadline: number) {
  const config = autopayConfiguration();
  const key = `${config.host}:${config.serviceId}:${config.gatewayId}`;
  const load = async () => {
    const fields = { ServiceID: Number(config.serviceId), MessageID: randomUUID().replaceAll("-", ""), Currencies: "PLN", Language: "PL" };
    const response = await fetch(`${config.host}/gatewayList/v3`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...fields, Hash: autopayHash(Object.values(fields)) }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Error("Unable to verify Autopay channel.");
    const data = await response.json() as { result?: string; serviceID?: string | number; messageID?: string; gatewayList?: Gateway[] };
    if (data.result !== "OK" || String(data.serviceID) !== config.serviceId || data.messageID !== fields.MessageID || !Array.isArray(data.gatewayList)) throw Error("Invalid Autopay channel response.");
    const gateway = data.gatewayList.find(item => String(item.gatewayID) === config.gatewayId);
    if (!gateway) throw Error("Configured Autopay channel is unavailable.");
    cached = { key, expiresAt: Date.now() + 60000, gateway };
    return gateway;
  };
  let gateway: Gateway;
  if (cached?.key === key && cached.expiresAt > Date.now()) gateway = cached.gateway;
  else {
    if (!loading || loading.key !== key) loading = { key, promise: load() };
    const current = loading;
    try { gateway = await current.promise; } finally { if (loading === current) loading = null; }
  }
  const currency = gateway.currencies?.find(item => item.currency === "PLN");
  const min = gateway.minValidityTime;
  if (gateway.groupType !== "BLIK" || gateway.state !== "OK" || !currency ||
      (currency.minAmount != null && amount / 100 < currency.minAmount) ||
      (currency.maxAmount != null && amount / 100 > currency.maxAmount) ||
      (min != null && (!Number.isFinite(min) || min < 0 || min * 60000 > deadline - Date.now())) || deadline <= Date.now()) {
    throw Error("Autopay channel cannot support this auction's remaining payment window.");
  }
}
