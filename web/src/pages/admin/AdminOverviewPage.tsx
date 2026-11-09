import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, BadgeCheck, Building2, Calculator, CircleDollarSign, LifeBuoy, MessageSquare,
  ShieldCheck,
} from 'lucide-react';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatMinor, titleCase } from '../../lib/format';
import type { AdminOverview } from '../../lib/types';
import { Badge, buttonClass, Callout, Loading, PageHeader, Panel, StatCard, StatusBadge } from '../../components/ui';

export function AdminOverviewPage() {
  usePageTitle('Admin overview');
  const { data, loading, error } = useApi<AdminOverview>('/admin/overview');
  if (loading && !data) return <Loading label="Loading administration overview…" />;
  if (error) return <Callout tone="danger" title="Could not load admin overview">{error}</Callout>;
  if (!data) return null;
  const tasks = [
    { label: 'Pending sender requests', count: data.pendingSenders, to: '/admin/senders', icon: BadgeCheck },
    { label: 'Reserved charges to reconcile', count: data.pendingReconciliation, to: '/admin/reconciliation', icon: Calculator },
    { label: 'Open support requests', count: data.openSupport, to: '/admin/support', icon: LifeBuoy },
    { label: 'Accounts awaiting approval', count: data.accounts.pending_approval ?? 0, to: '/admin/accounts', icon: Building2 },
  ];
  return (
    <>
      <PageHeader eyebrow="Operations" title="Admin overview"
        description="Review accounts, approve sender IDs, publish prices, reconcile uncertain SMS charges and monitor platform revenue. Every mutation is recorded in the audit log." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Platform revenue" value={formatMinor(data.platformRevenueMinor)} hint="Settled ledger balance" icon={CircleDollarSign} />
        <StatCard label="Active accounts" value={(data.accounts.active ?? 0).toLocaleString('en-GH')} hint={`${data.accounts.pending_approval ?? 0} awaiting approval · ${data.accounts.suspended ?? 0} suspended`} icon={Building2} tone="sky" />
        <StatCard label="Messages today" value={Object.values(data.messagesToday).reduce((sum, value) => sum + value, 0).toLocaleString('en-GH')} hint="All tenants, outbound and inbound" icon={MessageSquare} />
        <StatCard label="Pending reconciliation" value={data.pendingReconciliation} hint="Reserved credit with failed or uncertain status" icon={AlertTriangle} tone={data.pendingReconciliation ? 'amber' : 'brand'} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Panel title="Work queue" description="Items that usually need a human decision." bodyClassName="p-0">
          <div className="divide-y divide-line">
            {tasks.map(task => (
              <Link key={task.label} to={task.to} className="flex items-center gap-3 px-5 py-4 transition hover:bg-elevated/60">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/10 text-brand-700 dark:text-brand-400"><task.icon className="h-4 w-4" /></span>
                <span className="flex-1 text-sm font-medium text-ink">{task.label}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${task.count ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' : 'bg-elevated text-muted'}`}>{task.count}</span>
                <ArrowRight className="h-4 w-4 text-muted" />
              </Link>
            ))}
          </div>
        </Panel>
        <div className="space-y-6">
          <Panel title="Accounts by status">
            <div className="space-y-3">
              {['pending_verification', 'pending_approval', 'active', 'suspended'].map(status => (
                <div key={status} className="flex items-center justify-between gap-3 text-sm">
                  <StatusBadge status={status} />
                  <span className="font-semibold text-ink">{data.accounts[status] ?? 0}</span>
                </div>
              ))}
            </div>
            <Link to="/admin/accounts" className={buttonClass('secondary', 'md', 'mt-4 w-full')}>Review accounts <ArrowRight className="h-4 w-4" /></Link>
          </Panel>
          <Panel title="Provider configuration">
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between"><span className="text-muted">SMS</span><StatusBadge status={data.availability.sms ? 'active' : 'disabled'} /></div>
              <div className="flex items-center justify-between"><span className="text-muted">WhatsApp test</span><StatusBadge status={data.availability.whatsappTest ? 'active' : 'disabled'} /></div>
              <div className="flex items-center justify-between"><span className="text-muted">WhatsApp production</span><StatusBadge status={data.availability.whatsappLive ? 'active' : 'disabled'} /></div>
              <div className="flex items-center justify-between"><span className="text-muted">Paystack</span><StatusBadge status={data.availability.paystack ? 'active' : 'disabled'} /></div>
            </div>
            <p className="mt-4 flex items-center gap-1.5 text-xs text-muted"><ShieldCheck className="h-3.5 w-3.5" /> MFA required: {data.mfaRequiredForAdmin ? 'yes' : 'no'}</p>
          </Panel>
        </div>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="surface-card p-4"><p className="text-xs text-muted">Messages today by status</p><div className="mt-2 flex flex-wrap gap-1.5">{Object.entries(data.messagesToday).length ? Object.entries(data.messagesToday).map(([status, count]) => <Badge key={status} tone="neutral">{titleCase(status)} · {count}</Badge>) : <span className="text-sm text-muted">No messages today</span>}</div></div>
        <Link to="/admin/pricing" className="surface-card flex items-center justify-between gap-3 p-4 transition hover:border-brand-300"><span className="text-sm font-semibold text-ink">Publish prices</span><ArrowRight className="h-4 w-4 text-muted" /></Link>
        <Link to="/admin/audit" className="surface-card flex items-center justify-between gap-3 p-4 transition hover:border-brand-300"><span className="text-sm font-semibold text-ink">Inspect audit log</span><ArrowRight className="h-4 w-4 text-muted" /></Link>
      </div>
      <div className="mt-6"><Callout tone="warning" title="Operational caution">Approving a sender or activating WhatsApp means you have verified the external provider evidence. Do not use these controls to simulate readiness.</Callout></div>
    </>
  );
}
