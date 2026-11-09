import { useState, type FormEvent } from 'react';
import { ContactRound, Plus, ShieldOff, UserCheck } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatDate } from '../../lib/format';
import type { Channel, ConsentRecord, Suppression } from '../../lib/types';
import { useToast } from '../../context/ToastContext';
import {
  Badge, Button, Callout, EmptyState, Field, Loading, PageHeader, Panel, Select, Tabs, TextArea, TextInput,
} from '../../components/ui';

export function ContactsPage() {
  usePageTitle('Consent & opt-outs');
  const { toast } = useToast();
  const [tab, setTab] = useState<'consent' | 'suppression'>('consent');
  const consents = useApi<ConsentRecord[]>('/app/consents');
  const suppressions = useApi<Suppression[]>('/app/suppressions');
  const [channel, setChannel] = useState<Channel>('sms');
  const [recipient, setRecipient] = useState('');
  const [source, setSource] = useState('');
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [suppressChannel, setSuppressChannel] = useState<Channel>('sms');
  const [suppressRecipient, setSuppressRecipient] = useState('');
  const [reason, setReason] = useState('');
  const [suppressBusy, setSuppressBusy] = useState(false);
  const [suppressError, setSuppressError] = useState<string | null>(null);
  async function recordConsent(event: FormEvent) {
    event.preventDefault();
    setConsentBusy(true); setConsentError(null);
    try {
      await api('/app/consents', { method: 'POST', body: { channel, recipient, source } });
      setRecipient(''); setSource('');
      await consents.reload(); await suppressions.reload();
      toast('Consent recorded.', 'success');
    } catch (cause) { setConsentError(errorMessage(cause)); } finally { setConsentBusy(false); }
  }
  async function suppress(event: FormEvent) {
    event.preventDefault();
    setSuppressBusy(true); setSuppressError(null);
    try {
      await api('/app/suppressions', { method: 'POST', body: { channel: suppressChannel, recipient: suppressRecipient, reason } });
      setSuppressRecipient(''); setReason('');
      await consents.reload(); await suppressions.reload();
      toast('Recipient suppressed. Existing consent was revoked.', 'success');
    } catch (cause) { setSuppressError(errorMessage(cause)); } finally { setSuppressBusy(false); }
  }
  return (
    <>
      <PageHeader eyebrow="Compliance" title="Consent & opt-outs"
        description="Outbound messages require a current consent record per channel and recipient. Suppression always wins: a suppressed recipient cannot receive a message until support reviews new evidence." />
      <div className="mb-5"><Tabs value={tab} onChange={setTab} items={[
        { value: 'consent', label: 'Consent records', count: consents.data?.length },
        { value: 'suppression', label: 'Suppressions', count: suppressions.data?.length },
      ]} /></div>
      {tab === 'consent' ? (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <Panel title={<span className="inline-flex items-center gap-2"><UserCheck className="h-4 w-4 text-brand-600" /> Record consent</span>} description="Record where and when the recipient agreed. Be specific; this evidence matters during disputes or audits.">
              {consentError ? <div className="mb-4"><Callout tone="danger">{consentError}</Callout></div> : null}
              <form onSubmit={recordConsent} className="space-y-4">
                <Field label="Channel" htmlFor="consent-channel" required>
                  <Select id="consent-channel" value={channel} onChange={event => setChannel(event.target.value as Channel)}>
                    <option value="sms">SMS</option><option value="whatsapp">WhatsApp</option>
                  </Select>
                </Field>
                <Field label="Recipient number" htmlFor="consent-recipient" required hint="Use international format, e.g. +233201234567.">
                  <TextInput id="consent-recipient" type="tel" required minLength={8} maxLength={24} value={recipient} onChange={event => setRecipient(event.target.value)} placeholder="+233201234567" />
                </Field>
                <Field label="Consent source" htmlFor="consent-source" required hint="At least 8 characters. Example: “Checkout SMS opt-in checkbox, order #1042”.">
                  <TextArea id="consent-source" required minLength={8} maxLength={180} rows={3} value={source} onChange={event => setSource(event.target.value)} placeholder="How and when did this recipient agree?" />
                </Field>
                <Button type="submit" loading={consentBusy}><Plus className="h-4 w-4" /> Record consent</Button>
              </form>
            </Panel>
            <Panel title={<span className="inline-flex items-center gap-2"><ContactRound className="h-4 w-4 text-brand-600" /> Current consent</span>} description="Newest first. A consent record is invalid while revoked." action={<Button size="sm" variant="ghost" onClick={() => void consents.reload()}>Refresh</Button>} bodyClassName="p-0">
              {consents.loading && !consents.data ? <Loading label="Loading consent records…" /> : consents.data?.length ? (
                <div className="table-wrap border-0">
                  <table className="data-table">
                    <thead><tr><th>Recipient</th><th>Channel</th><th>Source</th><th>Consented</th><th>Status</th></tr></thead>
                    <tbody>
                      {consents.data.map(record => (
                        <tr key={record.id}>
                          <td className="font-medium text-ink">{record.recipient}</td>
                          <td><Badge tone="neutral">{record.channel === 'sms' ? 'SMS' : 'WhatsApp'}</Badge></td>
                          <td className="max-w-[240px] truncate text-muted" title={record.source}>{record.source}</td>
                          <td className="text-xs text-muted">{formatDate(record.consentedAt)}</td>
                          <td>{record.revokedAt ? <Badge tone="danger">Revoked</Badge> : <Badge tone="success">Active</Badge>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="p-5"><EmptyState icon={ContactRound} title="No consent records" description="Record consent before attempting your first send. Sends without an active consent record are rejected." /></div>}
            </Panel>
          </div>
          <Callout tone="info" title="Consent is not a one-time checkbox">Keep evidence of how consent was collected, honour opt-outs immediately and do not reuse consent from another business or channel. SMS consent does not imply WhatsApp consent.</Callout>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <Panel title={<span className="inline-flex items-center gap-2"><ShieldOff className="h-4 w-4 text-rose-500" /> Suppress a recipient</span>} description="This adds the number to the suppression list and revokes any matching consent. It is enforced before every send.">
              {suppressError ? <div className="mb-4"><Callout tone="danger">{suppressError}</Callout></div> : null}
              <form onSubmit={suppress} className="space-y-4">
                <Field label="Channel" htmlFor="suppress-channel" required>
                  <Select id="suppress-channel" value={suppressChannel} onChange={event => setSuppressChannel(event.target.value as Channel)}>
                    <option value="sms">SMS</option><option value="whatsapp">WhatsApp</option>
                  </Select>
                </Field>
                <Field label="Recipient number" htmlFor="suppress-recipient" required>
                  <TextInput id="suppress-recipient" type="tel" required minLength={8} maxLength={24} value={suppressRecipient} onChange={event => setSuppressRecipient(event.target.value)} placeholder="+233201234567" />
                </Field>
                <Field label="Reason" htmlFor="suppress-reason" required hint="Record the opt-out request or compliance reason. Minimum 3 characters.">
                  <TextInput id="suppress-reason" required minLength={3} maxLength={80} value={reason} onChange={event => setReason(event.target.value)} placeholder="Recipient replied STOP" />
                </Field>
                <Button type="submit" variant="danger" loading={suppressBusy}><ShieldOff className="h-4 w-4" /> Suppress recipient</Button>
              </form>
            </Panel>
            <Panel title="Suppression list" description="Suppression is permanent from the dashboard. Re-enabling requires support review of new consent evidence." action={<Button size="sm" variant="ghost" onClick={() => void suppressions.reload()}>Refresh</Button>} bodyClassName="p-0">
              {suppressions.loading && !suppressions.data ? <Loading label="Loading suppressions…" /> : suppressions.data?.length ? (
                <div className="table-wrap border-0">
                  <table className="data-table">
                    <thead><tr><th>Recipient</th><th>Channel</th><th>Reason</th><th>Added</th></tr></thead>
                    <tbody>
                      {suppressions.data.map(item => (
                        <tr key={item.id}>
                          <td className="font-medium text-ink">{item.recipient}</td>
                          <td><Badge tone="danger">{item.channel === 'sms' ? 'SMS' : 'WhatsApp'}</Badge></td>
                          <td className="text-muted">{item.reason}</td>
                          <td className="text-xs text-muted">{formatDate(item.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="p-5"><EmptyState icon={ShieldOff} title="No suppressions" description="Opt-outs and manually suppressed numbers will appear here." /></div>}
            </Panel>
          </div>
          <Callout tone="warning" title="Do not work around a suppression">Creating a new consent record for a suppressed number is rejected by the API. If a recipient genuinely re-consents, contact support with evidence; do not change the number to evade the block.</Callout>
        </div>
      )}
    </>
  );
}
