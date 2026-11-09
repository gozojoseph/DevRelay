import { Link } from 'react-router-dom';
import {
  ArrowRight, CheckCircle2, Code2, CreditCard, KeyRound, LockKeyhole, MessageCircle, ReceiptText,
  ShieldCheck, Smartphone, Webhook, Zap,
} from 'lucide-react';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatMinor } from '../../lib/format';
import type { PricingResponse, PublicConfig } from '../../lib/types';
import { Badge, buttonClass, Callout, CodeBlock, Loading, StatusBadge } from '../../components/ui';

const features = [
  { icon: Smartphone, title: 'Ghana SMS delivery', body: 'Send transactional SMS through Africa’s Talking with sender ID approval, delivery receipts and per-segment pricing.' },
  { icon: MessageCircle, title: 'WhatsApp Cloud API', body: 'Connect a WhatsApp Business account through Meta Embedded Signup, sync templates and reply inside the customer service window.' },
  { icon: ReceiptText, title: 'Prepaid credit ledger', body: 'Every top-up, reservation, charge and release is an immutable double-entry ledger transaction — integer pesewas, never floats.' },
  { icon: Webhook, title: 'Signed delivery webhooks', body: 'Receive HMAC-signed events for accepted, sent, delivered, read and failed messages, with retries and an audit trail.' },
  { icon: ShieldCheck, title: 'Consent by default', body: 'Outbound sends require a consent record. Opt-outs are suppressed permanently and every message is attributable to a project.' },
  { icon: KeyRound, title: 'Project-scoped API keys', body: 'Issue scoped keys, rotate or revoke them, enforce per-minute rate limits and keep an append-only audit history.' },
];

const steps = [
  { title: 'Create and verify', body: 'Register your business, verify the owner email and submit the intended use for review.' },
  { title: 'Get approved', body: 'An operator reviews the account. Funding and sending stay disabled until approval.' },
  { title: 'Configure sending', body: 'Request an SMS sender ID, record recipient consent and connect WhatsApp if you need it.' },
  { title: 'Fund and send', body: 'Top up GHS credits with Paystack, create a project API key and call the messaging API.' },
];

export function HomePage() {
  usePageTitle('SMS and WhatsApp infrastructure for Ghana');
  const config = useApi<PublicConfig>('/public/config');
  const pricing = useApi<PricingResponse>('/public/pricing');
  const flags = config.data;
  const prices = pricing.data?.items ?? [];
  return (
    <>
      <section className="relative overflow-hidden border-b border-line">
        <div className="absolute inset-0 grid-lines opacity-70" aria-hidden="true" />
        <div className="absolute -right-20 top-0 h-72 w-72 rounded-full bg-brand-400/20 blur-3xl" aria-hidden="true" />
        <div className="container-page relative grid gap-12 py-16 sm:py-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-24">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="success" dot>Prepaid GHS credits</Badge>
              <Badge tone="neutral">Built for Ghana</Badge>
            </div>
            <h1 className="mt-5 max-w-2xl text-balance text-4xl font-semibold leading-[1.08] tracking-tight text-ink sm:text-5xl lg:text-[3.4rem]">
              Messaging APIs that show you exactly what happened.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-muted">
              DevRelay is a prepaid SMS and WhatsApp platform for product teams. Send through approved providers, track every delivery event and reconcile every pesewa in an auditable ledger.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link to="/register" className={buttonClass('primary', 'lg')}>Create an account <ArrowRight className="h-4 w-4" /></Link>
              <Link to="/docs" className={buttonClass('secondary', 'lg')}><Code2 className="h-4 w-4" /> Read the API docs</Link>
            </div>
            <p className="mt-4 flex items-center gap-2 text-xs text-muted">
              <CheckCircle2 className="h-4 w-4 text-brand-600" /> No subscriptions. No invented balances or deliveries. Email verification and operator approval are required.
            </p>
            <div className="mt-8 flex flex-wrap gap-2">
              {flags ? (
                <>
                  <StatusBadge status={flags.smsAvailable ? 'active' : 'disabled'} />
                  <span className="self-center text-xs text-muted">SMS {flags.smsAvailable ? 'configured' : 'not configured'}</span>
                  <span className="mx-1 h-4 w-px self-center bg-line" />
                  <StatusBadge status={flags.whatsappProductionApproved ? 'active' : flags.whatsappAvailable ? 'pending' : 'disabled'} />
                  <span className="self-center text-xs text-muted">
                    WhatsApp {flags.whatsappProductionApproved ? 'production' : flags.whatsappAvailable ? 'test mode' : 'not configured'}
                  </span>
                  <span className="mx-1 h-4 w-px self-center bg-line" />
                  <StatusBadge status={flags.fundingAvailable ? 'active' : 'disabled'} />
                  <span className="self-center text-xs text-muted">Funding {flags.fundingAvailable ? 'available' : 'not configured'}</span>
                </>
              ) : (
                <span className="text-xs text-muted">Checking provider configuration…</span>
              )}
            </div>
          </div>
          <div className="relative">
            <div className="absolute -inset-4 rounded-3xl bg-brand-500/5 blur-2xl" aria-hidden="true" />
            <div className="relative surface-card p-2 shadow-lift">
              <CodeBlock label="POST /api/v1/messages/sms" code={`curl -X POST https://api.devrelay.app/api/v1/messages/sms \\
  -H "Authorization: Bearer dr_live_..." \\
  -H "Idempotency-Key: order-1042-sms" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "+233201234567",
    "senderId": "DEVRELAY",
    "body": "Your order 1042 is ready for pickup."
  }'`} />
              <div className="mx-3 mb-3 mt-3 rounded-xl border border-line bg-elevated/60 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Response · 202 Accepted</span>
                  <Badge tone="info">queued ≠ delivered</Badge>
                </div>
                <pre className="mt-2 overflow-x-auto text-[11px] leading-5 text-ink"><code>{`{
  "data": {
    "id": "3f2c…",
    "status": "queued",
    "estimatedChargeMinor": 500
  }
}`}</code></pre>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="capabilities" className="container-page py-16 sm:py-20">
        <div className="max-w-2xl">
          <p className="eyebrow">The platform</p>
          <h2 className="section-title">One console for sending, compliance and cost control.</h2>
          <p className="section-copy">Real provider integrations with honest states. If a provider or price is not configured, the dashboard says so instead of simulating success.</p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(feature => (
            <article key={feature.title} className="surface-card p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10 text-brand-700 dark:text-brand-400">
                <feature.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-sm font-semibold text-ink">{feature.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="container-page grid gap-10 py-16 lg:grid-cols-[0.9fr_1.1fr] lg:py-20">
          <div>
            <p className="eyebrow">From zero to first send</p>
            <h2 className="section-title">Approval gates protect your account and your recipients.</h2>
            <p className="section-copy">Messaging is regulated and providers require identity checks. DevRelay makes those steps explicit rather than hiding them behind a fake sandbox success screen.</p>
            <div className="mt-6">
              <Callout tone="info" title="Current provider status">
                {flags
                  ? `SMS: ${flags.smsAvailable ? 'configured' : 'not configured'} · WhatsApp: ${flags.whatsappProductionApproved ? 'production approved' : flags.whatsappAvailable ? 'test mode only' : 'not configured'} · Funding: ${flags.fundingAvailable ? 'available' : 'not configured'}.`
                  : 'Loading the current server configuration…'}
              </Callout>
            </div>
          </div>
          <ol className="space-y-3">
            {steps.map((step, index) => (
              <li key={step.title} className="flex gap-4 rounded-xl border border-line bg-elevated/40 p-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">{index + 1}</span>
                <div>
                  <h3 className="text-sm font-semibold text-ink">{step.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="container-page py-16 sm:py-20">
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <p className="eyebrow">Prepaid, not postpaid</p>
            <h2 className="section-title">Pricing you can read before you send.</h2>
            <p className="section-copy">Fund a GHS wallet with Paystack. Credits are reserved when a message is queued and settled only when a provider confirms delivery. Failed SMS reservations stay visible for operator reconciliation.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {[
                { icon: CreditCard, title: 'Paystack funding', body: 'Server-verified payments, no client-side success claims.' },
                { icon: ReceiptText, title: 'Integer pesewas', body: 'No floating-point money anywhere in the ledger.' },
                { icon: LockKeyhole, title: 'Encrypted content', body: 'Message bodies are encrypted at rest per account.' },
                { icon: Zap, title: 'Idempotent sends', body: 'Retry safely without double-charging or double-sending.' },
              ].map(item => (
                <div key={item.title} className="muted-card p-4">
                  <item.icon className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                  <h3 className="mt-2 text-sm font-semibold text-ink">{item.title}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="surface-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold text-ink">Published prices</h3>
                <p className="mt-1 text-xs text-muted">Live from the platform price book</p>
              </div>
              <Link to="/pricing" className="link text-xs">Full pricing</Link>
            </div>
            <div className="p-5">
              {pricing.loading ? <Loading label="Loading prices…" /> : prices.length ? (
                <div className="space-y-3">
                  {prices.slice(0, 4).map(item => (
                    <div key={item.id} className="flex items-center justify-between gap-4 rounded-xl border border-line bg-elevated/40 px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-ink">{item.channel === 'sms' ? 'SMS' : 'WhatsApp'} · {item.category}</p>
                        <p className="mt-0.5 text-xs text-muted">{item.country} · {item.route.replaceAll('_', ' ')}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-ink">{formatMinor(item.customerUnitMinor)}</p>
                        <p className="text-[11px] text-muted">per {item.channel === 'sms' ? 'segment' : 'message'}</p>
                      </div>
                    </div>
                  ))}
                  {pricing.data?.minimumFundingMinor ? (
                    <p className="pt-1 text-xs text-muted">Minimum funding: <span className="font-semibold text-ink">{formatMinor(pricing.data.minimumFundingMinor)}</span></p>
                  ) : null}
                </div>
              ) : (
                <Callout tone="warning" title="No prices are published yet">
                  The platform does not invent prices. An administrator must configure the price book before sending is possible.
                </Callout>
              )}
              <Link to="/pricing" className={buttonClass('secondary', 'md', 'mt-5 w-full')}>See pricing details <ArrowRight className="h-4 w-4" /></Link>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-line bg-surface">
        <div className="container-page py-16 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[1fr_1fr]">
            <div>
              <p className="eyebrow">Built for operators, too</p>
              <h2 className="section-title">A back office that treats money and consent seriously.</h2>
              <p className="section-copy">Administrators review accounts and sender IDs, publish price versions, reconcile uncertain SMS charges, activate WhatsApp billing and inspect an append-only audit log. Admin access requires TOTP MFA.</p>
              <div className="mt-6 flex flex-wrap gap-2">
                {['Tenant isolation', 'CSRF protection', 'HTTP-only sessions', 'SSRF-safe webhooks', 'Encrypted provider tokens', 'Rate limits'].map(item => (
                  <Badge key={item} tone="neutral">{item}</Badge>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              {[
                { q: 'Can I send without approval?', a: 'No. Email verification, administrator approval, an approved sender ID and a recorded consent are required before an SMS can be queued.' },
                { q: 'What happens if delivery is uncertain?', a: 'The message is marked pending reconciliation and its credits stay reserved. An operator resolves the reservation as a charge or a release — the system never guesses.' },
                { q: 'Is WhatsApp production enabled?', a: 'Only when Meta production approval is explicitly configured on the server. Test-mode connections are labelled and production stays blocked otherwise.' },
                { q: 'Do you support other countries?', a: 'Customer SMS billing currently supports Ghana. WhatsApp availability depends on Meta per-message pricing for the recipient country and must be configured in the price book.' },
              ].map(item => (
                <details key={item.q} className="group rounded-xl border border-line bg-canvas px-4 py-3">
                  <summary className="cursor-pointer list-none text-sm font-semibold text-ink marker:hidden">{item.q}</summary>
                  <p className="mt-2 text-sm leading-6 text-muted">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="container-page py-16">
        <div className="relative overflow-hidden rounded-3xl border border-brand-200 bg-brand-50 px-6 py-10 dark:border-brand-500/30 dark:bg-brand-500/10 sm:px-10">
          <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-brand-400/20 blur-3xl" aria-hidden="true" />
          <div className="relative flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-ink">Start with the real platform.</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted">Create an account, verify your email and submit your business for approval. No payment is taken until you choose to fund your wallet.</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Link to="/register" className={buttonClass('primary', 'lg')}>Create account</Link>
              <Link to="/docs" className={buttonClass('secondary', 'lg')}>Read docs</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
