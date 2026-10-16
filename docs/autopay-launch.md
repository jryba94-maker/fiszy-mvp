# Autopay integration and launch conditions

Implementation date: 2026-10-16. This is an implementation/rehearsal record,
not payment-provider acceptance or a legal compliance certificate.

## What changes now

- Provider dispatch preserves existing Stripe references after migration.
- Autopay persists an intent and binds the exact buyer claim before outbound
  creation. Ambiguous timeouts hold the claim; retries reuse its OrderID.
- A two-minute hosted link limits initiation. An accepted PENDING transaction
  holds the product until a final signed notification. Its transaction validity
  is at least 15 minutes, distinct from link validity. Abandonment after provider
  acceptance can therefore block a turn for longer than two minutes.
- ITN is the binding settlement event; neither return URLs, prerequest responses
  nor status queries grant entry or create paid orders. Pending payments cannot
  be released by local timeouts, unknown status, partial cancellation or a
  failed HTTP request. A failed attempt cannot override another pending/successful
  RemoteID for the same OrderID.
- Advancing on FAILURE additionally requires confirmed order-wide cancellation
  or merchant-enforced OrderID reuse blocking. Do not enable this assumption
  without Autopay confirmation and a real test.
- Refunds have stable idempotency IDs and a durable ledger. HTTP acceptance is
  only submitted; signed ISTN SUCCESS/CONFIRMED marks completion. Failures and
  stale items are visible through the authenticated audit endpoint
  `/api/admin/payments/autopay` and the existing operations alert flow.
  This endpoint inspects the latest 100 intents and refunds; it is not a
  substitute for full merchant settlement reports at higher volume.
- An unchecked separate entry-service declaration records an immutable statement,
  accepted timestamp, version and service contract. Paid confirmation stores this
  content in the retryable email outbox; sending respects transactional-email
  configuration. Check actual inbox delivery before taking fees.
- Terms, auction rules, privacy, complaints, FAQ and how-to now explain the queue
  and separate entry service from product purchase. Delivery: dispatch <=3 business
  days; estimated InPost transit another 1–2 business days.
- `lowestPrice30DaysBeforeAuction` is validated and frozen into new run configs;
  publication requires a documented value. Legacy runs remain readable without
  inventing history or rewriting their immutable rules. The product detail shows
  this reference when supplied. Animated strike-through regular pricing was
  removed from that detail view. This field alone does not prove every price
  claim elsewhere is compliant; verify promotions against actual price history.

## Required merchant configuration (not completed by this change)

1. Provide actual seller postal address, contact phone, return address if different,
   contact email and NIP only if actually assigned. These must match onboarding.
   Existing verified contact `rodo@fiszy.pl` is retained until replaced.
2. Complete Autopay acceptance of the paid-access auction business model.
3. Configure environment-scoped ServiceID, shared key, exact assigned start URL,
   agreed SHA256/SHA512, hosted BLIK gateway and order-reuse protection. No BNPL,
   deferred payment or ordinary bank-transfer channel is implemented for this
   auction purchase. Confirm the selected hosted flow displays all operator terms;
   this adapter does not claim customer acceptance of undisplayed Autopay terms.
4. Merchant panel URLs: ITN `/api/payments/autopay/itn`, ISTN
   `/api/payments/autopay/istn`, browser return `/api/payments/autopay/return`.
   All must use the exact canonical HTTPS domain. Return navigation uses OrderID
   and authenticated ownership; a return never changes payment status.
5. Run actual BLIK success, refusal, abandonment, delayed ITN, repeated ITN,
   cancellation race, full refund, insufficient-refund-balance and inbox receipt
   tests in sandbox. Rehearse live minimum-value payment and refund after approval.
6. Obtain a transaction-start throughput allowance compatible with 150 users;
   the documented default 100 starts/minute can throttle mass entry checkout.
7. Set `AUTOPAY_INTEGRATION_VERIFIED=true` only after these acceptance checks.
   Set `FISZY_PAYMENT_PROVIDER=autopay` only for the prepared environment, then
   deploy and verify live health. Missing configuration fails closed.
   Keep Stripe secrets/webhook while old sessions may still settle/refund.
8. Verify business registration and tax status before increasing auction volume.
   This change does not register a business or monitor statutory revenue due;
   paid-event analytics are not an accounting ledger for DN thresholds.

No merchant secrets, live gateway IDs or genuine seller address were supplied
in this task. Autopay therefore remains inactive unless separately configured.
Documents identify the selected operator rather than falsely claiming activation.
The current Stripe adapter retains its legacy two-minute completion/refund rule,
which its operator paragraph explicitly describes until migration.

## Verification

- `npm run test:autopay:unit`: canonical signatures, malformed/tampered/foreign
  XML, duplicate fields, unsafe entities, SHA256/SHA512, ISTN versus ITN,
  acknowledgement signatures, activation gates, Warsaw dates and price history.
- `QUEUE_TEST_REDIS_PORT=<isolated-port> npm run test:autopay:integration`:
  real Redis and production Lua, mocked provider HTTP. Covers 150 concurrent
  queue-advance requests, 150 consent retries, late SUCCESS, duplicate SUCCESS,
  second RemoteID refund, AUTHORIZED versus CONFIRMED refund, FAILURE promotion,
  ambiguous creation and entry granted only after ITN with a persisted receipt.
  Uses its own random Redis namespace; no production data or payment is touched.
- Existing queue integration, payment faults, portal, history, fulfillment,
  operations, cache tests, TypeScript, security audit and production build run
  before release. Test results and final release SHA belong in the change record.

Primary protocol reference: https://developers.autopay.pl/online/dokumentacja
Consumer-service reference:
https://prawakonsumenta.uokik.gov.pl/prawo-odstapienia-od-umowy/wylaczenia-prawa-do-odstapienia/

### Local release checks completed

- 63 deterministic tests passed (54 application/protocol + 9 payment/security).
- Real Redis queue rehearsal: 150 unique buyers, 6,000 snapshots, 150 concurrent
  expiry requests resulting in one provider expiry call; all assertions passed.
- Autopay Redis/HTTP-simulation rehearsal passed, including the cases above.
- TypeScript, optimized Next.js 15.5.28 build and production dependency audit
  passed; audit reported zero vulnerabilities. Sharp override is 0.35.5.
- Real Autopay sandbox/live transactions and merchant approval remain outstanding.
