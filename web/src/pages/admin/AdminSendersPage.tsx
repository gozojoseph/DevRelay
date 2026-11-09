import { useState, type FormEvent } from 'react';
import { BadgeCheck, ExternalLink } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatDate } from '../../lib/format';
import type { AdminSender } from '../../lib/types';
import { useToast } from '../../context/ToastContext';
import {
  Button, Callout, EmptyState, Field, Loading, Modal, PageHeader, Select, StatusBadge, TextArea, TextInput,
} from '../../components/ui';

export function AdminSendersPage() {
  usePageTitle('Sender review');
  const { toast } = useToast();
  const [status, setStatus] = useState('pending');
  const senders = useApi<AdminSender[]>(`/admin/senders?${new URLSearchParams(status ? { status } : {}).toString()}`);
  const [reviewing, setReviewing] = useState<AdminSender | null>(null);
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved');
  const [providerReference, setProviderReference] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function open(sender: AdminSender) {
    setReviewing(sender); setDecision('approved'); setProviderReference(sender.providerReference ?? ''); setRejectionReason(''); setError(null);
  }
  async function review(event: FormEvent) {
    event.preventDefault();
    if (!reviewing) return;
    setBusy(true); setError(null);
    try {
      await api(`/admin/senders/${reviewing.id}/review`, { method: 'POST', body: { decision,
        ...(decision === 'approved' ? { providerReference: providerReference.trim() } : { rejectionReason: rejectionReason.trim() }) } });
      setReviewing(null); await senders.reload();
      toast(decision === 'approved' ? 'Sender approved.' : 'Sender rejected.', 'success');
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  return (
    <>
      <PageHeader eyebrow="SMS" title="Sender ID review"
        description="Approve only after verifying the sender ID is registered with the upstream provider. Record the provider reference as evidence; reject with a clear reason the customer can act on." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select aria-label="Filter sender status" value={status} onChange={event => setStatus(event.target.value)} className="w-auto min-w-[160px]">
          <option value="">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
        </Select>
        <Button variant="ghost" size="sm" onClick={() => void senders.reload()}>Refresh</Button>
      </div>
      {senders.loading && !senders.data ? <Loading label="Loading sender requests…" /> : senders.error ? <Callout tone="danger" title="Could not load senders">{senders.error}</Callout> : senders.data?.length ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Sender</th><th>Business</th><th>Website</th><th>Status</th><th>Provider ref</th><th>Submitted</th><th></th></tr></thead>
            <tbody>
              {senders.data.map(sender => (
                <tr key={sender.id}>
                  <td><p className="font-mono text-xs font-semibold text-ink">{sender.senderId}</p><p className="mt-1 max-w-[260px] truncate text-[11px] text-muted" title={sender.sampleMessage}>{sender.sampleMessage}</p></td>
                  <td><p className="text-sm text-ink">{sender.businessName}</p><p className="text-[11px] text-muted">{sender.contactEmail}</p></td>
                  <td><a href={sender.website} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1 text-xs">Visit <ExternalLink className="h-3 w-3" /></a></td>
                  <td><StatusBadge status={sender.status} /></td>
                  <td className="font-mono text-[11px] text-muted">{sender.providerReference ?? '—'}</td>
                  <td className="text-xs text-muted">{formatDate(sender.createdAt)}</td>
                  <td><Button size="sm" variant="secondary" onClick={() => open(sender)}>Review</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="surface-card p-6"><EmptyState icon={BadgeCheck} title="No sender requests" description="Requests appear after a developer submits a sender ID for approval." /></div>}
      <Modal open={Boolean(reviewing)} onClose={() => setReviewing(null)} title={`Review ${reviewing?.senderId ?? 'sender'}`}
        description="This decision is recorded in the audit log. The provider reference or rejection reason is mandatory."
        footer={<><Button variant="secondary" onClick={() => setReviewing(null)}>Cancel</Button><Button type="submit" form="review-sender-form" variant={decision === 'rejected' ? 'danger' : 'primary'} loading={busy}>{decision === 'approved' ? 'Approve sender' : 'Reject sender'}</Button></>}>
        {reviewing ? (
          <form id="review-sender-form" onSubmit={review} className="space-y-4">
            {error ? <Callout tone="danger">{error}</Callout> : null}
            <div className="rounded-xl border border-line bg-elevated/40 p-4 text-sm">
              <p className="text-xs text-muted">Business</p><p className="mt-0.5 font-semibold text-ink">{reviewing.brand}</p>
              <p className="mt-2 text-xs text-muted">Sample message</p><p className="mt-0.5 text-sm leading-6 text-ink">{reviewing.sampleMessage}</p>
              <p className="mt-2 text-xs text-muted">Requested by</p><p className="text-sm text-ink">{reviewing.contactEmail} · <a href={reviewing.website} target="_blank" rel="noreferrer" className="link">website</a></p>
              {reviewing.providerDetails ? <><p className="mt-2 text-xs text-muted">Provider details supplied</p><p className="text-sm text-ink">{reviewing.providerDetails}</p></> : null}
            </div>
            <div className="flex gap-2">
              {(['approved', 'rejected'] as const).map(value => (
                <button key={value} type="button" onClick={() => setDecision(value)}
                  className={`flex-1 rounded-xl border px-3 py-2 text-sm font-semibold ${decision === value ? (value === 'approved' ? 'border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-300' : 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300') : 'border-line bg-surface text-muted'}`}>{value === 'approved' ? 'Approve' : 'Reject'}</button>
              ))}
            </div>
            {decision === 'approved' ? (
              <Field label="Provider reference" htmlFor="provider-reference" required hint="Evidence from Africa’s Talking that this sender is registered.">
                <TextInput id="provider-reference" required minLength={3} maxLength={200} value={providerReference} onChange={event => setProviderReference(event.target.value)} placeholder="AT sender approval reference" />
              </Field>
            ) : (
              <Field label="Rejection reason" htmlFor="rejection-reason" required hint="At least 5 characters. Be specific and actionable.">
                <TextArea id="rejection-reason" required minLength={5} maxLength={500} rows={3} value={rejectionReason} onChange={event => setRejectionReason(event.target.value)} placeholder="Sender is not registered to this business with the provider." />
              </Field>
            )}
            <Callout tone="warning">Provider registration must happen outside DevRelay. Do not approve based only on the customer’s claim.</Callout>
          </form>
        ) : null}
      </Modal>
    </>
  );
}
