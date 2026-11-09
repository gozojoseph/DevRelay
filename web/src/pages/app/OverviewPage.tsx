import { Link } from 'react-router-dom';
import {
  ArrowRight, BadgeCheck, CheckCircle2, Circle, FolderKanban, MessageSquare, Plus, Send, Wallet, Webhook,
} from 'lucide-react';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatDate, formatMinor } from '../../lib/format';
import type { Overview } from '../../lib/types';
import { Badge, buttonClass, Callout, EmptyState, Loading, PageHeader, Panel, StatCard, StatusBadge } from '../../components/ui';

export function OverviewPage() {
  usePageTitle('Overview');
  const { data, loading, error } = useApi<Overview>('/app/overview');
  if (loading && !data) return <Loading label="Loading your workspace…" />;
  if (error) return <Callout tone="danger" title="Could not load overview">{error}</Callout>;
  if (!data) return null;
  const wallet = data.wallet;
  const checklist = [
    { label: 'Business account approved', done: data.account.status === 'active', to: '/app/settings' },
    { label: 'Create a project', done: data.projectCount > 0, to: '/app/projects' },
    { label: 'Get an SMS sender ID approved', done: data.approvedSenderCount > 0, to: '/app/senders' },
    { label: 'Add a signed webhook endpoint', done: data.activeWebhookCount > 0, to: '/app/webhooks' },
    { label: 'Fund your wallet', done: wallet.availableMinor > 0 || wallet.reservedMinor > 0, to: '/app/wallet' },
  ];
  return (
    <>
      <PageHeader eyebrow="Workspace" title={`Good to see you, ${data.account.businessName}.`}
        description="Send prepaid messages, inspect delivery evidence and monitor your balance. Statuses here come from recorded provider events — never simulated."
        actions={<>
          <Link to="/app/send" className={buttonClass('primary', 'md')}><Send className="h-4 w-4" /> Send message</Link>
          <Link to="/app/wallet" className={buttonClass('secondary', 'md')}><Plus className="h-4 w-4" /> Add credit</Link>
        </>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Available credit" value={formatMinor(wallet.availableMinor)} hint="Prepaid GHS balance" icon={Wallet} />
        <StatCard label="Reserved credit" value={formatMinor(wallet.reservedMinor)} hint="Queued or unresolved messages" icon={Circle} tone="amber" />
        <StatCard label="Messages today" value={data.today.messages.toLocaleString('en-GH')} hint="Outbound messages recorded today" icon={MessageSquare} tone="sky" />
        <StatCard label="Approved senders" value={data.approvedSenderCount} hint={`${data.projectCount} project${data.projectCount === 1 ? '' : 's'} · ${data.activeWebhookCount} active webhook${data.activeWebhookCount === 1 ? '' : 's'}`} icon={BadgeCheck} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel title="Recent messages" description="The newest outbound messages across your projects."
          action={<Link to="/app/messages" className="link text-xs">View all</Link>} bodyClassName="p-0">
          {data.recent.length ? (
            <div className="table-wrap border-0">
              <table className="data-table">
                <thead><tr><th>Recipient</th><th>Channel</th><th>Status</th><th>Quoted</th><th>Created</th></tr></thead>
                <tbody>
                  {data.recent.map(message => (
                    <tr key={message.id}>
                      <td><Link to={`/app/messages/${message.id}`} className="font-medium text-ink hover:underline">{message.recipient}</Link></td>
                      <td><Badge tone="neutral">{message.channel === 'sms' ? 'SMS' : 'WhatsApp'}</Badge></td>
                      <td><StatusBadge status={message.status} /></td>
                      <td className="text-muted">{formatMinor(message.quotedMinor)}</td>
                      <td className="text-muted">{formatDate(message.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-5"><EmptyState icon={MessageSquare} title="No messages yet" description="Accepted messages and their provider events will appear here. You need approval, consent and credit before the first send."
              action={<Link to="/app/send" className={buttonClass('secondary', 'md')}>Prepare a message</Link>} /></div>
          )}
        </Panel>
        <div className="space-y-6">
          <Panel title="Getting ready" description="These checks reflect your tenant data.">
            <ul className="space-y-3">
              {checklist.map(item => (
                <li key={item.label}>
                  <Link to={item.to} className="flex items-center gap-2.5 text-sm text-muted hover:text-ink">
                    {item.done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-600" /> : <Circle className="h-4 w-4 shrink-0 text-line" />}
                    <span className={item.done ? 'line-through decoration-line' : ''}>{item.label}</span>
                    {!item.done ? <ArrowRight className="ml-auto h-3.5 w-3.5" /> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Channel configuration" description="From the server’s current environment.">
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-2 text-muted"><Send className="h-4 w-4" /> SMS</span><StatusBadge status={data.availability.sms ? 'active' : 'disabled'} /></div>
              <div className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-2 text-muted"><MessageSquare className="h-4 w-4" /> WhatsApp</span><StatusBadge status={data.availability.whatsappLive ? 'active' : data.availability.whatsappTest ? 'pending' : 'disabled'} /></div>
              <div className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-2 text-muted"><Wallet className="h-4 w-4" /> Paystack funding</span><StatusBadge status={data.availability.paystack ? 'active' : 'disabled'} /></div>
            </div>
            <p className="mt-4 text-xs leading-5 text-muted">Configuration is not the same as live provider health. If a channel is unavailable, the send endpoint returns a configuration error instead of simulating success.</p>
          </Panel>
        </div>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Link to="/app/send" className="surface-card group flex items-center justify-between gap-3 p-4 transition hover:border-brand-300">
          <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/10 text-brand-700 dark:text-brand-400"><Send className="h-4 w-4" /></span><div><p className="text-sm font-semibold text-ink">Send a message</p><p className="text-xs text-muted">SMS or WhatsApp template</p></div></div>
          <ArrowRight className="h-4 w-4 text-muted transition group-hover:translate-x-0.5" />
        </Link>
        <Link to="/app/projects" className="surface-card group flex items-center justify-between gap-3 p-4 transition hover:border-brand-300">
          <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/10 text-brand-700 dark:text-brand-400"><FolderKanban className="h-4 w-4" /></span><div><p className="text-sm font-semibold text-ink">Manage projects</p><p className="text-xs text-muted">Keys, limits and scopes</p></div></div>
          <ArrowRight className="h-4 w-4 text-muted transition group-hover:translate-x-0.5" />
        </Link>
        <Link to="/app/webhooks" className="surface-card group flex items-center justify-between gap-3 p-4 transition hover:border-brand-300">
          <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/10 text-brand-700 dark:text-brand-400"><Webhook className="h-4 w-4" /></span><div><p className="text-sm font-semibold text-ink">Webhook deliveries</p><p className="text-xs text-muted">Signed events and attempts</p></div></div>
          <ArrowRight className="h-4 w-4 text-muted transition group-hover:translate-x-0.5" />
        </Link>
      </div>
    </>
  );
}
