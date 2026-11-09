import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Filter, MessageSquare, RefreshCw } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatDate, formatMinor } from '../../lib/format';
import type { Channel, MessageListItem } from '../../lib/types';
import {
  Badge, Button, Callout, EmptyState, Loading, PageHeader, Select, StatusBadge,
} from '../../components/ui';

interface MessagePage { items: MessageListItem[]; nextCursor: string | null }

const statuses = ['queued', 'sending', 'accepted', 'sent', 'delivered', 'read', 'failed', 'pending_reconciliation', 'reconciled'];

export function MessagesPage() {
  usePageTitle('Messages');
  const [channel, setChannel] = useState<Channel | ''>('');
  const [status, setStatus] = useState('');
  const [extra, setExtra] = useState<MessageListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const query = new URLSearchParams({ limit: '50' });
  if (channel) query.set('channel', channel);
  if (status) query.set('status', status);
  const path = `/app/messages?${query.toString()}`;
  const { data, loading, error, reload } = useApi<MessagePage>(path);
  useEffect(() => {
    setExtra([]); setCursor(data?.nextCursor ?? null); setMoreError(null);
  }, [data]);
  const items = [...(data?.items ?? []), ...extra];
  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true); setMoreError(null);
    try {
      const next = new URLSearchParams(query);
      next.set('cursor', cursor);
      const page = await api<MessagePage>(`/app/messages?${next.toString()}`);
      setExtra(current => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch (cause) { setMoreError(errorMessage(cause)); } finally { setLoadingMore(false); }
  }
  return (
    <>
      <PageHeader eyebrow="Delivery history" title="Messages"
        description="Outbound messages across your projects, newest first. Queued and accepted are not delivery. Open a message to inspect its provider event timeline and reservation state."
        actions={<Button variant="secondary" onClick={() => void reload()}><RefreshCw className="h-4 w-4" /> Refresh</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted"><Filter className="h-3.5 w-3.5" /> Filters</span>
        <Select aria-label="Filter by channel" value={channel} onChange={event => setChannel(event.target.value as Channel | '')} className="w-auto min-w-[120px] py-1.5 text-xs">
          <option value="">All channels</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option>
        </Select>
        <Select aria-label="Filter by status" value={status} onChange={event => setStatus(event.target.value)} className="w-auto min-w-[160px] py-1.5 text-xs">
          <option value="">All statuses</option>
          {statuses.map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
        </Select>
        {channel || status ? <Button variant="ghost" size="sm" onClick={() => { setChannel(''); setStatus(''); }}>Clear</Button> : null}
      </div>
      {error ? <Callout tone="danger" title="Could not load messages">{error}</Callout> : loading && !data ? <Loading label="Loading messages…" /> : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Recipient</th><th>Project</th><th>Channel</th><th>Status</th><th>Segments</th><th>Quoted</th><th>Charged</th><th>Created</th><th></th></tr></thead>
              <tbody>
                {items.map(message => (
                  <tr key={message.id}>
                    <td className="font-medium text-ink">{message.recipient}</td>
                    <td className="text-muted">{message.projectName ?? '—'}</td>
                    <td><Badge tone="neutral">{message.channel === 'sms' ? 'SMS' : 'WhatsApp'}</Badge></td>
                    <td><StatusBadge status={message.status} /></td>
                    <td className="text-muted">{message.segments ?? '—'}</td>
                    <td className="text-muted">{formatMinor(message.quotedMinor)}</td>
                    <td className="text-muted">{message.chargedMinor ? formatMinor(message.chargedMinor) : '—'}</td>
                    <td className="text-muted">{formatDate(message.createdAt)}</td>
                    <td><Link to={`/app/messages/${message.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 dark:text-brand-300">Open <ChevronRight className="h-3.5 w-3.5" /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!items.length ? (
              <div className="p-6"><EmptyState icon={MessageSquare} title="No messages match these filters" description="Change the filters, or send your first message once your account, sender and consent are ready." /></div>
            ) : null}
          </div>
          {moreError ? <div className="mt-3"><Callout tone="danger">{moreError}</Callout></div> : null}
          {cursor ? <div className="mt-4 flex justify-center"><Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>Load more</Button></div> : null}
          {!cursor && items.length > 0 ? <p className="mt-4 text-center text-xs text-muted">End of history.</p> : null}
        </>
      )}
    </>
  );
}
