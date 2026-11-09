import { useState, type FormEvent } from 'react';
import { FileClock, RefreshCw, Search } from 'lucide-react';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatDate } from '../../lib/format';
import type { AuditEvent } from '../../lib/types';
import {
  Badge, Button, Callout, EmptyState, Field, Loading, Modal, PageHeader, Select, TextInput,
} from '../../components/ui';

const actions: Record<string, string> = {
  'account.approved': 'info',
  'account.suspended': 'danger',
  'sender.approved': 'success',
  'sender.rejected': 'danger',
  'pricing.published': 'info',
  'message.reconciled': 'warning',
  'support.resolved': 'success',
  'settings.updated': 'info',
  'whatsapp.activated': 'success',
  'whatsapp.suspended': 'danger',
  'whatsapp.reactivated': 'success',
};

export function AdminAuditPage() {
  usePageTitle('Audit log');
  const [accountInput, setAccountInput] = useState('');
  const [accountId, setAccountId] = useState('');
  const [limit, setLimit] = useState('200');
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const query = new URLSearchParams({ limit });
  if (accountId) query.set('accountId', accountId);
  const events = useApi<AuditEvent[]>(`/admin/audit?${query.toString()}`);
  function filter(event: FormEvent) {
    event.preventDefault();
    setAccountId(accountInput.trim());
  }
  return (
    <>
      <PageHeader eyebrow="Governance" title="Audit log"
        description="Append-only record of administrative and security-relevant actions. Entries are written by the server; this page is read-only and cannot edit or delete history."
        actions={<Button variant="secondary" onClick={() => void events.reload()}><RefreshCw className="h-4 w-4" /> Refresh</Button>} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <form onSubmit={filter} className="flex flex-1 gap-2 sm:max-w-md">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <TextInput aria-label="Filter by account ID" className="pl-9 font-mono text-xs" value={accountInput}
              onChange={event => setAccountInput(event.target.value)} placeholder="Account UUID (optional)" />
          </div>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>
        <Field label="Rows" htmlFor="audit-limit">
          <Select id="audit-limit" value={limit} onChange={event => setLimit(event.target.value)} className="w-auto min-w-[110px]">
            <option value="100">100</option><option value="200">200</option><option value="500">500</option>
          </Select>
        </Field>
        {accountId ? <Button variant="ghost" size="sm" onClick={() => { setAccountId(''); setAccountInput(''); }}>Clear account filter</Button> : null}
      </div>
      <Callout tone="info" title="What is recorded">
        Approvals, suspensions, sender decisions, price publication, reconciliation, settings changes, WhatsApp activation and support resolution. Authentication events such as sign-in and MFA changes are recorded separately by the auth routes.
      </Callout>
      <div className="mt-6">
        {events.loading && !events.data ? <Loading label="Loading audit events…" /> : events.error ? (
          <Callout tone="danger" title="Could not load audit log">{events.error}</Callout>
        ) : events.data?.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Action</th><th>Actor</th><th>Account</th><th>Target</th><th>When</th><th></th></tr></thead>
              <tbody>
                {events.data.map(event => (
                  <tr key={event.id}>
                    <td>
                      <Badge tone={(actions[event.action] as 'success' | 'warning' | 'danger' | 'info' | undefined) ?? 'neutral'}>{event.action}</Badge>
                    </td>
                    <td className="font-mono text-[11px] text-muted">{event.actorUserId ? `${event.actorUserId.slice(0, 8)}…` : 'system'}</td>
                    <td className="font-mono text-[11px] text-muted">{event.accountId ? `${event.accountId.slice(0, 8)}…` : '—'}</td>
                    <td className="text-xs text-muted">{event.targetType ?? '—'}{event.targetId ? <span className="ml-1 font-mono text-[10px]">{event.targetId.slice(0, 8)}…</span> : null}</td>
                    <td className="text-xs text-muted">{formatDate(event.createdAt)}</td>
                    <td>{Object.keys(event.details ?? {}).length ? <Button size="sm" variant="ghost" onClick={() => setSelected(event)}>Details</Button> : <span className="text-[11px] text-muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="surface-card p-6">
            <EmptyState icon={FileClock} title="No audit events" description="Administrative actions will appear here. An empty log on a new installation is expected; it is not evidence of activity." />
          </div>
        )}
      </div>
      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.action ?? 'Audit event'}
        description={selected ? `${formatDate(selected.createdAt)} · event ${selected.id}` : undefined}
        footer={<Button variant="secondary" onClick={() => setSelected(null)}>Close</Button>}>
        {selected ? (
          <div className="space-y-4">
            <dl className="grid gap-3 text-xs sm:grid-cols-2">
              <div><dt className="text-muted">Actor user ID</dt><dd className="mt-0.5 break-all font-mono text-ink">{selected.actorUserId ?? 'system'}</dd></div>
              <div><dt className="text-muted">Account ID</dt><dd className="mt-0.5 break-all font-mono text-ink">{selected.accountId ?? '—'}</dd></div>
              <div><dt className="text-muted">Target type</dt><dd className="mt-0.5 text-ink">{selected.targetType ?? '—'}</dd></div>
              <div><dt className="text-muted">Target ID</dt><dd className="mt-0.5 break-all font-mono text-ink">{selected.targetId ?? '—'}</dd></div>
            </dl>
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted">Details</p>
              <pre className="max-h-80 overflow-auto rounded-xl border border-line bg-elevated/50 p-4 text-[11px] leading-5 text-ink">{JSON.stringify(selected.details ?? {}, null, 2)}</pre>
            </div>
            <Callout tone="warning">Details may contain operator notes. Treat this data as confidential and do not expose it outside the support case being investigated.</Callout>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
