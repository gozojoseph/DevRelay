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
   (`readConfig` guard).
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
