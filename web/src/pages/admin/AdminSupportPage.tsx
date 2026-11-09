import { useState } from 'react';
import { CheckCircle2, LifeBuoy, Mail, RefreshCw } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatDate } from '../../lib/format';
import type { AdminSupport } from '../../lib/types';
import { useToast } from '../../context/ToastContext';
import {
  Badge, Button, Callout, EmptyState, Loading, Modal, PageHeader, Select, StatusBadge,
} from '../../components/ui';

export function AdminSupportPage() {
  usePageTitle('Support queue');
  const { toast } = useToast();
  const [status, setStatus] = useState('open');
  const query = new URLSearchParams(status ? { status } : {});
  const requests = useApi<AdminSupport[]>(`/admin/support?${query.toString()}`);
  const [selected, setSelected] = useState<AdminSupport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function open(request: AdminSupport) {
    setSelected(request); setError(null);
  }
  async function resolve() {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      await api(`/admin/support/${selected.id}/resolve`, { method: 'POST' });
      setSelected(null); await requests.reload();
      toast('Support request marked resolved.', 'success');
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  return (
    <>
      <PageHeader eyebrow="Customer operations" title="Support queue"
        description="Requests submitted from the public support page and the developer dashboard. Reply to the requester by email outside DevRelay, then mark the request resolved here."
        actions={<Button variant="secondary" onClick={() => void requests.reload()}><RefreshCw className="h-4 w-4" /> Refresh</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select aria-label="Filter support status" value={status} onChange={event => setStatus(event.target.value)} className="w-auto min-w-[160px]">
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
        </Select>
        <Badge tone="neutral">{requests.data?.length ?? 0} request{requests.data?.length === 1 ? '' : 's'}</Badge>
      </div>
      <Callout tone="info" title="Support access is audited">
        This page shows the message body as submitted. Do not copy secrets, one-time codes or card details into replies. Replying marks nothing as sent — the email channel is external to this application.
      </Callout>
      <div className="mt-6">
        {requests.loading && !requests.data ? <Loading label="Loading support requests…" /> : requests.error ? (
          <Callout tone="danger" title="Could not load support queue">{requests.error}</Callout>
        ) : requests.data?.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Business</th><th>Requester</th><th>Subject</th><th>Status</th><th>Received</th><th></th></tr></thead>
              <tbody>
                {requests.data.map(request => (
                  <tr key={request.id}>
                    <td>
                      <p className="text-sm font-medium text-ink">{request.businessName ?? 'Public request'}</p>
                      <p className="font-mono text-[10px] text-muted">{request.accountId ? `${request.accountId.slice(0, 8)}…` : 'no account'}</p>
                    </td>
                    <td className="break-all text-xs text-muted">{request.email}</td>
                    <td>
                      <p className="max-w-[280px] truncate text-sm font-medium text-ink" title={request.subject}>{request.subject}</p>
                      <p className="mt-0.5 max-w-[280px] truncate text-[11px] text-muted" title={request.body}>{request.body}</p>
                    </td>
                    <td><StatusBadge status={request.status} /></td>
                    <td className="text-xs text-muted">{formatDate(request.createdAt)}</td>
                    <td><Button size="sm" variant="secondary" onClick={() => open(request)}>Open</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="surface-card p-6">
            <EmptyState icon={LifeBuoy} title={status === 'open' ? 'The queue is clear' : 'No requests match'}
              description={status === 'open' ? 'New support requests will appear here. This empty state reflects the current filter, not a simulated queue.' : 'Change the status filter to see other requests.'} />
          </div>
        )}
      </div>
      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.subject ?? 'Support request'}
        description={selected ? `${selected.businessName ?? 'Public request'} · ${selected.email} · ${formatDate(selected.createdAt)}` : undefined}
        footer={<><Button variant="secondary" onClick={() => setSelected(null)}>Close</Button>{selected && selected.status !== 'resolved' ? (
          <Button loading={busy} onClick={() => void resolve()}><CheckCircle2 className="h-4 w-4" /> Mark resolved</Button>
        ) : null}</>}>
        {selected ? (
          <div className="space-y-4">
            {error ? <Callout tone="danger">{error}</Callout> : null}
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={selected.status} />
              <Badge tone="neutral">ID {selected.id.slice(0, 8)}</Badge>
              {selected.accountId ? <Badge tone="info">Linked account</Badge> : <Badge tone="warning">No account</Badge>}
            </div>
            <div className="whitespace-pre-wrap rounded-xl border border-line bg-elevated/40 p-4 text-sm leading-6 text-ink">{selected.body}</div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <Mail className="h-3.5 w-3.5" />
              <a href={`mailto:${selected.email}?subject=${encodeURIComponent(`Re: ${selected.subject}`)}`} className="link break-all">{selected.email}</a>
            </div>
            {selected.status === 'resolved' ? <Callout tone="success" title="Resolved">This request is closed. Opening it again would require a change in the database; create a new request if the issue recurs.</Callout> : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
