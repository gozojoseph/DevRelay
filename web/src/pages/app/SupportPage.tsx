import { useState, type FormEvent } from 'react';
import { LifeBuoy, Plus } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatDate } from '../../lib/format';
import { useToast } from '../../context/ToastContext';
import {
  Badge, Button, Callout, EmptyState, Field, Loading, PageHeader, Panel, StatusBadge, TextArea, TextInput,
} from '../../components/ui';

interface Ticket { id: string; subject: string; body: string; status: string; createdAt: string; updatedAt: string }

export function DeveloperSupportPage() {
  usePageTitle('Support');
  const { toast } = useToast();
  const tickets = useApi<Ticket[]>('/app/support');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      await api('/app/support', { method: 'POST', body: { subject: subject.trim(), body: body.trim() } });
      setSubject(''); setBody(''); await tickets.reload();
      toast('Support request recorded.', 'success');
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  return (
    <>
      <PageHeader eyebrow="Help" title="Support"
        description="Requests are linked to your account and visible to the operations team. Include message IDs or payment references where relevant. Never include passwords, one-time codes or full API keys." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
        <Panel title={<span className="inline-flex items-center gap-2"><LifeBuoy className="h-4 w-4 text-brand-600" /> New request</span>} description="A human reviews the queue; this is not a live chat or an automated delivery guarantee.">
          {error ? <div className="mb-4"><Callout tone="danger">{error}</Callout></div> : null}
          <form onSubmit={submit} className="space-y-4">
            <Field label="Subject" htmlFor="ticket-subject" required>
              <TextInput id="ticket-subject" required minLength={3} maxLength={160} value={subject} onChange={event => setSubject(event.target.value)} placeholder="Payment not credited" />
            </Field>
            <Field label="Details" htmlFor="ticket-body" required hint="At least 10 characters. Describe the expected and actual outcome.">
              <TextArea id="ticket-body" required minLength={10} maxLength={4000} rows={7} value={body} onChange={event => setBody(event.target.value)} placeholder="Payment reference, time, and what the dashboard currently shows." />
            </Field>
            <Button type="submit" loading={busy}><Plus className="h-4 w-4" /> Submit request</Button>
          </form>
        </Panel>
        <Panel title="Your requests" description="Newest first." action={<Button size="sm" variant="ghost" onClick={() => void tickets.reload()}>Refresh</Button>} bodyClassName="p-0">
          {tickets.loading && !tickets.data ? <Loading label="Loading support requests…" /> : tickets.data?.length ? (
            <div className="divide-y divide-line">
              {tickets.data.map(ticket => (
                <div key={ticket.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div><p className="text-sm font-semibold text-ink">{ticket.subject}</p><p className="mt-0.5 text-xs text-muted">Opened {formatDate(ticket.createdAt)}</p></div>
                    <StatusBadge status={ticket.status} />
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted">{ticket.body}</p>
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-muted"><Badge tone="neutral">ID {ticket.id.slice(0, 8)}</Badge> Updated {formatDate(ticket.updatedAt)}</div>
                </div>
              ))}
            </div>
          ) : <div className="p-5"><EmptyState icon={LifeBuoy} title="No support requests" description="Create a request if onboarding, reconciliation or provider setup is blocking you." /></div>}
        </Panel>
      </div>
    </>
  );
}
