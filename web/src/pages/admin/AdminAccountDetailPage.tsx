import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, BadgeCheck, Building2, CreditCard, FolderKanban, ShieldAlert, ShieldCheck, Users,
} from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatDate, formatMinor } from '../../lib/format';
import type { AdminAccountDetail } from '../../lib/types';
import { useToast } from '../../context/ToastContext';
import {
  Badge, Button, Callout, Field, Loading, Modal, PageHeader, Panel, StatusBadge, TextArea,
} from '../../components/ui';

export function AdminAccountDetailPage() {
  usePageTitle('Account detail');
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const detail = useApi<AdminAccountDetail>(id ? `/admin/accounts/${id}` : null, [id]);
  const [approveOpen, setApproveOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  async function approve(event: FormEvent) {
    event.preventDefault();
    if (!id) return;
    setBusy(true); setActionError(null);
    try {
      await api(`/admin/accounts/${id}/approve`, { method: 'POST', body: { ...(note.trim() ? { note: note.trim() } : {}) } });
      setApproveOpen(false); setNote(''); await detail.reload();
      toast('Account approved.', 'success');
    } catch (cause) { setActionError(errorMessage(cause)); } finally { setBusy(false); }
  }
  async function suspend(event: FormEvent) {
    event.preventDefault();
    if (!id) return;
    setBusy(true); setActionError(null);
    try {
      await api(`/admin/accounts/${id}/suspend`, { method: 'POST', body: { reason: reason.trim() } });
      setSuspendOpen(false); setReason(''); await detail.reload();
      toast('Account suspended.', 'success');
    } catch (cause) { setActionError(errorMessage(cause)); } finally { setBusy(false); }
  }
  if (detail.loading && !detail.data) return <Loading label="Loading account…" />;
  if (detail.error) return <div className="space-y-4"><Link to="/admin/accounts" className="link inline-flex items-center gap-1 text-xs"><ArrowLeft className="h-3.5 w-3.5" /> Back to accounts</Link><Callout tone="danger" title="Could not load account">{detail.error}</Callout></div>;
  if (!detail.data) return null;
  const { account, users, projects, payments, senders } = detail.data;
  return (
    <>
      <div className="mb-3"><Link to="/admin/accounts" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" /> Back to accounts</Link></div>
      <PageHeader eyebrow="Account review" title={account.businessName}
        description={<span className="inline-flex flex-wrap items-center gap-2"><StatusBadge status={account.status} /> <span className="text-muted">· {account.contactEmail} · joined {formatDate(account.createdAt)}</span></span>}
        actions={account.status === 'active'
          ? <Button variant="danger" onClick={() => { setActionError(null); setSuspendOpen(true); }}><ShieldAlert className="h-4 w-4" /> Suspend</Button>
          : <Button onClick={() => { setActionError(null); setApproveOpen(true); }}><ShieldCheck className="h-4 w-4" /> Approve account</Button>} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="space-y-6">
          <Panel title={<span className="inline-flex items-center gap-2"><Building2 className="h-4 w-4 text-brand-600" /> Business profile</span>}>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted">Contact email</dt><dd className="mt-1 break-all text-ink">{account.contactEmail}</dd></div>
              <div><dt className="text-xs text-muted">Country</dt><dd className="mt-1 text-ink">{account.country}</dd></div>
              <div><dt className="text-xs text-muted">Expected monthly volume</dt><dd className="mt-1 text-ink">{account.expectedMonthlyVolume.toLocaleString('en-GH')} messages</dd></div>
              <div><dt className="text-xs text-muted">Terms version</dt><dd className="mt-1 font-mono text-xs text-ink">{account.termsVersion}</dd></div>
              <div><dt className="text-xs text-muted">Daily spend ceiling</dt><dd className="mt-1 text-ink">{formatMinor(account.dailySpendLimitMinor)}</dd></div>
              <div><dt className="text-xs text-muted">Daily volume ceiling</dt><dd className="mt-1 text-ink">{account.dailyVolumeLimit.toLocaleString('en-GH')} messages</dd></div>
            </dl>
            <div className="mt-4"><p className="text-xs text-muted">Intended use</p><p className="mt-1 whitespace-pre-wrap rounded-xl bg-elevated/50 p-3 text-sm leading-6 text-ink">{account.intendedUse}</p></div>
          </Panel>
          <Panel title={<span className="inline-flex items-center gap-2"><Users className="h-4 w-4 text-brand-600" /> Users</span>} description="Only verified owner email can support approval." bodyClassName="p-0">
            <div className="table-wrap border-0">
              <table className="data-table">
                <thead><tr><th>Email</th><th>Role</th><th>Verified</th><th>MFA</th></tr></thead>
                <tbody>
                  {users.map(user => (
                    <tr key={user.id}>
                      <td className="font-medium text-ink">{user.email}</td>
                      <td><Badge tone="neutral">{user.role}</Badge></td>
                      <td>{user.emailVerifiedAt ? <Badge tone="success">Yes</Badge> : <Badge tone="warning">No</Badge>}</td>
                      <td>{user.mfaEnabled ? <Badge tone="success">Enabled</Badge> : <Badge tone="neutral">No</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!users.some(user => user.emailVerifiedAt) ? <div className="border-t border-line p-4"><Callout tone="warning">No user has verified an email. Approval will be rejected by the server.</Callout></div> : null}
          </Panel>
          <Panel title={<span className="inline-flex items-center gap-2"><FolderKanban className="h-4 w-4 text-brand-600" /> Projects</span>} bodyClassName="p-0">
            {projects.length ? (
              <div className="table-wrap border-0"><table className="data-table"><thead><tr><th>Name</th><th>Daily spend</th><th>Daily volume</th><th>Per minute</th><th>Created</th></tr></thead><tbody>
                {projects.map(project => <tr key={project.id}><td className="font-medium text-ink">{project.name}</td><td>{formatMinor(project.dailySpendLimitMinor)}</td><td>{project.dailyVolumeLimit}</td><td>{project.perMinuteLimit}</td><td className="text-xs text-muted">{formatDate(project.createdAt)}</td></tr>)}
              </tbody></table></div>
            ) : <p className="p-5 text-sm text-muted">No projects yet.</p>}
          </Panel>
          <Panel title={<span className="inline-flex items-center gap-2"><BadgeCheck className="h-4 w-4 text-brand-600" /> Sender requests</span>} action={<Link to="/admin/senders" className="link text-xs">Review queue</Link>} bodyClassName="p-0">
            {senders.length ? (
              <div className="table-wrap border-0"><table className="data-table"><thead><tr><th>Sender</th><th>Brand</th><th>Status</th><th>Provider ref</th><th>Submitted</th></tr></thead><tbody>
                {senders.map(sender => <tr key={sender.id}><td className="font-mono text-xs font-semibold text-ink">{sender.senderId}</td><td>{sender.brand}</td><td><StatusBadge status={sender.status} /></td><td className="font-mono text-[11px] text-muted">{sender.providerReference ?? '—'}</td><td className="text-xs text-muted">{formatDate(sender.createdAt)}</td></tr>)}
              </tbody></table></div>
            ) : <p className="p-5 text-sm text-muted">No sender requests.</p>}
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title={<span className="inline-flex items-center gap-2"><CreditCard className="h-4 w-4 text-brand-600" /> Payments</span>} bodyClassName="p-0">
            {payments.length ? (
              <div className="divide-y divide-line">
                {payments.map(payment => (
                  <div key={payment.reference} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2"><p className="text-sm font-semibold text-ink">{formatMinor(payment.amountMinor)}</p><StatusBadge status={payment.status} /></div>
                    <p className="mt-1 break-all font-mono text-[10px] text-muted">{payment.reference}</p>
                    <p className="mt-1 text-[11px] text-muted">{formatDate(payment.createdAt)}{payment.creditedAt ? ` · credited ${formatDate(payment.creditedAt)}` : ''}</p>
                  </div>
                ))}
              </div>
            ) : <p className="p-5 text-sm text-muted">No payment attempts.</p>}
          </Panel>
          <Callout tone="info" title="Approval checklist">
            Verify the owner email, business identity, intended use, expected volume and sender ownership before approval. Approval does not guarantee provider acceptance; you are attesting to the evidence you reviewed.
          </Callout>
          {account.status === 'suspended' ? <Callout tone="danger" title="Account suspended">Suspended accounts cannot fund or send. Reactivation is not available through this screen; follow the incident runbook before changing the database.</Callout> : null}
        </div>
      </div>
      <Modal open={approveOpen} onClose={() => setApproveOpen(false)} title="Approve account" description="The server requires at least one verified user email before approval succeeds."
        footer={<><Button variant="secondary" onClick={() => setApproveOpen(false)}>Cancel</Button><Button type="submit" form="approve-account-form" loading={busy}>Approve</Button></>}>
        <form id="approve-account-form" onSubmit={approve} className="space-y-4">
          {actionError ? <Callout tone="danger">{actionError}</Callout> : null}
          <Field label="Review note (optional)" htmlFor="approve-note" hint="Stored in the audit log.">
            <TextArea id="approve-note" maxLength={500} rows={4} value={note} onChange={event => setNote(event.target.value)} placeholder="Verified business registration and website." />
          </Field>
        </form>
      </Modal>
      <Modal open={suspendOpen} onClose={() => setSuspendOpen(false)} title="Suspend account" description="Funding and sending are blocked immediately. Use this for policy, fraud or security incidents."
        footer={<><Button variant="secondary" onClick={() => setSuspendOpen(false)}>Cancel</Button><Button type="submit" form="suspend-account-form" variant="danger" loading={busy}>Suspend account</Button></>}>
        <form id="suspend-account-form" onSubmit={suspend} className="space-y-4">
          {actionError ? <Callout tone="danger">{actionError}</Callout> : null}
          <Field label="Reason" htmlFor="suspend-reason" required hint="At least 5 characters. Shown to the customer in the audit trail.">
            <TextArea id="suspend-reason" required minLength={5} maxLength={500} rows={4} value={reason} onChange={event => setReason(event.target.value)} placeholder="Confirmed phishing reports; awaiting investigation." />
          </Field>
        </form>
      </Modal>
    </>
  );
}
