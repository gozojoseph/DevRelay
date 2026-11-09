import { useState } from 'react';
import { MessageCircle, RefreshCw, ShieldCheck, ShieldOff } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatDate } from '../../lib/format';
import type { AdminWhatsappConnection } from '../../lib/types';
import { useToast } from '../../context/ToastContext';
import {
  Badge, Button, Callout, EmptyState, Loading, Modal, PageHeader, StatusBadge,
} from '../../components/ui';

type Action = { connection: AdminWhatsappConnection; type: 'activate' | 'suspend' | 'reactivate' };

export function AdminWhatsappPage() {
  usePageTitle('WhatsApp operations');
  const { toast } = useToast();
  const connections = useApi<AdminWhatsappConnection[]>('/admin/whatsapp');
  const [action, setAction] = useState<Action | null>(null);
  const [billingConfirmed, setBillingConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function open(connection: AdminWhatsappConnection, type: Action['type']) {
    setAction({ connection, type }); setBillingConfirmed(false); setError(null);
  }
  async function confirm() {
    if (!action) return;
    setBusy(true); setError(null);
    try {
      if (action.type === 'activate') {
        await api(`/admin/whatsapp/${action.connection.id}/activate`, { method: 'POST', body: { billingConfirmed: true } });
        toast('Connection activated and billing confirmation recorded.', 'success');
      } else if (action.type === 'suspend') {
        await api(`/admin/whatsapp/${action.connection.id}/suspend`, { method: 'POST' });
        toast('Connection suspended.', 'success');
      } else {
        await api(`/admin/whatsapp/${action.connection.id}/reactivate`, { method: 'POST' });
        toast('Connection reactivated.', 'success');
      }
      setAction(null); await connections.reload();
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  return (
    <>
      <PageHeader eyebrow="Channel operations" title="WhatsApp connections"
        description="Review cross-tenant Meta connections. Activation records an explicit billing confirmation; suspension blocks sending without deleting the connection."
        actions={<Button variant="secondary" onClick={() => void connections.reload()}><RefreshCw className="h-4 w-4" /> Refresh</Button>} />
      <Callout tone="warning" title="Activation is an attestation">
        Confirm that Meta billing is configured for this business before activating. Activation makes numbers available to the send endpoint. Suspension is for policy, billing or quality incidents, not for testing template sync.
      </Callout>
      <div className="mt-6">
        {connections.loading && !connections.data ? <Loading label="Loading WhatsApp connections…" /> : connections.error ? <Callout tone="danger" title="Could not load connections">{connections.error}</Callout> : connections.data?.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Business</th><th>WABA</th><th>Status</th><th>Token expiry</th><th>Connected</th><th>Last error</th><th></th></tr></thead>
              <tbody>
                {connections.data.map(connection => (
                  <tr key={connection.id}>
                    <td><p className="text-sm font-medium text-ink">{connection.businessName}</p><p className="text-[11px] text-muted">{connection.contactEmail}</p></td>
                    <td className="font-mono text-xs text-muted">{connection.wabaId}</td>
                    <td><StatusBadge status={connection.status} /></td>
                    <td className="text-xs text-muted">{connection.tokenExpiresAt ? formatDate(connection.tokenExpiresAt) : 'Not reported'}</td>
                    <td className="text-xs text-muted">{formatDate(connection.createdAt)}</td>
                    <td className="max-w-[220px] truncate text-[11px] text-rose-600 dark:text-rose-400" title={connection.lastError ?? ''}>{connection.lastError ?? '—'}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        {connection.status === 'pending_activation' ? <Button size="sm" onClick={() => open(connection, 'activate')}><ShieldCheck className="h-3.5 w-3.5" /> Activate</Button> : null}
                        {connection.status === 'active' ? <Button size="sm" variant="danger" onClick={() => open(connection, 'suspend')}><ShieldOff className="h-3.5 w-3.5" /> Suspend</Button> : null}
                        {connection.status === 'suspended' ? <Button size="sm" variant="secondary" onClick={() => open(connection, 'reactivate')}><ShieldCheck className="h-3.5 w-3.5" /> Reactivate</Button> : null}
                        {!['pending_activation', 'active', 'suspended'].includes(connection.status) ? <Badge tone="neutral">No action</Badge> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="surface-card p-6"><EmptyState icon={MessageCircle} title="No WhatsApp connections" description="Connections appear after an approved developer completes Meta Embedded Signup." /></div>}
      </div>
      <Modal open={Boolean(action)} onClose={() => setAction(null)} title={action?.type === 'activate' ? 'Activate WhatsApp connection' : action?.type === 'suspend' ? 'Suspend WhatsApp connection' : 'Reactivate WhatsApp connection'}
        description={action ? `${action.connection.businessName} · WABA ${action.connection.wabaId}` : undefined}
        footer={<><Button variant="secondary" onClick={() => setAction(null)}>Cancel</Button><Button variant={action?.type === 'suspend' ? 'danger' : 'primary'} loading={busy} onClick={() => void confirm()} disabled={action?.type === 'activate' && !billingConfirmed}>{action?.type === 'suspend' ? 'Suspend' : action?.type === 'activate' ? 'Activate' : 'Reactivate'}</Button></>}>
        {error ? <div className="mb-4"><Callout tone="danger">{error}</Callout></div> : null}
        {action?.type === 'activate' ? (
          <div className="space-y-4">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface p-4 text-sm">
              <input type="checkbox" checked={billingConfirmed} onChange={event => setBillingConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500" />
              <span><span className="font-semibold text-ink">I confirm Meta billing is configured for this business.</span><span className="mt-1 block text-xs leading-5 text-muted">This records the billing confirmation time on the numbers and allows sending. Do not confirm based on an assumption.</span></span>
            </label>
            <Callout tone="info">Meta charges the business directly per delivered message. DevRelay charges the customer from its configured price book; the two are separate.</Callout>
          </div>
        ) : action?.type === 'suspend' ? (
          <Callout tone="warning" title="Sending stops immediately">The connection and its numbers become suspended. Existing messages may still receive provider status events. Reactivation requires an existing billing confirmation.</Callout>
        ) : (
          <p className="text-sm leading-6 text-muted">Reactivation requires a previous billing confirmation on at least one number. If billing evidence is no longer valid, leave the connection suspended and investigate first.</p>
        )}
      </Modal>
    </>
  );
}
