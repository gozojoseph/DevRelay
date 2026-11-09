import { Activity, CircleDollarSign, MessageCircle, Smartphone } from 'lucide-react';
import { useApi, usePageTitle } from '../../lib/hooks';
import type { PublicConfig } from '../../lib/types';
import { Badge, Callout, Loading, PageHeader, Panel, StatusBadge } from '../../components/ui';

interface PublicStatus {
  channels: { sms: boolean; whatsapp: boolean; funding: boolean };
  whatsappMode: 'production' | 'test' | 'unavailable';
  note: string;
}

const items = [
  { key: 'sms' as const, label: 'SMS delivery', icon: Smartphone, detail: 'Africa’s Talking credentials, callback token and production mode' },
  { key: 'whatsapp' as const, label: 'WhatsApp', icon: MessageCircle, detail: 'Meta app, Embedded Signup config and webhook verification' },
  { key: 'funding' as const, label: 'Paystack funding', icon: CircleDollarSign, detail: 'Paystack secret key and a published minimum funding amount' },
];

export function StatusPage() {
  usePageTitle('Service status');
  const status = useApi<PublicStatus>('/public/status');
  const config = useApi<PublicConfig>('/public/config');
  return (
    <div className="container-page py-12 sm:py-16">
      <PageHeader eyebrow="Status" title="Configuration status, stated honestly."
        description="This page reports the server configuration required for each channel. It does not claim live upstream health, and it does not show simulated incidents or uptime." />
      {status.loading ? <Loading label="Checking server configuration…" /> : status.error ? (
        <Callout tone="danger" title="Status unavailable">{status.error}</Callout>
      ) : status.data ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            {items.map(item => {
              const available = status.data!.channels[item.key];
              return (
                <div key={item.key} className="surface-card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10 text-brand-700 dark:text-brand-400"><item.icon className="h-5 w-5" /></span>
                    <StatusBadge status={available ? 'active' : 'disabled'} />
                  </div>
                  <h2 className="mt-4 text-sm font-semibold text-ink">{item.label}</h2>
                  <p className="mt-1 text-xs leading-5 text-muted">{item.detail}</p>
                  <p className="mt-3 text-sm font-medium text-ink">{available ? 'Configured on this server' : 'Not configured'}</p>
                </div>
              );
            })}
          </div>
          <Panel title="Environment details">
            <div className="grid gap-4 text-sm sm:grid-cols-3">
              <div><p className="text-xs text-muted">Environment</p><p className="mt-1 font-semibold text-ink">{config.data?.environment ?? '—'}</p></div>
              <div><p className="text-xs text-muted">WhatsApp mode</p><p className="mt-1 font-semibold text-ink">{status.data.whatsappMode === 'production' ? 'Production approved' : status.data.whatsappMode === 'test' ? 'Test mode' : 'Unavailable'}</p></div>
              <div><p className="text-xs text-muted">Meta Graph version</p><p className="mt-1 font-semibold text-ink">{config.data?.metaGraphVersion ?? '—'}</p></div>
            </div>
            <div className="mt-5 rounded-xl border border-line bg-elevated/50 p-4 text-sm leading-6 text-muted">
              <div className="flex items-start gap-2"><Activity className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /><p>{status.data.note}</p></div>
            </div>
          </Panel>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="surface-card p-4"><p className="text-xs text-muted">Prices published</p><p className="mt-1 text-sm font-semibold text-ink">{config.data ? (config.data.pricingConfigured ? 'Yes' : 'No') : '—'}</p></div>
            <div className="surface-card p-4"><p className="text-xs text-muted">WhatsApp production approved</p><p className="mt-1 text-sm font-semibold text-ink">{config.data ? (config.data.whatsappProductionApproved ? 'Yes' : 'No — test only or unavailable') : '—'}</p></div>
            <div className="surface-card p-4"><p className="text-xs text-muted">Funding enabled</p><p className="mt-1 text-sm font-semibold text-ink">{config.data ? (config.data.fundingAvailable ? 'Yes' : 'No') : '—'}</p></div>
          </div>
          <Callout tone="warning" title="What this page does not measure">
            Upstream provider incidents, carrier filtering, Meta template reviews and delivery quality are not synthetic. Check provider status pages and your dashboard delivery events for live evidence. Configuration can be present while an upstream provider is unavailable.
          </Callout>
          <p className="text-center text-xs text-muted">Last server check: {new Date().toLocaleString('en-GH')} · Response note: <Badge tone="neutral">configuration only</Badge></p>
        </div>
      ) : null}
    </div>
  );
}
