import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, KeyRound, Radio, ShieldCheck } from 'lucide-react';
import { useApi, usePageTitle } from '../../lib/hooks';
import type { PublicConfig } from '../../lib/types';
import { Badge, Callout, CodeBlock, PageHeader } from '../../components/ui';

const sections = [
  { id: 'overview', label: 'Overview' },
  { id: 'authentication', label: 'Authentication' },
  { id: 'idempotency', label: 'Idempotency' },
  { id: 'send-sms', label: 'Send SMS' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'messages', label: 'Messages' },
  { id: 'balance', label: 'Balance' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'statuses', label: 'Statuses' },
  { id: 'errors', label: 'Errors and limits' },
  { id: 'pricing', label: 'Billing notes' },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-line pt-8 first:border-0 first:pt-0">
      <h2 className="text-xl font-semibold tracking-tight text-ink">{title}</h2>
      <div className="mt-3 space-y-4 text-sm leading-6 text-muted">{children}</div>
    </section>
  );
}

export function DocsPage() {
  usePageTitle('API documentation');
  const config = useApi<PublicConfig>('/public/config');
  const baseUrl = config.data?.publicApiUrl ?? 'https://your-devrelay-host.example';
  return (
    <div className="container-page py-10 sm:py-14">
      <PageHeader eyebrow="Documentation · API v1" title="Build with the DevRelay messaging API"
        description="Server-to-server endpoints for SMS, WhatsApp, delivery history and prepaid balance. Requests are tenant-scoped by API key, and sending is disabled until the account is approved and configured." />
      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <div className="surface-card flex items-center gap-3 p-4"><KeyRound className="h-5 w-5 text-brand-600" /><div><p className="text-xs text-muted">Base URL</p><p className="truncate text-sm font-semibold text-ink">{baseUrl}</p></div></div>
        <div className="surface-card flex items-center gap-3 p-4"><Radio className="h-5 w-5 text-brand-600" /><div><p className="text-xs text-muted">Auth</p><p className="text-sm font-semibold text-ink">Bearer project key</p></div></div>
        <div className="surface-card flex items-center gap-3 p-4"><ShieldCheck className="h-5 w-5 text-brand-600" /><div><p className="text-xs text-muted">Transport</p><p className="text-sm font-semibold text-ink">HTTPS + JSON only</p></div></div>
      </div>
      <div className="grid gap-10 lg:grid-cols-[210px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav className="sticky top-24 space-y-1" aria-label="Documentation sections">
            {sections.map(section => (
              <a key={section.id} href={`#${section.id}`} className="block rounded-lg px-3 py-1.5 text-xs font-medium text-muted hover:bg-elevated hover:text-ink">
                {section.label}
              </a>
            ))}
          </nav>
        </aside>
        <div className="min-w-0 space-y-8">
          <Callout tone="warning" title="Read this before integrating">
            This documentation describes the implemented API. Live provider traffic requires external credentials, sender approval, Meta approval and published prices. Test API keys are refused in production, and there is no fake success mode in the production UI.
          </Callout>

          <Section id="overview" title="Overview">
            <p>All API routes live under <code>{baseUrl}/api/v1</code>. JSON is required for request bodies. Successful responses wrap the payload in <code>{'{ "data": … }'}</code>; errors use <code>{'{ "error": { "code": "…", "message": "…" }, "requestId": "…" }'}</code>.</p>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Method</th><th>Path</th><th>Scope</th><th>Purpose</th></tr></thead>
                <tbody>
                  <tr><td><Badge tone="info">POST</Badge></td><td><code>/messages/sms</code></td><td>messaging:send</td><td>Queue an SMS</td></tr>
                  <tr><td><Badge tone="info">POST</Badge></td><td><code>/messages/whatsapp</code></td><td>messaging:send</td><td>Queue a WhatsApp message</td></tr>
                  <tr><td><Badge tone="success">GET</Badge></td><td><code>/messages</code></td><td>messaging:read</td><td>List project messages</td></tr>
                  <tr><td><Badge tone="success">GET</Badge></td><td><code>/messages/:id</code></td><td>messaging:read</td><td>Read a message and events</td></tr>
                  <tr><td><Badge tone="success">GET</Badge></td><td><code>/balance</code></td><td>messaging:read</td><td>Read available and reserved credit</td></tr>
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="authentication" title="Authentication">
            <p>Create a project in the dashboard, then issue an API key with the scopes you need. Send it as a Bearer token. Keys are shown once and stored as a one-way hash.</p>
            <CodeBlock label="Authorization header" code={`Authorization: Bearer dr_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`} />
            <p>Keys starting with <code>dr_test_</code> are development-only and are rejected when the server runs in production. A key is bound to one project and cannot read another tenant’s messages. Revoked and rotated keys fail immediately.</p>
          </Section>

          <Section id="idempotency" title="Idempotency">
            <p>Both send endpoints require an <code>Idempotency-Key</code> header. Use a stable value derived from your own business operation, for example an order or job identifier. The same key with the same JSON body returns the original accepted result; the same key with a different body returns <code>409 IDEMPOTENCY_CONFLICT</code>.</p>
            <CodeBlock label="Required header" code={`Idempotency-Key: order-1042-sms`} />
            <p>Keys must be 8–128 characters and match <code>[A-Za-z0-9._:-]+</code>. The key is claimed inside the same transaction that reserves credits, so concurrent retries cannot double-charge.</p>
          </Section>

          <Section id="send-sms" title="Send SMS">
            <p>Ghana accounts can send an SMS when the account is active, the sender ID is approved, the recipient has a current consent record and SMS is configured on the server.</p>
            <CodeBlock label="Request" code={`curl -X POST ${baseUrl}/api/v1/messages/sms \\
  -H "Authorization: Bearer dr_live_..." \\
  -H "Idempotency-Key: order-1042-sms" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "+233201234567",
    "senderId": "DEVRELAY",
    "body": "Your order 1042 is ready for pickup."
  }'`} />
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Field</th><th>Type</th><th>Rules</th></tr></thead>
                <tbody>
                  <tr><td><code>to</code></td><td>string</td><td>Ghana mobile number; international format is normalized.</td></tr>
                  <tr><td><code>senderId</code></td><td>string</td><td>3–11 alphanumeric characters, must be approved for your account.</td></tr>
                  <tr><td><code>body</code></td><td>string</td><td>1–1600 characters. Segments are calculated with GSM/UCS-2 rules.</td></tr>
                </tbody>
              </table>
            </div>
            <CodeBlock label="202 Accepted" code={`{
  "data": {
    "id": "b4c0f47e-…",
    "status": "queued",
    "channel": "sms",
    "recipient": "+233201234567",
    "segments": 1,
    "estimatedChargeMinor": 500,
    "currency": "GHS",
    "acceptedAt": "2026-11-05T10:20:30.000Z",
    "note": "Accepted means queued, not delivered."
  }
}`} />
            <Callout tone="info" title="202 is not delivery">A 202 response means the message and its credit reservation were recorded. Delivery is confirmed only by provider events and signed webhooks.</Callout>
          </Section>

          <Section id="whatsapp" title="WhatsApp">
            <p>WhatsApp sending needs an admin-activated connection with confirmed Meta billing. Free-form text is allowed only inside the 24-hour customer service window; otherwise use a Meta-approved template.</p>
            <CodeBlock label="Template message" code={`curl -X POST ${baseUrl}/api/v1/messages/whatsapp \\
  -H "Authorization: Bearer dr_live_..." \\
  -H "Idempotency-Key: appointment-88-wa" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "+233201234567",
    "template": {
      "name": "appointment_reminder",
      "language": "en",
      "variables": ["Ama", "Friday 10:00"]
    }
  }'`} />
            <p>Provide exactly one of <code>text</code> or <code>template</code>. You may optionally select a connected sender with <code>phoneNumberId</code> (the DevRelay WhatsApp number id, not Meta’s phone number ID). Templates must be approved and the variable count must match. Message pricing depends on the destination country and Meta’s category.</p>
            <p>Inbound messages and status changes arrive through the Meta webhook configured on the server. Conversations, template sync and Embedded Signup are managed in the dashboard.</p>
          </Section>

          <Section id="messages" title="Messages">
            <p>List messages for the key’s project with cursor pagination. Results are newest first. Supported query parameters: <code>limit</code> (1–100, default 25), <code>cursor</code>, <code>status</code>, <code>channel</code>.</p>
            <CodeBlock label="List messages" code={`GET ${baseUrl}/api/v1/messages?channel=sms&status=delivered&limit=25
Authorization: Bearer dr_live_...`} />
            <p><code>nextCursor</code> is null on the last page. The message detail endpoint includes the status event timeline and the amounts quoted and charged in minor units.</p>
          </Section>

          <Section id="balance" title="Balance">
            <CodeBlock label="Read balance" code={`GET ${baseUrl}/api/v1/balance
Authorization: Bearer dr_live_...`} />
            <p>Returns <code>availableMinor</code>, <code>reservedMinor</code> and <code>currency</code>. Reserved credit backs queued or uncertain messages and is either settled or released when provider evidence is resolved. Amounts are integer pesewas.</p>
          </Section>

          <Section id="webhooks" title="Webhooks">
            <p>Create an HTTPS endpoint in the dashboard and subscribe to events. Requests are signed with HMAC-SHA256 over <code>timestamp + "." + rawBody</code>, using the endpoint secret shown once at creation.</p>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Header</th><th>Meaning</th></tr></thead>
                <tbody>
                  <tr><td><code>X-DevRelay-Signature</code></td><td><code>sha256=&lt;hex&gt;</code></td></tr>
                  <tr><td><code>X-DevRelay-Timestamp</code></td><td>Unix seconds used in the signature</td></tr>
                  <tr><td><code>X-DevRelay-Event-Id</code></td><td>Unique event identifier for deduplication</td></tr>
                </tbody>
              </table>
            </div>
            <CodeBlock label="Verify a webhook (Node.js)" code={`import { createHmac, timingSafeEqual } from "node:crypto";

function verify(rawBody, headers, secret) {
  const timestamp = headers["x-devrelay-timestamp"];
  const received = headers["x-devrelay-signature"];
  if (!timestamp || !received) return false;

  // Reject stale requests to reduce replay risk (5 minutes shown).
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const expected = "sha256=" + createHmac("sha256", secret)
    .update(timestamp + "." + rawBody)
    .digest("hex");

  return received.length === expected.length &&
    timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}`} />
            <p>Events include <code>message.accepted</code>, <code>message.sent</code>, <code>message.delivered</code>, <code>message.read</code>, <code>message.failed</code> and <code>message.reconciled</code>. A <code>webhook.test</code> event is available from the dashboard. Respond with a 2xx quickly and process asynchronously.</p>
            <p>Destinations must be public HTTPS on port 443. Private, loopback, link-local and internal addresses are blocked; DNS is resolved and pinned immediately before each delivery. Redirects are not followed.</p>
          </Section>

          <Section id="statuses" title="Statuses">
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
                <tbody>
                  <tr><td><Badge tone="info">queued</Badge></td><td>Accepted, credits reserved, waiting for a worker.</td></tr>
                  <tr><td><Badge tone="info">sending</Badge></td><td>A worker has claimed the message and is calling the provider.</td></tr>
                  <tr><td><Badge tone="info">accepted / sent</Badge></td><td>Provider accepted or reports the message as sent. Not proof of delivery.</td></tr>
                  <tr><td><Badge tone="success">delivered / read</Badge></td><td>Provider evidence confirms delivery or reading. The reservation is settled.</td></tr>
                  <tr><td><Badge tone="danger">failed</Badge></td><td>A definitive failure. WhatsApp failures may release credit; SMS reservations may require operator reconciliation.</td></tr>
                  <tr><td><Badge tone="warning">pending_reconciliation</Badge></td><td>Outcome is uncertain. Credits remain reserved until an operator resolves them.</td></tr>
                  <tr><td><Badge tone="neutral">reconciled</Badge></td><td>An operator recorded a charge or release decision for an uncertain message.</td></tr>
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="errors" title="Errors and limits">
            <p>Errors use a stable machine code, a human message and the request ID. Do not parse messages; branch on <code>code</code>. Common codes include <code>AUTH_REQUIRED</code>, <code>INVALID_API_KEY</code>, <code>SCOPE_REQUIRED</code>, <code>CONSENT_REQUIRED</code>, <code>RECIPIENT_SUPPRESSED</code>, <code>SENDER_NOT_APPROVED</code>, <code>ACCOUNT_NOT_ACTIVE</code>, <code>TEMPLATE_NOT_APPROVED</code>, <code>SERVICE_WINDOW_CLOSED</code>, <code>IDEMPOTENCY_CONFLICT</code> and <code>RATE_LIMITED</code>.</p>
            <p>Project keys are limited to 20 write requests and 120 read requests per minute. Responses include <code>RateLimit-Limit</code>, <code>RateLimit-Remaining</code> and <code>RateLimit-Reset</code>. A 429 means back off; send retries should reuse the same idempotency key.</p>
            <CodeBlock label="Error shape" code={`{
  "error": {
    "code": "CONSENT_REQUIRED",
    "message": "Record recipient consent in the dashboard before sending."
  },
  "requestId": "req_..."
}`} />
          </Section>

          <Section id="pricing" title="Billing notes">
            <p>Quoted amounts are calculated from the active price version at acceptance time. A reservation is moved from available to reserved credit. Definitive delivery settles the reservation as revenue; definitive failure may release it. Uncertain outcomes stay reserved and are surfaced for operator reconciliation.</p>
            <p>WhatsApp pricing follows Meta’s per-message categories and may be revised by Meta. Free-form service replies are not assumed to be free. The platform never invents a missing price — sending fails with a configuration error instead.</p>
            <p><Link to="/pricing" className="link">See the currently published price book <ArrowRight className="inline h-3.5 w-3.5" /></Link></p>
          </Section>

          <div className="rounded-2xl border border-line bg-surface p-5">
            <div className="flex items-start gap-3">
              <BookOpen className="mt-0.5 h-5 w-5 text-brand-600" />
              <div>
                <p className="text-sm font-semibold text-ink">Need the machine-readable contract?</p>
                <p className="mt-1 text-xs leading-5 text-muted">An OpenAPI 3.1 description is shipped with the frontend at <code>/openapi.yaml</code>. It describes these endpoints and schemas; it does not replace the operational checks described above.</p>
                <a href="/openapi.yaml" className="link mt-2 inline-flex items-center gap-1 text-xs">Download OpenAPI <ArrowRight className="h-3.5 w-3.5" /></a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
