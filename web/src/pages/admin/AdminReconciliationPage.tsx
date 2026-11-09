import { useState, type FormEvent } from 'react';
import { Calculator, RefreshCw } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatDate, formatMinor } from '../../lib/format';
import type { ReconciliationItem } from '../../lib/types';
import { useToast } from '../../context/ToastContext';
import {
  Badge, Button, Callout, EmptyState, Field, Loading, Modal, PageHeader, StatusBadge, TextArea,
} from '../../components/ui';

export function AdminReconciliationPage() {
  usePageTitle('Reconciliation');
  const { toast } = useToast();
  const items = useApi<ReconciliationItem[]>('/admin/reconciliation');
  const [selected, setSelected] = useState<ReconciliationItem | null>(null);
  const [action, setAction] = useState<'charge' | 'release'>('release');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function open(item: ReconciliationItem) {
    setSelected(item); setAction('release'); setReason(''); setError(null);
  }
  async function resolve(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      await api(`/admin/messages/${selected.id}/reconcile`, { method: 'POST', body: { action, reason: reason.trim() } });
      setSelected(null); await items.reload();
      toast(action === 'charge' ? 'Reservation charged.' : 'Reservation released.', 'success');
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  return (
    <>
      <PageHeader eyebrow="Finance" title="Reconciliation"
        description="Reserved credit with a failed or uncertain SMS outcome. Resolve only from provider evidence: charge when the provider billed it, release when it definitively did not deliver and was not billed."
        actions={<Button variant="secondary" onClick={() => void items.reload()}><RefreshCw className="h-4 w-4" /> Refresh</Button>} />
      <Callout tone="warning" title="Do not guess">
        A timeout or an ambiguous provider response is not proof of failure. Check the upstream dashboard or support channel first. Reconciliation decisions are audited and change the customer’s available balance.
      </Callout>
      <div className="mt-6">
        {items.loading && !items.data ? <Loading label="Loading reconciliation queue…" /> : items.error ? <Callout tone="danger" title="Could not load queue">{items.error}</Callout> : items.data?.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Business</th><th>Recipient</th><th>Channel</th><th>Status</th><th>Quoted</th><th>Error</th><th>Created</th><th></th></tr></thead>
              <tbody>
                {items.data.map(item => (
                  <tr key={item.id}>
                    <td><p className="text-sm font-medium text-ink">{item.businessName}</p><p className="font-mono text-[10px] text-muted">{item.id.slice(0, 8)}…</p></td>
                    <td className="text-muted">{item.recipient}</td>
                    <td><Badge tone="neutral">{item.channel === 'sms' ? 'SMS' : 'WhatsApp'}</Badge></td>
                    <td><StatusBadge status={item.status} /></td>
                    <td className="font-medium text-ink">{formatMinor(item.quotedMinor)}</td>
                    <td className="max-w-[180px] truncate font-mono text-[11px] text-muted" title={item.errorCode ?? ''}>{item.errorCode ?? '—'}</td>
                    <td className="text-xs text-muted">{formatDate(item.createdAt)}</td>
                    <td><Button size="sm" variant="secondary" onClick={() => open(item)}>Resolve</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="surface-card p-6"><EmptyState icon={Calculator} title="Nothing to reconcile" description="Reserved charges only appear when a message is failed or uncertain but its credit reservation remains. This is a good empty state." /></div>}
      </div>
      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="Resolve reservation" description={`${selected?.businessName ?? ''} · ${selected ? formatMinor(selected.quotedMinor) : ''} · message ${selected?.id.slice(0, 8) ?? ''}…`}
        footer={<><Button variant="secondary" onClick={() => setSelected(null)}>Cancel</Button><Button type="submit" form="reconcile-form" variant={action === 'charge' ? 'primary' : 'danger'} loading={busy}>{action === 'charge' ? 'Charge customer' : 'Release credit'}</Button></>}>
        {selected ? (
          <form id="reconcile-form" onSubmit={resolve} className="space-y-4">
            {error ? <Callout tone="danger">{error}</Callout> : null}
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => setAction('release')}
                className={`rounded-xl border p-3 text-left ${action === 'release' ? 'border-brand-300 bg-brand-50 dark:border-brand-500/40 dark:bg-brand-500/10' : 'border-line bg-surface'}`}>
                <p className="text-sm font-semibold text-ink">Release credit</p>
                <p className="mt-1 text-xs leading-5 text-muted">Provider definitively did not deliver and did not bill. Reserved credit returns to available.</p>
              </button>
              <button type="button" onClick={() => setAction('charge')}
                className={`rounded-xl border p-3 text-left ${action === 'charge' ? 'border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10' : 'border-line bg-surface'}`}>
                <p className="text-sm font-semibold text-ink">Charge customer</p>
                <p className="mt-1 text-xs leading-5 text-muted">Provider billed the message even though final delivery failed. Capture the reason.</p>
              </button>
            </div>
            <div className="rounded-xl border border-line bg-elevated/40 p-3 text-xs leading-5 text-muted">
              Current reservation: <StatusBadge status={selected.reservationStatus} /> · status <StatusBadge status={selected.status} /> · error <span className="font-mono text-ink">{selected.errorCode ?? 'none'}</span>
            </div>
            <Field label="Evidence and reason" htmlFor="reconcile-reason" required hint="At least 10 characters. Include the upstream reference or support ticket.">
              <TextArea id="reconcile-reason" required minLength={10} maxLength={500} rows={4} value={reason} onChange={event => setReason(event.target.value)} placeholder="Africa’s Talking dashboard shows no billing and delivery failed with code …" />
            </Field>
            <Callout tone="info">This action is irreversible through the dashboard and is recorded in the audit log. The ledger remains balanced.</Callout>
          </form>
        ) : null}
      </Modal>
    </>
  );
}
