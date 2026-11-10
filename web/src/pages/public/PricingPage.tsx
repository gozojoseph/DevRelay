import { Link } from 'react-router-dom';
import { ArrowRight, Calculator, Info, MessageCircle, Server, Smartphone } from 'lucide-react';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatDate, formatMinor, titleCase } from '../../lib/format';
import type { CloudPublic, PricingItem, PricingResponse, PublicConfig } from '../../lib/types';
import { Badge, buttonClass, Callout, EmptyState, Loading, PageHeader, Panel } from '../../components/ui';

function PriceTable({ items }: { items: PricingItem[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr><th>Destination</th><th>Category</th><th>Route</th><th className="text-right">Price</th><th>Effective from</th></tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.id}>
              <td className="font-medium text-ink">{item.country}</td>
              <td><Badge tone="neutral">{titleCase(item.category)}</Badge></td>
              <td className="text-muted">{titleCase(item.route)}</td>
              <td className="text-right font-semibold text-ink">{formatMinor(item.customerUnitMinor)}</td>
              <td className="text-muted">{formatDate(item.effectiveFrom)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PricingPage() {
  usePageTitle('Pricing');
  const pricing = useApi<PricingResponse>('/public/pricing');
  const config = useApi<PublicConfig>('/public/config');
  const cloud = useApi<CloudPublic>('/public/cloud');
  const sms = pricing.data?.items.filter(item => item.channel === 'sms') ?? [];
  const whatsapp = pricing.data?.items.filter(item => item.channel === 'whatsapp') ?? [];
  return (
    <div className="container-page py-12 sm:py-16">
      <PageHeader eyebrow="Pricing" title="Prepaid pricing, published from the live price book."
        description="Prices below are read from the platform’s configured price versions. If nothing is published, nothing can be sent or charged. No prices are invented on this page." />
      {pricing.loading ? <Loading label="Loading the price book…" /> : pricing.error ? (
        <Callout tone="danger" title="Could not load pricing">{pricing.error}</Callout>
      ) : !pricing.data?.items.length ? (
        <Panel><EmptyState icon={Calculator} title="No prices are published yet"
          description="An administrator must configure at least one price for SMS or WhatsApp before sending is enabled. Check back after platform setup." /></Panel>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="surface-card p-5">
              <p className="text-xs font-medium text-muted">Billing currency</p>
              <p className="mt-2 text-2xl font-semibold text-ink">GHS</p>
              <p className="mt-1 text-xs text-muted">Integer pesewas in the ledger</p>
            </div>
            <div className="surface-card p-5">
              <p className="text-xs font-medium text-muted">Minimum funding</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{pricing.data.minimumFundingMinor ? formatMinor(pricing.data.minimumFundingMinor) : 'Not set'}</p>
              <p className="mt-1 text-xs text-muted">{config.data?.fundingAvailable ? 'Paystack funding available' : 'Funding is not currently configured'}</p>
            </div>
            <div className="surface-card p-5">
              <p className="text-xs font-medium text-muted">Billing model</p>
              <p className="mt-2 text-2xl font-semibold text-ink">Prepaid</p>
              <p className="mt-1 text-xs text-muted">Reserve, settle on delivery, reconcile uncertainty</p>
            </div>
          </div>

          {sms.length ? (
            <Panel title={<span className="inline-flex items-center gap-2"><Smartphone className="h-4 w-4 text-brand-600" /> SMS</span>}
              description="Charged per SMS segment. Long or non-GSM messages use more than one segment; the API response includes the segment count used to calculate the reservation."
              bodyClassName="p-0 sm:p-0">
              <div className="px-5 pt-4"><Callout tone="info">The dashboard and API quote the exact amount at acceptance. Delivery-level reconciliation may later adjust the reservation based on provider evidence.</Callout></div>
              <div className="p-5"><PriceTable items={sms} /></div>
            </Panel>
          ) : null}

          {whatsapp.length ? (
            <Panel title={<span className="inline-flex items-center gap-2"><MessageCircle className="h-4 w-4 text-brand-600" /> WhatsApp</span>}
              description="Meta charges per delivered message and category. DevRelay reserves the configured customer price when a message is queued and settles from provider webhook evidence."
              bodyClassName="p-0 sm:p-0">
              <div className="px-5 pt-4"><Callout tone="warning">WhatsApp service replies are not universally free. The price book must include a service category for the destination country if you intend to send free-form replies inside the 24-hour window.</Callout></div>
              <div className="p-5"><PriceTable items={whatsapp} /></div>
            </Panel>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="How charges work">
              <ul className="space-y-3 text-sm leading-6 text-muted">
                <li className="flex gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> Credits are reserved when a message is accepted, not when it is delivered.</li>
                <li className="flex gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> A definitive delivery failure releases the reservation; provider-billed failures are documented and may be charged.</li>
                <li className="flex gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> When delivery is uncertain, credits stay reserved and the message appears in admin reconciliation. The system does not silently refund or double-charge.</li>
                <li className="flex gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> Every movement is a balanced, immutable ledger transaction. You can export the credit history from the wallet.</li>
              </ul>
            </Panel>
            <Panel title="Provider costs and availability">
              <p className="text-sm leading-6 text-muted">The customer price is separate from the upstream provider cost recorded by operators. Availability depends on real credentials and approvals from Paystack, Africa’s Talking and Meta; this page only reflects the configured price book.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge tone={config.data?.smsAvailable ? 'success' : 'danger'}>{config.data?.smsAvailable ? 'SMS configured' : 'SMS not configured'}</Badge>
                <Badge tone={config.data?.whatsappAvailable ? 'success' : 'danger'}>{config.data?.whatsappAvailable ? 'WhatsApp configured' : 'WhatsApp not configured'}</Badge>
                <Badge tone={config.data?.fundingAvailable ? 'success' : 'danger'}>{config.data?.fundingAvailable ? 'Funding configured' : 'Funding not configured'}</Badge>
              </div>
              <p className="mt-4 text-xs leading-5 text-muted">{pricing.data.note}</p>
              <Link to="/docs#pricing" className={buttonClass('secondary', 'md', 'mt-4')}>Read billing notes <ArrowRight className="h-4 w-4" /></Link>
            </Panel>
          </div>
        </div>
      )}

      <Panel className="mt-8" title={<span className="inline-flex items-center gap-2"><Server className="h-4 w-4 text-brand-600" /> DevRelay Cloud — app hosting & domains</span>}
        description="The same GHS wallet pays for hosting and domains: monthly plans charged in advance, domains with auto-renew and explicit lapse warnings."
        action={<div className="flex flex-wrap gap-2">
          <Badge tone={cloud.data?.hosting.available ? 'success' : 'neutral'} dot>{cloud.data?.hosting.available ? 'Hosting live' : 'Hosting coming soon'}</Badge>
          <Badge tone={cloud.data?.domains.available ? 'success' : 'neutral'} dot>{cloud.data?.domains.available ? 'Domains live' : 'Domains coming soon'}</Badge>
        </div>}>
        <div className="grid gap-4 sm:grid-cols-2">
          {(cloud.data?.hosting.plans ?? []).map(plan => (
            <div key={plan.id} className="rounded-xl border border-line bg-elevated/40 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-ink">{plan.label}</p>
                <Badge tone="neutral">{plan.memoryMb} MB · {plan.cpuMilli} mCPU</Badge>
              </div>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-ink">{formatMinor(plan.priceMinor)}<span className="text-sm font-normal text-muted">/month</span></p>
              <p className="mt-1 text-xs text-muted">One container per app, Git deploys, HTTPS URL and logs.</p>
            </div>
          ))}
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Domain</th><th className="text-right">Price / year</th></tr></thead>
            <tbody>
              {(cloud.data?.domains.pricing ?? []).map(entry => (
                <tr key={entry.tld}>
                  <td className="font-medium text-ink">.{entry.tld}</td>
                  <td className="text-right font-semibold text-ink">{formatMinor(entry.priceMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4">
          <Callout tone="info">
            Prices are published from the platform catalogs — never invented on this page. Hosting is billed per 30-day period
            in advance (a paused app never bills silently); domains renew yearly and warn at 30/14/7/1 days because an
            unrenewed domain can be lost. Both unlock in the dashboard {cloud.data?.hosting.available || cloud.data?.domains.available ? '' : 'once the infrastructure goes live'}.
          </Callout>
        </div>
      </Panel>

      <div className="mt-10 flex flex-col items-start justify-between gap-4 rounded-2xl border border-line bg-surface px-6 py-6 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-base font-semibold text-ink">Ready to test with a real account?</h2>
          <p className="mt-1 text-sm text-muted">Registration is free. Funding and messaging unlock after verification, approval and configuration.</p>
        </div>
        <Link to="/register" className={buttonClass('primary', 'md')}>Create an account</Link>
      </div>
    </div>
  );
}
