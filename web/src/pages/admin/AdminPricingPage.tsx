import { useState, type FormEvent } from 'react';
import { CalendarClock, Plus, Tags } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatDate, formatMinor, parseGhsToMinor, titleCase } from '../../lib/format';
import type { PricingVersion } from '../../lib/types';
import { useToast } from '../../context/ToastContext';
import {
  Badge, Button, Callout, EmptyState, Field, Loading, PageHeader, Panel, Select, TextInput,
} from '../../components/ui';

interface FormState { channel: 'sms' | 'whatsapp'; country: string; route: string; category: string;
  customer: string; providerCost: string; providerCurrency: string; effectiveFrom: string }

const initial: FormState = { channel: 'sms', country: 'GH', route: 'ghana_standard', category: 'transactional',
  customer: '', providerCost: '', providerCurrency: 'GHS', effectiveFrom: '' };

export function AdminPricingPage() {
  usePageTitle('Pricing');
  const { toast } = useToast();
  const pricing = useApi<PricingVersion[]>('/admin/pricing');
  const [form, setForm] = useState<FormState>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();
  function changeChannel(channel: 'sms' | 'whatsapp') {
    setForm(current => ({ ...current, channel,
      route: channel === 'sms' ? 'ghana_standard' : 'meta_cloud',
      category: channel === 'sms' ? 'transactional' : 'marketing',
      country: 'GH' }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const customer = parseGhsToMinor(form.customer);
    if (customer === null || customer <= 0) { setError('Enter a positive customer price in GHS.'); return; }
    const providerCost = form.providerCost.trim() ? parseGhsToMinor(form.providerCost) : null;
    if (form.providerCost.trim() && providerCost === null) { setError('Provider cost must be a valid GHS amount.'); return; }
    setBusy(true); setError(null);
    try {
      await api('/admin/pricing', { method: 'POST', body: { channel: form.channel, country: form.country.toUpperCase(),
        route: form.route.trim(), category: form.category.trim(), customerUnitMinor: customer,
        ...(providerCost !== null ? { providerCostMinor: providerCost, providerCostCurrency: form.providerCurrency.toUpperCase() } : {}),
        ...(form.effectiveFrom ? { effectiveFrom: new Date(form.effectiveFrom).toISOString() } : {}) } });
      setForm(current => ({ ...initial, channel: current.channel, route: current.route, category: current.category }));
      await pricing.reload();
      toast('Price version published.', 'success');
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  return (
    <>
      <PageHeader eyebrow="Commerce" title="Pricing"
        description="Publish customer prices and optional provider costs. A new version can close the current window from its effective time; overlapping versions for the same route and category are rejected." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <Panel title={<span className="inline-flex items-center gap-2"><Plus className="h-4 w-4 text-brand-600" /> Publish a price</span>} description="Amounts are entered in GHS and stored as integer pesewas. Never enter an estimate as provider evidence.">
          {error ? <div className="mb-4"><Callout tone="danger">{error}</Callout></div> : null}
          <form onSubmit={submit} className="space-y-4">
            <Field label="Channel" htmlFor="price-channel" required>
              <Select id="price-channel" value={form.channel} onChange={event => changeChannel(event.target.value as 'sms' | 'whatsapp')}>
                <option value="sms">SMS</option><option value="whatsapp">WhatsApp</option>
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Country" htmlFor="price-country" required hint="ISO 3166-1 alpha-2, uppercase.">
                <TextInput id="price-country" required pattern="[A-Za-z]{2}" maxLength={2} value={form.country} onChange={event => setForm(current => ({ ...current, country: event.target.value.toUpperCase() }))} />
              </Field>
              <Field label="Route" htmlFor="price-route" required hint="SMS: ghana_standard. WhatsApp: meta_cloud.">
                <TextInput id="price-route" required minLength={2} maxLength={60} value={form.route} onChange={event => setForm(current => ({ ...current, route: event.target.value }))} />
              </Field>
            </div>
            <Field label="Category" htmlFor="price-category" required hint="SMS currently uses transactional. WhatsApp pricing uses Meta’s categories, including service when applicable.">
              <Select id="price-category" value={form.category} onChange={event => setForm(current => ({ ...current, category: event.target.value }))}>
                {form.channel === 'sms' ? <><option value="transactional">Transactional</option><option value="service">Service</option><option value="marketing">Marketing</option></> : <><option value="marketing">Marketing</option><option value="utility">Utility</option><option value="authentication">Authentication</option><option value="service">Service</option></>}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Customer price (GHS)" htmlFor="price-customer" required hint="Per SMS segment or WhatsApp message.">
                <TextInput id="price-customer" inputMode="decimal" required value={form.customer} onChange={event => setForm(current => ({ ...current, customer: event.target.value }))} placeholder="0.50" />
              </Field>
              <Field label="Provider cost (GHS, optional)" htmlFor="price-provider" hint="Your upstream cost per unit, for margin tracking.">
                <TextInput id="price-provider" inputMode="decimal" value={form.providerCost} onChange={event => setForm(current => ({ ...current, providerCost: event.target.value }))} placeholder="0.35" />
              </Field>
            </div>
            <Field label="Effective from (optional)" htmlFor="price-effective" hint="Leave blank to publish immediately. A future time closes the current version at that time.">
              <TextInput id="price-effective" type="datetime-local" value={form.effectiveFrom} onChange={event => setForm(current => ({ ...current, effectiveFrom: event.target.value }))} />
            </Field>
            <Button type="submit" loading={busy}><Tags className="h-4 w-4" /> Publish price</Button>
          </form>
        </Panel>
        <Panel title="Price book" description="All versions, newest effective first. Active means today falls inside the effective window." action={<Button size="sm" variant="ghost" onClick={() => void pricing.reload()}>Refresh</Button>} bodyClassName="p-0">
          {pricing.loading && !pricing.data ? <Loading label="Loading price versions…" /> : pricing.data?.length ? (
            <div className="table-wrap border-0">
              <table className="data-table">
                <thead><tr><th>Route</th><th>Customer</th><th>Provider</th><th>Window</th><th>Status</th></tr></thead>
                <tbody>
                  {pricing.data.map(price => {
                    const active = new Date(price.effectiveFrom).getTime() <= now && (!price.effectiveTo || new Date(price.effectiveTo).getTime() > now);
                    const future = new Date(price.effectiveFrom).getTime() > now;
                    return (
                      <tr key={price.id}>
                        <td><p className="text-xs font-semibold text-ink">{price.channel === 'sms' ? 'SMS' : 'WhatsApp'} · {titleCase(price.category)}</p><p className="mt-0.5 text-[11px] text-muted">{price.country} · {price.route}</p></td>
                        <td className="font-semibold text-ink">{formatMinor(price.customerUnitMinor)}</td>
                        <td className="text-xs text-muted">{price.providerCostMinor !== null ? formatMinor(price.providerCostMinor) : '—'}{price.providerCostCurrency ? ` ${price.providerCostCurrency}` : ''}</td>
                        <td className="text-[11px] text-muted">{formatDate(price.effectiveFrom)}<br />to {price.effectiveTo ? formatDate(price.effectiveTo) : 'open'}</td>
                        <td>{active ? <Badge tone="success">Active</Badge> : future ? <Badge tone="info">Scheduled</Badge> : <Badge tone="neutral">Ended</Badge>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <div className="p-5"><EmptyState icon={CalendarClock} title="No prices published" description="Sending is blocked until a price exists for the channel, country, route and category." /></div>}
        </Panel>
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Callout tone="warning" title="Pricing is a financial control">Prices are versioned, not edited in place. Verify Meta’s current per-message pricing and Africa’s Talking commercial terms before publishing. A stale or missing service price blocks those sends.</Callout>
        <Callout tone="info" title="Margin fields">Provider cost and currency are optional records for operators. They do not change what the customer is charged. Platform revenue is derived from balanced ledger entries, not from subtracting floats.</Callout>
      </div>
    </>
  );
}
