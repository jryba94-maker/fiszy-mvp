export type LaunchReadinessStatus = "ready" | "warning" | "blocked";

export type LaunchReadinessCheck = {
  id: string;
  label: string;
  detail: string;
  status: LaunchReadinessStatus;
};

export type LaunchReadinessAuction = {
  auctionId: string;
  productName: string;
  productImageUrl: string | null;
  recordState: "draft" | "published" | "archived";
  status: "waiting" | "live" | "payment_pending" | "sold" | "ended" | null;
  startsAt: string | null;
  entryFee: number;
  regularPrice: number;
  startPrice: number;
  floorPrice: number;
  durationMinutes: number;
  postAuctionOffer: { enabled: boolean; validityDays: number };
};

export type LaunchReadinessHealth = {
  redisConfigured: boolean;
  redisReachable: boolean;
  paymentConfigured: boolean;
  paymentWebhookConfigured: boolean;
  paymentTestMode: boolean;
  authenticationConfigured: boolean;
  emailDeliveryConfigured: boolean;
  emailWebhookConfigured?: boolean;
  canonicalSiteUrlExplicit: boolean;
  externalErrorAlertsConfigured: boolean;
};

function validDate(value: string | null) {
  return value !== null && Number.isFinite(new Date(value).getTime());
}

function selectedAuction(auctions: LaunchReadinessAuction[], now: number) {
  const candidates = auctions.filter(
    (auction) =>
      auction.recordState === "published" &&
      auction.status !== "sold" &&
      auction.status !== "ended",
  );
  return candidates.sort((left, right) => {
    const leftTime = validDate(left.startsAt) ? new Date(left.startsAt!).getTime() : Number.MAX_SAFE_INTEGER;
    const rightTime = validDate(right.startsAt) ? new Date(right.startsAt!).getTime() : Number.MAX_SAFE_INTEGER;
    const leftActive = left.status === "live" || left.status === "payment_pending";
    const rightActive = right.status === "live" || right.status === "payment_pending";
    if (leftActive !== rightActive) return leftActive ? -1 : 1;
    const leftFuture = leftTime >= now;
    const rightFuture = rightTime >= now;
    if (leftFuture !== rightFuture) return leftFuture ? -1 : 1;
    return leftTime - rightTime;
  })[0] ?? null;
}

export function evaluateLaunchReadiness(
  health: LaunchReadinessHealth,
  auctions: LaunchReadinessAuction[],
  now = Date.now(),
) {
  const auction = selectedAuction(auctions, now);
  const checks: LaunchReadinessCheck[] = [
    {
      id: "storage",
      label: "Magazyn danych",
      detail: health.redisConfigured && health.redisReachable ? "Redis odpowiada" : "Redis nie jest gotowy",
      status: health.redisConfigured && health.redisReachable ? "ready" : "blocked",
    },
    {
      id: "payment",
      label: "Płatności i potwierdzenia",
      detail:
        health.paymentConfigured && health.paymentWebhookConfigured
          ? health.paymentTestMode
            ? "Operator działa w piaskownicy"
            : "Operator i webhook są gotowe"
          : "Brakuje operatora lub webhooka",
      status:
        health.paymentConfigured && health.paymentWebhookConfigured
          ? health.paymentTestMode
            ? "warning"
            : "ready"
          : "blocked",
    },
    {
      id: "accounts",
      label: "Konta użytkowników",
      detail: health.authenticationConfigured ? "Logowanie jest skonfigurowane" : "Logowanie nie jest gotowe",
      status: health.authenticationConfigured ? "ready" : "blocked",
    },
    {
      id: "email",
      label: "Komunikacja e-mail",
      detail: health.emailDeliveryConfigured && health.emailWebhookConfigured ? "Wysyłka i potwierdzenia dostarczenia są skonfigurowane" : "Brakuje wysyłki lub potwierdzeń dostarczenia",
      status: health.emailDeliveryConfigured && health.emailWebhookConfigured ? "ready" : "blocked",
    },
    {
      id: "domain",
      label: "Domena kanoniczna",
      detail: health.canonicalSiteUrlExplicit ? "Własna domena jest ustawiona" : "Brakuje jawnej domeny serwisu",
      status: health.canonicalSiteUrlExplicit ? "ready" : "blocked",
    },
    {
      id: "alerts",
      label: "Alerty operacyjne",
      detail: health.externalErrorAlertsConfigured ? "Monitoring może wysłać alert" : "Brak zewnętrznego alertu awarii",
      status: health.externalErrorAlertsConfigured ? "ready" : "warning",
    },
  ];

  if (!auction) {
    checks.push({
      id: "auction",
      label: "Aukcja startowa",
      detail: auctions.some((item) => item.recordState === "draft")
        ? "Jest szkic, ale żadna aukcja nie została opublikowana"
        : "Brakuje opublikowanej aukcji",
      status: "blocked",
    });
  } else {
    const scheduled = validDate(auction.startsAt);
    const definitionValid =
      auction.productName.trim().length >= 2 &&
      Boolean(auction.productImageUrl) &&
      auction.entryFee > 0 &&
      auction.regularPrice === auction.startPrice &&
      auction.floorPrice === 1 &&
      auction.durationMinutes >= 1 &&
      auction.postAuctionOffer.enabled &&
      auction.postAuctionOffer.validityDays >= 1;
    checks.push(
      {
        id: "auction",
        label: `Aukcja: ${auction.productName}`,
        detail: scheduled
          ? `Start ${new Date(auction.startsAt!).toLocaleString("pl-PL")}`
          : "Nie ma prawidłowego terminu startu",
        status: scheduled ? "ready" : "blocked",
      },
      {
        id: "auction-definition",
        label: "Parametry aukcji",
        detail: definitionValid
          ? `Wpisowe ${auction.entryFee} zł · cena ${auction.regularPrice}→1 zł · ${auction.durationMinutes} min`
          : "Uzupełnij zdjęcie i wymagane parametry aukcji",
        status: definitionValid ? "ready" : "blocked",
      },
    );
  }

  const blockers = checks.filter((check) => check.status === "blocked").length;
  const warnings = checks.filter((check) => check.status === "warning").length;
  return {
    auctionId: auction?.auctionId ?? null,
    checks,
    blockers,
    warnings,
    status: blockers > 0 ? "blocked" as const : warnings > 0 ? "warning" as const : "ready" as const,
  };
}
