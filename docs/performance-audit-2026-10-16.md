# Fiszy: audit for 150 concurrent visitors

Scope: published auction display, buyer queue, checkout redirect, account page,
removed notification features, and repository branches. No live payments or
customer records were created or removed during testing.

## Changes

| Area | Before | After |
| --- | --- | --- |
| Public detail polling | Every second | Every 2 seconds live, 10 seconds before the last 30 seconds to start, 15 seconds after closing |
| Queue polling before clicking | Every 1.5 seconds | Every 10 seconds; immediate read on joining and every 1.5 seconds while queued/paying |
| Regular queued-status read | 7 Redis HTTP requests: profile, block policy, record, config, entry, head, snapshot | 2 Redis HTTP requests: fresh block policy and atomic eligibility + queue snapshot |
| Same public auction read by many visitors | Separate database reads for every request | Concurrent readers share a bounded per-worker snapshot, held for 500 ms after loading |
| Public time and price | Computed on server | Still computed at request time; only underlying public snapshot is shared |
| Catalog response | Every reader invokes origin | Two-second Vercel CDN cache; browsers still do not retain it |
| Concurrent payment expiry | Many requests can call provider together | One expiring distributed lease, exact-claim recheck, provider confirmation before promotion |
| Checkout email delivery | Blocks response and redirect | Runs through Next.js `after()` after response |
| Removed reminders | UI removed, background polling still installed | Deleted reminder component, settings module, background watchlist polling, unused events and CSS |
| Device history | Written on every poll | Written only if relevant auction fields change |
| Upstream stalls | Unbounded fetch wait | Eight-second Redis and payment read/expiry timeouts; ambiguous writes are not blindly retried |

No private queue, account policy, entry or purchase decision is cached.
The public cache is per worker, not a shared global capacity guarantee.
The catalog may lag by two seconds; public detail runtime may lag by 500 ms
plus its polling interval. The server still validates every purchase directly.

## Tests

- Public production API before changes: 150 simultaneous GETs, 150 successful,
  zero errors. Client p95 13,338.5 ms. The execution environment uses an egress
  proxy, so this is not a measurement of browser or origin latency.
- Isolated Redis integration test executes actual production Lua: 150 concurrent
  purchase attempts, exactly one payment head and 149 unique queued positions.
- Same fixture: 6,000 authorized queue snapshots in 40 bursts of 150. Sample run
  duration 777 ms, p95 20.13 ms; click burst p95 65.81 ms. These local numbers
  exclude real authentication, network and payment-provider latency.
- 150 concurrent attempts to expire one payment cause exactly one provider
  expiry call. The provider response is simulated; Redis locking is real.
- Eligibility checks reject unpaid participants and old runs. Tests preserve
  fixed prices, rank after refresh, two/four-minute estimates, late-payment
  refund, payment-vs-expiry race and stale cancellation protections.
- Public-read tests: 150 readers share two Redis HTTP calls total (one bases
  MGET and one runtime MGET); server time remains fresh, private checkout data
  never appears in the public response, failed loads are retried.
- TypeScript and portal, history, operations, payment-fault and cache tests pass.

Reproduce with `npm run test:performance:unit`, `npm run test:queue` against an
isolated local Redis (`QUEUE_TEST_REDIS_PORT`), and
`python scripts/public-load-test.py --url https://fiszy.pl/api/auctions/airpods-pro-3`.

## Branch inventory

Eighteen non-main branches are ancestors of main and are candidates for deletion:
`codex/check-repository-status-and-finish-publish`, `codex/traffic-observability`,
`feat/admin-auction-launcher`, `feat/auction-screen`, `feat/falling-price-demo`,
`feat/first-click-wins`, `feat/order-history`, `feat/order-records`,
`feat/paid-entry-access`, `feat/server-price-demo`, `feat/single-auction-session`,
`feat/stripe-entry-checkout`, `feat/winner-stripe-payment`,
`fix/admin-env-diagnostics`, `fix/admin-secret-name`, `test/pr-workflow`,
`test/restart-auction-1010`, `vercel/react-server-components-cve-vu-k9sfh0`.

Six branches have commits not reachable from main and were preserved:
`chore/local-env-setup`, `codex/growth-engine`, `codex/landing-traffic`,
`codex/marketing-agents`, `revert-6-vercel/react-server-components-cve-vu-k9sfh0`,
`seo/llm-discovery`.

Remote branches were not deleted: the connected GitHub interface exposes no
branch deletion operation and terminal Git has no write credential. Branch
cleanup affects repository maintenance, not production execution speed.

## Remaining verification before launch

These results do not certify 150 signed-in real browsers completing real
checkouts. Run a coordinated staging rehearsal with Clerk sessions and the final
payment provider, including provider throttling, delayed webhooks, expiry and
refunds. Check the actual Vercel/Redis plan quotas, deployment-region latency,
and sustained traffic at the full entry + analytics rate. No hosting plan or
provider was changed as part of this audit.
