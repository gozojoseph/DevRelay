import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  CircleDollarSign, KeyRound, LockKeyhole, ServerCog, ShieldCheck, SlidersHorizontal,
} from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatDate, formatMinor, minorToGhs, parseGhsToMinor } from '../../lib/format';
import type { PlatformSettings, PublicConfig } from '../../lib/types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
  Badge, Button, Callout, Field, Loading, PageHeader, Panel, StatusBadge, TextInput,
} from '../../components/ui';

export function AdminSettingsPage() {
  usePageTitle('Platform settings');
  const { me } = useAuth();
  const { toast } = useToast();
  const settings = useApi<PlatformSettings>('/admin/settings');
  const config = useApi<PublicConfig>('/public/config');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (settings.data) setAmount(settings.data.minimumFundingMinor === null ? '' : minorToGhs(settings.data.minimumFundingMinor));
  }, [settings.data]);
  async function save(event: FormEvent) {
    event.preventDefault();
    const minor = amount.trim() ? parseGhsToMinor(amount) : 0;
    if (minor === null) { setError('Enter a valid GHS amount with at most two decimal places.'); return; }
    setBusy(true); setError(null);
    try {
      const saved = await api<PlatformSettings>('/admin/settings', { method: 'PATCH', body: { minimumFundingMinor: minor } });
      settings.setData(saved);
      toast('Platform settings saved.', 'success');
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  if (settings.loading && !settings.data) return <Loading label="Loading platform settings…" />;
  if (settings.error) return <Callout tone="danger" title="Could not load settings">{settings.error}</Callout>;
  const flags = me?.availability;
  return (
    <>
      <PageHeader eyebrow="Administration" title="Platform settings"
        description="Non-secret platform controls. Provider credentials, webhook secrets and encryption keys are environment variables and are never editable or readable from this console." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="space-y-6">
          <Panel title={<span className="inline-flex items-center gap-2"><CircleDollarSign className="h-4 w-4 text-brand-600" /> Funding configuration</span>}
            description="The minimum accepted Paystack top-up. Funding stays unavailable until both Paystack and this amount are configured.">
            {error ? <div className="mb-4"><Callout tone="danger">{error}</Callout></div> : null}
            <form onSubmit={save} className="space-y-4">
              <Field label="Minimum funding amount (GHS)" htmlFor="minimum-funding" required
                hint="Stored as integer pesewas. Enter 0 to disable the funding minimum and, as a result, disable Paystack funding availability.">
                <TextInput id="minimum-funding" inputMode="decimal" required value={amount} onChange={event => setAmount(event.target.value)} placeholder="10.00" />
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" loading={busy}><SlidersHorizontal className="h-4 w-4" /> Save funding setting</Button>
                <span className="text-xs text-muted">
                  Last updated {settings.data ? formatDate(settings.data.updatedAt) : '—'}
                </span>
              </div>
            </form>
            <div className="mt-5 rounded-xl border border-line bg-elevated/40 p-4">
              <p className="text-xs font-medium text-muted">Current effective value</p>
              <p className="mt-1 text-lg font-semibold text-ink">
                {settings.data?.minimumFundingMinor ? formatMinor(settings.data.minimumFundingMinor) : 'Not configured'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusBadge status={flags?.paystack ? 'active' : 'disabled'} />
                <span className="self-center text-xs text-muted">Paystack {flags?.paystack ? 'configured' : 'not configured'}</span>
                <StatusBadge status={config.data?.fundingAvailable ? 'active' : 'disabled'} />
                <span className="self-center text-xs text-muted">Funding {config.data?.fundingAvailable ? 'publicly available' : 'unavailable'}</span>
              </div>
            </div>
          </Panel>
          <Panel title={<span className="inline-flex items-center gap-2"><ServerCog className="h-4 w-4 text-brand-600" /> Runtime configuration</span>}
            description="Read-only values reported by the server. Change these through environment variables and redeploy; there is no browser control for secrets.">
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted">Environment</dt><dd className="mt-1"><Badge tone={config.data?.environment === 'production' ? 'warning' : 'neutral'}>{config.data?.environment ?? '—'}</Badge></dd></div>
              <div><dt className="text-xs text-muted">Public API URL</dt><dd className="mt-1 break-all font-mono text-[11px] text-ink">{config.data?.publicApiUrl ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted">Support email</dt><dd className="mt-1 break-all text-ink">{config.data?.supportEmail ?? 'Not configured'}</dd></div>
              <div><dt className="text-xs text-muted">Meta Graph version</dt><dd className="mt-1 font-mono text-xs text-ink">{config.data?.metaGraphVersion ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted">SMS provider</dt><dd className="mt-1"><StatusBadge status={flags?.sms ? 'active' : 'disabled'} /></dd></div>
              <div><dt className="text-xs text-muted">WhatsApp</dt><dd className="mt-1"><StatusBadge status={flags?.whatsappLive ? 'active' : flags?.whatsappTest ? 'pending' : 'disabled'} /></dd></div>
            </dl>
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title={<span className="inline-flex items-center gap-2"><LockKeyhole className="h-4 w-4 text-brand-600" /> Secrets and provider setup</span>}
            description="These values must be provisioned outside the application.">
            <ul className="space-y-3 text-sm leading-6 text-muted">
              <li className="flex gap-2"><KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> Paystack secret key and webhook secrets.</li>
              <li className="flex gap-2"><KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> Africa’s Talking username, API key, sender approvals and callback token.</li>
              <li className="flex gap-2"><KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> Meta app ID, app secret, Embedded Signup configuration and webhook verification token.</li>
              <li className="flex gap-2"><KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> Session secret, 32-byte encryption key and SMTP credentials.</li>
            </ul>
            <Callout tone="warning" title="No fake provider mode in production">
              Test API keys and mock provider behavior are refused in production. If a provider is not configured, sending and funding fail honestly rather than simulating success.
            </Callout>
          </Panel>
          <Panel title={<span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-brand-600" /> Administrator security</span>}>
            <div className="space-y-3 text-sm leading-6 text-muted">
              <p className="flex items-center justify-between gap-3"><span>Multi-factor authentication</span><Badge tone={me?.user.mfaEnabled ? 'success' : 'warning'}>{me?.user.mfaEnabled ? 'Enabled' : 'Required'}</Badge></p>
              <p className="flex items-center justify-between gap-3"><span>Signed-in identity</span><span className="break-all text-xs text-ink">{me?.user.email}</span></p>
              <p className="flex items-center justify-between gap-3"><span>Session lifetime</span><span className="text-xs text-ink">7 days, HTTP-only</span></p>
              <p className="flex items-center justify-between gap-3"><span>CSRF protection</span><Badge tone="success">Enforced</Badge></p>
            </div>
            <p className="mt-4 text-xs leading-5 text-muted">Admin actions are written to the append-only audit log. <Link to="/admin/audit" className="link">Open audit log</Link>.</p>
          </Panel>
          <Callout tone="info" title="Operational documentation">
            Provider setup, deployment, backups and launch prerequisites are documented in the repository under <code className="rounded bg-elevated px-1">docs/</code>. Complete those external steps before enabling production traffic.
          </Callout>
        </div>
      </div>
    </>
  );
}
