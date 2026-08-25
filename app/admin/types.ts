export type AuctionRecordState = "draft" | "published" | "archived";
export type AuctionCategory = "electronics" | "home" | "sport" | "beauty" | "gaming" | "other";
export type PostAuctionOfferInput = {
  enabled: boolean;
  validityDays: number;
  inventory: number | null;
};

export type AuctionRunStatus =
  | "waiting"
  | "live"
  | "payment_pending"
  | "sold"
  | "ended";

export type AuctionDisplayStatus =
  | AuctionRecordState
  | AuctionRunStatus;

export type AdminAuction = {
  auctionId: string;
  slug: string;
  revision: number | null;
  recordState: AuctionRecordState;
  productName: string;
  productImageUrl: string | null;
  category: AuctionCategory;
  postAuctionOffer: PostAuctionOfferInput;
  entryFee: number;
  regularPrice: number;
  startPrice: number;
  floorPrice: number;
  durationMinutes: number;
  status: AuctionRunStatus | null;
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
  category: AuctionCategory;
  postAuctionOffer: PostAuctionOfferInput;
  entryFee: number;
  regularPrice: number;
  startPrice: number;
  floorPrice: number;
  durationMinutes: number;
  startsAt?: string;
};

export type FulfillmentStatus =
  | "new"
  | "preparing"
  | "shipped"
  | "delivered";

export type OrderFulfillment = {
  status: FulfillmentStatus;
  revision: number;
  carrier: string | null;
  trackingNumber: string | null;
  note: string | null;
  updatedAt: string;
};

export type FulfillmentUpdateInput = {
  expectedRevision: number;
  status: FulfillmentStatus;
  carrier: string | null;
  trackingNumber: string | null;
  note: string | null;
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
  orderKind: "auction_win" | "post_auction_discount";
  sourceRunId: string | null;
  discountId: string | null;
  regularPrice: number | null;
  discountAmount: number | null;
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
  fulfillment: OrderFulfillment;
};

export type AdminAuctionRun = {
  auctionId: string;
  runId: string;
  status: AuctionRunStatus | null;
  startsAt: string | null;
  endsAt: string | null;
  startPrice: number | null;
  floorPrice: number | null;
  soldPrice: number | null;
  participantCount: number | null;
  winnerParticipantId: string | null;
  winnerClaimedAt: string | null;
  paidAt: string | null;
};

export type AdminParticipant = {
  participantId: string;
  auctionId: string | null;
  runId: string | null;
  entryStatus: "granted" | "refunded" | "unknown";
  entryFee: number | null;
  grantedAt: string | null;
  refundedAt: string | null;
  isWinner: boolean;
  winnerPrice: number | null;
};

export type AuditDetail = string | number | boolean | null;

export type AdminAuditEvent = {
  eventId: string;
  event: string;
  timestamp: string;
  actor: string | null;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, AuditDetail>;
};

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};

export type AdminHealth = {
  environment: string;
  adminConfigured: boolean;
  adminSecretStrong: boolean;
  individualAdminAccountsConfigured: boolean;
  redisConfigured: boolean;
  redisReachable: boolean;
  redisLatencyMs: number | null;
  paymentProvider: string;
  paymentConfigured: boolean;
  paymentTestMode: boolean;
  paymentWebhookConfigured: boolean;
  authenticationConfigured: boolean;
  emailDeliveryConfigured: boolean;
  emailWebhookConfigured: boolean;
  inAppNotificationsConfigured: boolean;
  externalErrorAlertsConfigured: boolean;
  canonicalSiteUrl: string | null;
  canonicalSiteUrlExplicit: boolean;
  degraded: boolean;
};

export type AdminSession = {
  configured: boolean;
  authenticated: boolean;
  role: "owner" | "operator" | "support" | "viewer";
  permissions: string[];
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
  | "draft"
  | "archived";
