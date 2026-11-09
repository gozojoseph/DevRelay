import { useState, type FormEvent } from 'react';
import { BadgeCheck, Plus } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatDate } from '../../lib/format';
import type { SenderRequest } from '../../lib/types';
import { useToast } from '../../context/ToastContext';
import {
  Badge, Button, Callout, EmptyState, Field, Loading, PageHeader, Panel, StatusBadge, TextArea, TextInput,
} from '../../components/ui';

export function SendersPage() {
  usePageTitle('Sender IDs');
  const { toast } = useToast();
  const senders = useApi<SenderRequest[]>('/app/senders');
  const [senderId, setSenderId] = useState('');
  const [brand, setBrand] = useState('');
  const [website, setWebsite] = useState('');
  const [sampleMessage, setSampleMessage] = useState('');
  const [providerDetails, setProviderDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      await api('/app/senders', { method: 'POST', body: { senderId: senderId.trim(), brand: brand.trim(),
        website: website.trim(), sampleMessage: sampleMessage.trim(),
        ...(providerDetails.trim() ? { providerDetails: providerDetails.trim() } : {}) } });
      setSenderId(''); setBrand(''); setWebsite(''); setSampleMessage(''); setProviderDetails('');
      await senders.reload();
      toast('Sender ID request submitted for review.', 'success');
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  return (
    <>
      <PageHeader eyebrow="SMS" title="Sender IDs"
        description="Every SMS must use a sender ID approved for your account. The operator registers the sender with Africa’s Talking and records the provider reference before approval." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
        <Panel title={<span className="inline-flex items-center gap-2"><BadgeCheck className="h-4 w-4 text-brand-600" /> Request a sender ID</span>} description="Use a brand you own or are authorised to represent. Misrepresentation can lead to suspension.">
          {error ? <div className="mb-4"><Callout tone="danger">{error}</Callout></div> : null}
          <form onSubmit={submit} className="space-y-4">
            <Field label="Sender ID" htmlFor="sender-id" required hint="3–11 letters or digits, no spaces. Example: DEVRELAY.">
              <TextInput id="sender-id" required minLength={3} maxLength={11} pattern="[A-Za-z0-9]{3,11}" value={senderId} onChange={event => setSenderId(event.target.value)} placeholder="YOURBRAND" />
            </Field>
            <Field label="Brand or organisation" htmlFor="sender-brand" required hint="The legal or trading name recipients will recognise.">
              <TextInput id="sender-brand" required minLength={2} maxLength={160} value={brand} onChange={event => setBrand(event.target.value)} />
            </Field>
            <Field label="Website" htmlFor="sender-website" required hint="Must start with https://. The site should show the brand and a way to contact you.">
              <TextInput id="sender-website" type="url" required value={website} onChange={event => setWebsite(event.target.value)} placeholder="https://example.com" />
            </Field>
            <Field label="Sample message" htmlFor="sender-sample" required hint="10–500 characters. A real example of planned traffic, not a password or promo code.">
              <TextArea id="sender-sample" required minLength={10} maxLength={500} rows={4} value={sampleMessage} onChange={event => setSampleMessage(event.target.value)} placeholder="Your order is ready for pickup at the Accra branch." />
            </Field>
            <Field label="Provider details (optional)" htmlFor="sender-provider" hint="If Africa’s Talking already gave you a sender registration reference, include it.">
              <TextInput id="sender-provider" maxLength={1000} value={providerDetails} onChange={event => setProviderDetails(event.target.value)} />
            </Field>
            <Button type="submit" loading={busy}><Plus className="h-4 w-4" /> Submit request</Button>
          </form>
        </Panel>
        <Panel title="Your requests" description="Status reflects operator review, not an automated provider check." action={<Button size="sm" variant="ghost" onClick={() => void senders.reload()}>Refresh</Button>} bodyClassName="p-0">
          {senders.loading && !senders.data ? <Loading label="Loading sender requests…" /> : senders.data?.length ? (
            <div className="divide-y divide-line">
              {senders.data.map(sender => (
                <div key={sender.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-sm font-semibold text-ink">{sender.senderId}</p>
                      <p className="mt-0.5 text-xs text-muted">{sender.brand} · submitted {formatDate(sender.createdAt)}</p>
                    </div>
                    <StatusBadge status={sender.status} />
                  </div>
                  <p className="mt-2 rounded-lg bg-elevated/50 px-3 py-2 text-xs leading-5 text-muted">{sender.sampleMessage}</p>
                  {sender.providerReference ? <p className="mt-2 text-xs text-muted">Provider reference: <span className="font-mono text-ink">{sender.providerReference}</span></p> : null}
                  {sender.rejectionReason ? <p className="mt-2 text-xs leading-5 text-rose-600 dark:text-rose-400">Rejected: {sender.rejectionReason}</p> : null}
                  {sender.status === 'pending' ? <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><Badge tone="info">Pending</Badge> An administrator must verify registration with the provider.</p> : null}
                </div>
              ))}
            </div>
          ) : <div className="p-5"><EmptyState icon={BadgeCheck} title="No sender requests" description="Request a sender ID before attempting to send SMS. Each sender must be approved separately." /></div>}
        </Panel>
      </div>
      <div className="mt-6"><Callout tone="info" title="What approval means">Admin approval confirms the sender is registered with the upstream provider and appropriate for your stated use. It does not guarantee delivery; carrier filtering and recipient consent still apply.</Callout></div>
    </>
  );
}
