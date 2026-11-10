# DevRelay API — v1 reference

One base URL, one auth scheme, one response envelope. Prepaid GHS credits:
every send is quoted in pesewas, consent-gated, and honestly reported —
`202` means *queued*, never delivered, and an uncertain provider answer is
stored as `pending_reconciliation` instead of a guessed status.

**Base URL:** `<PUBLIC_API_URL>/api/v1` — for the deployed service:
`https://devrelay-0edn.onrender.com/api/v1`

## Authentication

```
Authorization: Bearer dr_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- Project API keys are created, rotated and revoked in the dashboard's
  project area. Only a SHA-256 hash is stored server-side.
- The prefix encodes the environment: `dr_live_…` or `dr_test_…`. Test keys
  are refused in production (`401 INVALID_API_KEY`).
- Keys carry scopes: `messaging:send` and/or `messaging:read`. A request
  without the required scope → `403 SCOPE_REQUIRED`.
- The owning account must be active (verified email + admin approval), else
  `403 ACCOUNT_NOT_ACTIVE`.

## Response envelope

Success (2xx):

```json
{ "data": { ... }, "requestId": "8f14e45f-…" }
```

Error (4xx/5xx):

```json
{ "error": { "code": "MACHINE_READABLE_CODE", "message": "Human-readable." }, "requestId": "8f14e45f-…" }
```

Every response also carries an `X-Request-Id` header. Quote the `requestId`
when contacting support.

## Rate limits

Per API key, fixed one-minute windows: **20 writes/min**, **120 reads/min**.
Responses carry `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`
(plus legacy `X-RateLimit-*`). Exceeding the limit → `429 RATE_LIMITED`.

## Idempotency

`POST /messages/sms` and `POST /messages/whatsapp` require an
`Idempotency-Key` header (8–128 chars from `A-Za-z0-9._:-`).

- Replaying the same key **with the same body** returns the original response
  instead of sending twice; the response echoes the `Idempotency-Key` header.
- Same key with a **different body** → `409 IDEMPOTENCY_CONFLICT`.

## Endpoints

### POST /messages/sms — scope `messaging:send`

```json
{ "to": "+233201234567", "senderId": "DEVRELAY", "body": "Hello from DevRelay" }
```

| Field | Rules |
|---|---|
| `to` | 8–24 chars, normalized to E.164; Ghana numbers only (`400 UNSUPPORTED_DESTINATION`) |
| `senderId` | 3–11 chars; must be an admin-approved sender ID (`403 SENDER_NOT_APPROVED`) |
| `body` | 1–1600 chars; max 12 billable segments (`400 MESSAGE_TOO_LONG`) |

`202 Accepted`:

```json
{ "data": { "id": "…", "status": "queued", "channel": "sms", "recipient": "+233201234567",
  "segments": 1, "estimatedChargeMinor": 150, "currency": "GHS",
  "acceptedAt": "2026-11-10T09:00:00.000Z", "note": "Accepted means queued, not delivered." } }
```

The send is priced first (effective `pricing_versions` row), credits move
`customer_available → customer_reserved`, and the provider dispatch happens
asynchronously in the worker.

### POST /messages/whatsapp — scope `messaging:send`

Within the 24-hour customer service window, free-form text:

```json
{ "to": "+233201234567", "text": "Hello!" }
```

Outside it, a Meta-approved template:

```json
{ "to": "+233201234567", "template": { "name": "order_update", "language": "en", "variables": ["1234"] } }
```

- Provide **exactly one** of `text` or `template` (else `400 VALIDATION_ERROR`).
- `text`: 1–4096 chars; requires an open service window
  (`409 SERVICE_WINDOW_CLOSED`).
- `template`: must exist and be Meta-approved (`404 TEMPLATE_NOT_FOUND`,
  `409 TEMPLATE_NOT_APPROVED`) with the exact variable count
  (`400 TEMPLATE_VARIABLES`).
- Optional `phoneNumberId` selects a specific connected sender number;
  otherwise the newest active number is used.

### GET /messages — scope `messaging:read`

Cursor pagination over the project's messages.

| Query | Rules |
|---|---|
| `limit` | 1–100, default 25 |
| `cursor` | ISO datetime — the `nextCursor` from the previous page |
| `status` | filter by message status |
| `channel` | `sms` or `whatsapp` |

```json
{ "data": { "items": [ { "id": "…", "channel": "sms", "recipient": "…", "status": "delivered",
  "segments": 1, "quotedMinor": 150, "chargedMinor": 150, "currency": "GHS",
  "createdAt": "…", "updatedAt": "…", "errorCode": null, "templateName": null } ],
  "nextCursor": "2026-11-10T08:59:59.000Z" } }
```

### GET /messages/:id — scope `messaging:read`

One message plus its delivery-event timeline:

```json
{ "data": { "id": "…", "status": "sent", "events": [ { "status": "queued", "occurredAt": "…", "createdAt": "…" } ] } }
```

### GET /balance — scope `messaging:read`

```json
{ "data": { "currency": "GHS", "availableMinor": 5000, "reservedMinor": 150 } }
```

Amounts are integer pesewas (GHS 1.00 = 100).

## Message statuses

`queued → sending → accepted → sent → delivered → read`, or terminal
`failed`. Two honest extra states: `pending_reconciliation` (the provider
answer was lost or ambiguous — never guessed) and `reconciled` (resolved
afterwards). `incoming` marks received WhatsApp messages.

## Error codes

| Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Request body/query failed schema validation |
| 400 | `INVALID_RECIPIENT` / `UNSUPPORTED_DESTINATION` / `INVALID_MESSAGE` / `MESSAGE_TOO_LONG` | Send-input rules |
| 401 | `INVALID_API_KEY` | Missing, invalid or revoked key — or a test key in production |
| 402 | `INSUFFICIENT_CREDITS` | Wallet balance is below the quote |
| 403 | `SCOPE_REQUIRED` / `ACCOUNT_NOT_ACTIVE` / `SENDER_NOT_APPROVED` / `UNSUPPORTED_COUNTRY` | Authorization and gating |
| 404 | `PROJECT_NOT_FOUND` / `MESSAGE_NOT_FOUND` / `TEMPLATE_NOT_FOUND` | Lookup misses |
| 409 | `CONSENT_REQUIRED` | No valid consent record for this (channel, recipient) |
| 409 | `RECIPIENT_SUPPRESSED` | Recipient opted out — suppression always wins |
| 409 | `IDEMPOTENCY_CONFLICT` | Key reused with a different body |
| 409 | `TEMPLATE_NOT_APPROVED` / `SERVICE_WINDOW_CLOSED` | WhatsApp policy gates |
| 429 | `RATE_LIMITED` / `DAILY_LIMIT` | Per-key rate or per-account daily limits |
| 503 | `SMS_UNAVAILABLE` / `WHATSAPP_UNAVAILABLE` / `PRICE_UNAVAILABLE` | Provider or pricing not configured — honest refusals |

Something unclear? Include the `requestId` from the response.
