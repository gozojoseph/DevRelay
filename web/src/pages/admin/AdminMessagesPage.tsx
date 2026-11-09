import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, RefreshCw } from 'lucide-react';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatDate, formatMinor } from '../../lib/format';
import type { AdminMessage, Channel } from '../../lib/types';
import {
  Badge, Button, Callout, EmptyState, Loading, PageHeader, Select, StatusBadge,
} from '../../components/ui';

const statuses = ['queued', 'sending', 'accepted', 'sent', 'delivered', 'read', 'failed', 'pending_reconciliation', 'reconciled'];

export function AdminMessagesPage() {
  usePageTitle('All messages');
  const [channel, setChannel] = useState<Channel | ''>('');
  const [status, setStatus] = useState('');
  const query = new URLSearchParams({ limit: '200' });
  if (channel) query.set('channel', channel);
  if (status) query.set('status', status);
  const messages = useApi<AdminMessage[]>(`/admin/messages?${query.toString()}`);
  return (
    <>
      <PageHeader eyebrow="Operations" title="Messages"
        description="Cross-tenant outbound and inbound view for support and incident response. Use reconciliation for reserved charges with failed or uncertain status."
        actions={<><Link to="/admin/reconciliation" className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">Open reconciliation</Link><Button variant="secondary" onClick={() => void messages.reload()}><RefreshCw className="h-4 w-4" /> Refresh</Button></>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select aria-label="Filter by channel" value={channel} onChange={event => setChannel(event.target.value as Channel | '')} className="w-auto min-w-[140px]">
          <option value="">All channels</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option>
        </Select>
        <Select aria-label="Filter by status" value={status} onChange={event => setStatus(event.target.value)} className="w-auto min-w-[180px]">
          <option value="">All statuses</option>
          {statuses.map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
        </Select>
        {(channel || status) ? <Button variant="ghost" size="sm" onClick={() => { setChannel(''); setStatus(''); }}>Clear</Button> : null}
      </div>
      {messages.loading && !messages.data ? <Loading label="Loading messages…" /> : messages.error ? <Callout tone="danger" title="Could not load messages">{messages.error}</Callout> : messages.data?.length ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Business</th><th>Recipient</th><th>Channel</th><th>Status</th><th>Reservation</th><th>Quoted</th><th>Charged</th><th>Provider ID</th><th>Created</th></tr></thead>
            <tbody>
              {messages.data.map(message => (
                <tr key={message.id}>
                  <td><p className="text-sm font-medium text-ink">{message.businessName}</p><p className="font-mono text-[10px] text-muted">{message.accountId.slice(0, 8)}…</p></td>
                  <td className="text-muted">{message.recipient}</td>
                  <td><Badge tone="neutral">{message.channel === 'sms' ? 'SMS' : 'WhatsApp'}</Badge></td>
                  <td><StatusBadge status={message.status} /></td>
                  <td><StatusBadge status={message.reservationStatus} /></td>
                  <td className="text-muted">{formatMinor(message.quotedMinor)}</td>
                  <td className="text-muted">{message.chargedMinor ? formatMinor(message.chargedMinor) : '—'}</td>
                  <td className="max-w-[130px] truncate font-mono text-[11px] text-muted" title={message.providerMessageId ?? ''}>{message.providerMessageId ?? '—'}</td>
                  <td className="text-xs text-muted">{formatDate(message.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="surface-card p-6"><EmptyState icon={MessageSquare} title="No messages match" description="Clear the filters. Messages appear after accounts send through the API or an inbound WhatsApp event arrives." /></div>}
      <p className="mt-4 text-xs text-muted">Showing up to 200 messages. Message content is intentionally not displayed in the cross-tenant view; use a support request with explicit customer authorisation before revealing content.</p>
    </>
  );
}
