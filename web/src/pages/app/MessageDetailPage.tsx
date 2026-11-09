import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Clock3, Coins, FileText, Radio, RefreshCw } from 'lucide-react';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatDate, formatMinor, titleCase } from '../../lib/format';
import type { MessageDetail } from '../../lib/types';
import { Badge, Button, Callout, CopyButton, Loading, PageHeader, Panel, StatusBadge } from '../../components/ui';

export function MessageDetailPage() {
  usePageTitle('Message detail');
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, reload } = useApi<MessageDetail>(id ? `/app/messages/${id}` : null, [id]);
  if (loading && !data) return <Loading label="Loading message…" />;
  if (error) return <div className="space-y-4"><Link to="/app/messages" className="link inline-flex items-center gap-1 text-xs"><ArrowLeft className="h-3.5 w-3.5" /> Back to messages</Link><Callout tone="danger" title="Could not load message">{error}</Callout></div>;
  if (!data) return null;
  return (
    <>
      <div className="mb-3"><Link to="/app/messages" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" /> Back to messages</Link></div>
      <PageHeader eyebrow={`${data.channel === 'sms' ? 'SMS' : 'WhatsApp'} · ${titleCase(data.direction)}`} title={data.recipient}
        description={<span className="inline-flex flex-wrap items-center gap-2">Current status <StatusBadge status={data.status} /> <span className="text-muted">·</span> <span className="font-mono text-xs">{data.id}</span><CopyButton value={data.id} label="Copy ID" /></span>}
        actions={<Button variant="secondary" onClick={() => void reload()}><RefreshCw className="h-4 w-4" /> Refresh</Button>} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
        <div className="space-y-6">
          <Panel title={<span className="inline-flex items-center gap-2"><FileText className="h-4 w-4 text-brand-600" /> Content</span>} description="Body and template content are decrypted only inside your tenant session.">
            {data.templateName ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-line bg-elevated/40 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="info">Template</Badge>
                    <span className="font-mono text-sm font-semibold text-ink">{data.templateName}</span>
                    <Badge tone="neutral">{data.templateLanguage ?? '—'}</Badge>
                  </div>
                  {data.variables.length ? (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-muted">Variables</p>
                      <div className="mt-2 flex flex-wrap gap-2">{data.variables.map((value, index) => <span key={index} className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink">{`{{${index + 1}}}`} = {value || '—'}</span>)}</div>
                    </div>
                  ) : null}
                </div>
                {data.body ? <p className="whitespace-pre-wrap rounded-xl border border-line bg-surface p-4 text-sm leading-7 text-ink">{data.body}</p> : null}
              </div>
            ) : data.body ? (
              <p className="whitespace-pre-wrap rounded-xl border border-line bg-surface p-4 text-sm leading-7 text-ink">{data.body}</p>
            ) : <p className="text-sm text-muted">No message body was stored for this item.</p>}
            <div className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
              <div><p className="text-muted">Sender</p><p className="mt-0.5 font-medium text-ink">{data.sender}</p></div>
              <div><p className="text-muted">Project</p><p className="mt-0.5 font-medium text-ink">{data.projectName ?? '—'}</p></div>
              <div><p className="text-muted">Segments</p><p className="mt-0.5 font-medium text-ink">{data.segments ?? '—'}</p></div>
            </div>
          </Panel>
          <Panel title={<span className="inline-flex items-center gap-2"><Radio className="h-4 w-4 text-brand-600" /> Provider event timeline</span>} description="Recorded in arrival order. Provider events can be delayed, duplicated or out of order; status application is monotonic where required.">
            {data.events.length ? (
              <ol className="relative space-y-5 border-l border-line pl-5">
                {data.events.map((event, index) => (
                  <li key={`${event.status}-${index}`} className="relative">
                    <span className="absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full border-2 border-surface bg-brand-500" />
                    <div className="flex flex-wrap items-center gap-2"><StatusBadge status={event.status} /><span className="text-xs text-muted">{formatDate(event.occurredAt ?? event.createdAt)}</span></div>
                    {Object.keys(event.details ?? {}).length ? <pre className="mt-2 overflow-x-auto rounded-lg bg-elevated/60 p-2 text-[11px] leading-5 text-muted">{JSON.stringify(event.details, null, 2)}</pre> : null}
                  </li>
                ))}
              </ol>
            ) : <p className="text-sm text-muted">No provider events recorded yet. A queued message is not delivered until evidence arrives.</p>}
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title={<span className="inline-flex items-center gap-2"><Coins className="h-4 w-4 text-brand-600" /> Billing</span>}>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted">Quoted</dt><dd className="font-semibold text-ink">{formatMinor(data.quotedMinor)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Charged</dt><dd className="font-semibold text-ink">{data.chargedMinor ? formatMinor(data.chargedMinor) : '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Reservation</dt><dd><StatusBadge status={data.reservationStatus} /></dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Currency</dt><dd className="text-ink">{data.currency}</dd></div>
              {data.providerPricingType ? <div className="flex justify-between gap-3"><dt className="text-muted">Provider pricing</dt><dd className="text-right text-xs text-ink">{data.providerPricingType}{data.providerPricingCategory ? ` · ${data.providerPricingCategory}` : ''}</dd></div> : null}
            </dl>
            <div className="mt-4 border-t border-line pt-3 text-xs leading-5 text-muted">Reserved credit stays unavailable until delivery evidence settles the charge. Uncertain outcomes are reconciled by an operator, not guessed.</div>
          </Panel>
          <Panel title={<span className="inline-flex items-center gap-2"><Clock3 className="h-4 w-4 text-brand-600" /> Timestamps</span>}>
            <dl className="space-y-3 text-xs">
              <div><dt className="text-muted">Created</dt><dd className="mt-0.5 text-ink">{formatDate(data.createdAt)}</dd></div>
              <div><dt className="text-muted">Accepted</dt><dd className="mt-0.5 text-ink">{formatDate(data.acceptedAt)}</dd></div>
              <div><dt className="text-muted">Last provider event</dt><dd className="mt-0.5 text-ink">{formatDate(data.lastProviderAt)}</dd></div>
              {data.errorCode ? <div><dt className="text-muted">Error code</dt><dd className="mt-0.5 font-mono text-rose-600 dark:text-rose-400">{data.errorCode}</dd></div> : null}
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}
