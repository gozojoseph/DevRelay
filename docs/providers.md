# Provider setup

DevRelay is honest-only: every integration is gated by configuration. Missing
credentials *disables* the corresponding feature with a clear 503 code rather
than faking success. This document lists each provider, the environment
variables, and what must be configured in the provider dashboard.

## Environment summary

See `.env.example` for the full list. The important gates (from
`server/config.ts` → `availability()`):

| Capability        | Required env values                                                                      |
|-------------------|------------------------------------------------------------------------------------------|
| Paystack funding  | `PAYSTACK_SECRET_KEY` (webhook secret optional legacy + `PAYSTACK_WEBHOOK_SECRETS`)        |
| SMS sending       | `AT_USERNAME`, `AT_API_KEY`, `AT_CALLBACK_TOKEN`; `AT_MODE=sandbox\|live`                  |
| SMS (alternative) | `SMS_PROVIDER=aigh` + `AIGH_API_KEY` (optional `AIGH_BASE_URL`, defaults to the vendor's)  |
| SMS (SIM gateway) | `SMS_PROVIDER=sim-gateway` + `GATEWAY_URL` (+ app Basic creds; `GATEWAY_WEBHOOK_SECRET` enables callbacks) |
| SMS (Arkesel)     | `SMS_PROVIDER=arkesel` + `ARKESEL_API_KEY` (optional `ARKESEL_BASE_URL`, defaults to the vendor's)       |
| WhatsApp (test)   | `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID`, `META_VERIFY_TOKEN`                    |
| WhatsApp (live)   | All of the above **plus** `META_PRODUCTION_APPROVED=true` **and** `NODE_ENV=production`     |
| Session/cookies   | `SESSION_SECRET` (≥32 chars), `ENCRYPTION_KEY` (64 hex chars = AES-256 key)                 |

## Paystack (wallet funding)

1. Create the integration on [paystack.com](https://paystack.com) and enable
   **Mobile Money** plus **Card** channels for Ghana.
2. Set `PAYSTACK_SECRET_KEY` from the *Settings → API Keys & Webhooks* page.
   Use `sk_test_…` for staging. The app refuses sandbox credentials when
   `NODE_ENV=production` (zod config check).
3. Register the webhook URL `https://<your-api-host>/api/webhooks/paystack`:
   - DevRelay verifies Paystack's `x-paystack-signature` (HMAC-SHA512 of the raw
     body with `PAYSTACK_WEBHOOK_SECRET`/`PAYSTACK_WEBHOOK_SECRETS`, plus the
     newer timestamped `Paystack-Signature` header format).
   - Only JSON bodies up to 512 KiB are accepted; events are stored with a
     content-hash fingerprint so replays are ignored.
4. Verify a transfer manually the first time: use the dashboard
   *Wallet → Payments* list and the `POST /api/app/wallet/payments/:reference/verify`
   endpoint. Credits are applied exactly once (unique `paymentEvents.eventHash`).

## Africa's Talking (SMS)

1. Create an Africa's Talking application for **Ghana**; choose **Sandbox**
   first (`AT_MODE=sandbox`), then request live access.
2. Live mode requires the Africa's Talking reseller/partner terms for Ghana and
   one **approved sender ID** per business (requested by end developers through
   the dashboard → Admin approval flow → provider).
3. Set `AT_USERNAME`, `AT_API_KEY`, and `AT_CALLBACK_TOKEN` (a long random
   value). AT callbacks are unsigned, so DevRelay authenticates them by
   requiring the secret callback path
   `POST /api/webhooks/africastalking/:token` where `:token` equals
   `AT_CALLBACK_TOKEN`.
4. Behavior baked into the code: live mode posts to
   `/version1/messaging/bulk`, sandbox posts to `/version1/messaging`.
   A sandbox account cannot send from a production deployment
   (`readConfig` guard). The sandbox cannot use custom sender IDs (approval
   is live-only), so sandbox sends omit `from` and arrive from the sandbox
   default sender; a 201 answer naming an error (for example
   `InvalidSenderId`) with no recipients is treated as a definite rejection
   whose reserved credits are released via admin reconciliation.
5. Sender IDs are managed in `senderRequests` (status `approved` before any
   send). Admin approves them in the admin console.

## AIGH (alternative SMS provider)

Optional second SMS rail, implemented from the vendor overview
(aigh.dev, Nov 2026): base `https://aigh.dev/api/v1`, `Authorization: Bearer`
keys (`smp_` prefix for SMS, `wap_` for WhatsApp), a uniform
`{ success, message, data }` envelope, `GET /sms/balance`, and an SMS family
covering bulk send, delivery tracking and sender-ID management.

1. Select it with `SMS_PROVIDER=aigh` and set `AIGH_API_KEY` (`AIGH_BASE_URL`
   defaults to the documented base URL). SMS availability then requires only
   the key — the AT sandbox production gate does not apply because AIGH
   documents no sandbox key format.
2. Honest contract, baked into `server/providers/aigh.ts`:
   - Sends POST `{ to, from, message }` to `/sms/send` — **provisional**: the
     overview names no send path or field names. A mismatch fails as
     `SMS_PROVIDER_REJECTED` / `SMS_RESPONSE_UNCERTAIN`, never a simulated
     send.
   - Success requires the documented `{ success: true, data }` envelope with
     an extractable provider message id; otherwise the message lands in
     `pending_reconciliation`. Customer billing always uses DevRelay's own
     quote — the provider response never defines customer cost.
   - HTTP mapping mirrors the AT adapter: 429 → retryable, 5xx/timeout →
     ambiguous, other non-OK or `success: false` → rejected.
3. Blocked until AIGH publishes its full reference:
   - **Delivery callbacks** — no webhook payload or signature scheme is
     documented, so AIGH messages stop at `sent` (provider-accepted) with no
     delivered/failed terminal events.
   - **Supplier cost** — no cost fields are documented, so `supplierCostMinor`
     stays unset for AIGH sends.
   - **Sender IDs** — DevRelay's approve-first `senderRequests` gate applies
     regardless of what the provider allows.

## SIM gateway (spare Android phone)

Third SMS rail: an Android phone running the open-source
[SMS Gateway for Android](https://github.com/capcom6/android-sms-gateway)
(docs.sms-gate.app). `server/providers/sim-gateway.ts` speaks its documented
Local Server API. A dev rail first — see the verdict below for production use.

1. Select it with `SMS_PROVIDER=sim-gateway` and set `GATEWAY_URL` to the
   app's Local Server URL (app Settings → Local Server, e.g.
   `http://192.168.1.20:8080`), plus the app's Basic credentials
   (`GATEWAY_USER`/`GATEWAY_PASSWORD`; both optional if the app runs without
   auth). SMS availability then requires only `GATEWAY_URL`.
   Optional `GATEWAY_SIM_NUMBER` pins the SIM slot on dual-SIM phones.
2. Contract, baked into `server/providers/sim-gateway.ts`:
   - Sends POST `{ textMessage: { text }, phoneNumbers, withDeliveryReport:
     true }` to `{GATEWAY_URL}/message` with HTTP Basic auth.
   - **No sender ID is ever sent** — the device's SIM number is the sender;
     alphanumeric sender IDs are a live-aggregator feature a phone cannot
     honor.
   - Acceptance requires an id (`id` or `messageId`) in the response; a 2xx
     without one is `SMS_RESPONSE_UNCERTAIN` (`pending_reconciliation`), never
     a simulated success. 429 → retryable, 5xx/timeout → ambiguous, other
     non-OK → rejected. Customer billing always uses DevRelay's own quote.
3. Delivery callbacks: in the app's Settings → Webhooks set a signing key, put
   the same key in `GATEWAY_WEBHOOK_SECRET`, and register
   `https://<public-host>/api/webhooks/sms-gateway` in the app. DevRelay
   verifies `X-Signature` (HMAC-SHA256 of rawBody + `X-Timestamp`, ±5 min
   window) and maps `sms:sent/delivered/failed/cancelled` onto the delivery
   pipeline; inbound `sms:received` is deliberately ignored (receiving is out
   of scope). Without a public URL, sends still work — statuses honestly rest
   at `accepted`.
4. Verdict: fine as a **development rail or micro-volume niche** (real network,
   real callbacks, near-zero cost), **not recommended as the primary
   production SaaS rail** — the sender shows as a personal number, throughput
   is ~6–10 msgs/min with carrier spam-block risk, and availability is a phone
   on a desk, not an SLA.

## Arkesel (Ghana SMS)

Fourth SMS rail and the current cost leader for Ghana routes — verified vendor
pricing (Nov 2026): ~GHS 0.022–0.031 per SMS depending on the prepaid bundle
(vs DevRelay's 5p customer price), expiry in 3 months on the cheap tiers or
no-expiry at slightly higher per-unit. A live account from day one — no
sandbox-mode gate applies.

1. Sign up at account.arkesel.com, create an API key (dashboard → API keys),
   then set `SMS_PROVIDER=arkesel` + `ARKESEL_API_KEY` (`ARKESEL_BASE_URL`
   defaults to the documented `https://sms.arkesel.com/api/v2`). Availability
   requires only the key. Fund credits before real sends (free test credits
   are included at signup).
2. Contract, baked into `server/providers/arkesel.ts`:
   - Sends POST `{ sender, message, recipients: [<one>] }` to
     `{ARKESEL_BASE_URL}/sms/send` with the vendor's `api-key` header. The
     approved sender ID is honored (unlike the SIM rail).
   - **Live-verified (2026-11-10):** the real API answers 200 with
     `{ status: 'success', data: [{ id, recipient }], main_balance, sms_balance }`
     — an *array* of per-recipient results, unlike the object shown in the
     vendor's samples; the adapter accepts both shapes and matches the echoed
     recipient (digits only). Success requires `status: 'success'` **and** an
     extractable id; a named failure envelope or non-OK status is a definite
     rejection (`SMS_PROVIDER_REJECTED`), a success without an id is honestly
     ambiguous (`SMS_RESPONSE_UNCERTAIN`), 429 → retryable, 5xx/timeout →
     ambiguous. Balances are never converted to ledger money.
3. Sender IDs: register the approved sender (e.g. "Affordable") in the Arkesel
   dashboard and wait for approval — Ghana's sender-ID regulation applies to
   every aggregator.
4. Delivery webhooks: advertised by the vendor, but the payload/signature spec
   is not machine-readable yet (developers.arkesel.com is a JS portal). Sends
   honestly rest at `accepted` until that contract is wired.

## Meta WhatsApp Cloud API

1. Create a Meta **Business** app; add the *WhatsApp* product. Choose the Tech
   Provider flow if you onboard other businesses' numbers (Embedded Signup).
2. Enable the test number to start: set `META_APP_ID`, `META_APP_SECRET`,
   `META_CONFIG_ID` (Embedded Signup config id, v4 API), `META_VERIFY_TOKEN`
   (webhook verification value). That unlocks `whatsappTest` mode.
3. Point Meta to:
   - Webhook URL: `https://<your-api-host>/api/webhooks/meta`
   - Verify token: same value as `META_VERIFY_TOKEN` (GET handshake).
   Meta webhook payloads require a valid `X-Hub-Signature-256`
   (HMAC-SHA256 of the raw body with `META_APP_SECRET`).
4. For production traffic with other businesses' numbers:
   - Complete **Tech Provider verification** + **Meta app review**, grant the
     `WhatsApp Business Management` and `whatsapp_business_messaging`
     permissions.
   - Document per-message pricing: Meta moved to per-message pricing; sending
     uses categories (`marketing`, `service`, free entry points).
   - Set `META_PRODUCTION_APPROVED=true`; the flag exists so production
     deployments cannot go live before review is complete without an explicit
     operator decision.
5. End users connect numbers through the dashboard *Embedded Signup* flow; a
   connection needs admin activation with billing confirmation before the
   number can be used as a sender.

## Pricing

Pricing rows live in `pricing_versions` (channel, country, route, category,
`customerUnitMinor`, effectiveFrom/To). Admins create them in the admin
console. Sends fail with `PRICE_UNAVAILABLE` (503) when no effective row
exists — the platform never invents a price.

## Secrets

- `ENCRYPTION_KEY`: 64 hex chars, used for AES-256-GCM (message bodies, WhatsApp
  tokens, webhook endpoint secrets, MFA secrets). Rotate only with
  corresponding database re-encryption; treat it as RPO-critical.
- `SESSION_SECRET`: ≥32 chars random; rotating it invalidates all sessions and
  CSRF tokens.
- Never commit real keys. `.env` files are git-ignored.
