export type AuctionStatus =
  | "draft"
  | "waiting"
  | "live"
  | "payment_pending"
  | "sold"
  | "ended";

export type AdminAuction = {
  auctionId: string;
  slug: string;
  revision: number | null;
  productName: string;
  productImageUrl: string | null;
  regularPrice: number;
  startPrice: number;
  floorPrice: number;
  durationMinutes: number;
  status: AuctionStatus;
  currentPrice: number | null;
  runId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  soldAt: string | null;
};

export type AuctionDefinitionInput = {
  auctionId: string;
  slug: string;
  productName: string;
  productImageUrl: string | null;
  regularPrice: number;
  startPrice: number;
  floorPrice: number;
  durationMinutes: number;
  startsAt?: string;
};

export type AdminOrder = {
  orderId: string;
  auctionId: string | null;
  runId: string;
  bidderId: string | null;
  product: string;
  amount: number;
  currency: string;
  paymentSessionId: string | null;
  paidAt: string;
  customer: {
    name: string | null;
    email: string | null;
    phone: string | null;
  };
  shippingAddress: {
    city: string | null;
    country: string | null;
    line1: string | null;
    line2: string | null;
    postalCode: string | null;
    state: string | null;
  } | null;
};

export type AdminHealth = {
  environment: string;
  adminConfigured: boolean;
  adminSecretStrong: boolean;
  redisConfigured: boolean;
  redisReachable: boolean;
  redisLatencyMs: number | null;
  stripeConfigured: boolean;
  stripeTestMode: boolean;
  webhookConfigured: boolean;
  degraded: boolean;
};

export type AdminSession = {
  configured: boolean;
  authenticated: boolean;
};

export type MutationResult = {
  legacy: boolean;
  message?: string;
};

export type AuctionFilter =
  | "all"
  | "live"
  | "waiting"
  | "finished"
  | "draft";
