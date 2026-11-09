import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, AlertTriangle, CheckCircle2, Pause, Play, Plus, RefreshCw, Send, Webhook,
} from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatDate } from '../../lib/format';
import type { NewWebhook, Project, WebhookEndpoint, WebhookOverview } from '../../lib/types';
import { useToast } from '../../context/ToastContext';
import {
  Badge, Button, Callout, CopyButton, EmptyState, Field, Loading, Modal, PageHeader, Panel, TextInput,
} from '../../components/ui';

const eventOptions = [
  { value: '*', label: 'All message events' },
  { value: 'message.accepted', label: 'Accepted' },
  { value: 'message.sent', label: 'Sent' },
  { value: 'message.delivered', label: 'Delivered' },
  { value: 'message.read', label: 'Read' },
  { value: 'message.failed', label: 'Failed' },
  { value: 'message.reconciled', label: 'Reconciled' },
];

export function WebhooksPage() {
  usePageTitle('Webhooks');
  const { toast } = useToast();
  const overview = useApi<WebhookOverview>('/app/webhooks');
  const projects = useApi<Project[]>('/app/projects');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<WebhookEndpoint | null>(null);
  const [projectId, setProjectId] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['*']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const projectNames = useMemo(() => new Map((projects.data ?? []).map(project => [project.id, project.name])), [projects.data]);
  function openCreate() {
    setProjectId(projects.data?.[0]?.id ?? '');
    setUrl(''); setEvents(['*']); setError(null); setOpen(true);
  }
  function openEdit(endpoint: WebhookEndpoint) {
    setEditing(endpoint); setProjectId(endpoint.projectId); setUrl(endpoint.url); setEvents(endpoint.events); setError(null);
  }
  function toggleEvent(value: string) {
    setEvents(current => {
      if (current.includes(value)) return current.filter(item => item !== value);
      return [...current.filter(item => item !== '*'), value];
    });
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (!events.length) { setError('Select at least one event.'); return; }
    setBusy(true); setError(null);
    try {
      const result = await api<NewWebhook>('/app/webhooks', { method: 'POST', body: { projectId, url: url.trim(), events } });
      setOpen(false); setSecret(result.secret);
      await overview.reload();
      toast('Webhook endpoint created. Copy the signing secret now.', 'success');
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  async function update(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    if (!events.length) { setError('Select at least one event.'); return; }
    setBusy(true); setError(null);
    try {
      await api(`/app/webhooks/${editing.id}`, { method: 'PATCH', body: { url: url.trim(), events } });
      setEditing(null); await overview.reload(); toast('Webhook endpoint updated.', 'success');
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  async function toggle(endpoint: WebhookEndpoint) {
    setBusyId(endpoint.id);
    try {
      await api(`/app/webhooks/${endpoint.id}`, { method: 'PATCH', body: { active: !endpoint.active } });
      await overview.reload();
      toast(endpoint.active ? 'Endpoint paused.' : 'Endpoint resumed.', 'success');
    } catch (cause) { toast(errorMessage(cause), 'error'); } finally { setBusyId(null); }
  }
  async function test(endpoint: WebhookEndpoint) {
    setBusyId(endpoint.id);
    try {
      await api(`/app/webhooks/${endpoint.id}/test`, { method: 'POST' });
      await overview.reload();
      toast('Test event queued. Check the attempts below after delivery.', 'success');
    } catch (cause) { toast(errorMessage(cause), 'error'); } finally { setBusyId(null); }
  }
  return (
    <>
      <PageHeader eyebrow="Integrations" title="Webhooks"
        description="Receive HMAC-signed message events over HTTPS. Delivery attempts are recorded; the API never claims a webhook succeeded without an HTTP 2xx."
        actions={<><Button variant="secondary" onClick={() => void overview.reload()}><RefreshCw className="h-4 w-4" /> Refresh</Button><Button onClick={openCreate} disabled={!projects.data?.length}><Plus className="h-4 w-4" /> Add endpoint</Button></>} />
      {overview.loading && !overview.data ? <Loading label="Loading webhooks…" /> : overview.error ? <Callout tone="danger" title="Could not load webhooks">{overview.error}</Callout> : (
        <div className="space-y-6">
          {!projects.data?.length ? <Callout tone="warning" title="Create a project first">Webhooks belong to a project, just like API keys. <Link to="/app/projects" className="link">Create a project</Link>.</Callout> : null}
          <Panel title={<span className="inline-flex items-center gap-2"><Webhook className="h-4 w-4 text-brand-600" /> Endpoints</span>} description="Each endpoint receives the events it subscribes to. Pause rather than delete when debugging." action={<Button size="sm" onClick={openCreate} disabled={!projects.data?.length}><Plus className="h-3.5 w-3.5" /> Add</Button>} bodyClassName="p-0">
            {overview.data?.endpoints.length ? (
              <div className="divide-y divide-line">
                {overview.data.endpoints.map(endpoint => (
                  <div key={endpoint.id} className="px-5 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="break-all text-sm font-semibold text-ink">{endpoint.url}</p>
                          {endpoint.active ? <Badge tone="success">Active</Badge> : <Badge tone="warning">Paused</Badge>}
                        </div>
                        <p className="mt-1 text-xs text-muted">{projectNames.get(endpoint.projectId) ?? endpoint.projectId} · created {formatDate(endpoint.createdAt)}</p>
                        <div className="mt-2 flex flex-wrap gap-1">{endpoint.events.map(item => <Badge key={item} tone="neutral">{item === '*' ? 'All message events' : item.replace('message.', '')}</Badge>)}</div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        <Button size="sm" variant="secondary" loading={busyId === endpoint.id} onClick={() => void test(endpoint)}><Send className="h-3.5 w-3.5" /> Test</Button>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(endpoint)}>Edit</Button>
                        <Button size="sm" variant="ghost" loading={busyId === endpoint.id} onClick={() => void toggle(endpoint)}>{endpoint.active ? <><Pause className="h-3.5 w-3.5" /> Pause</> : <><Play className="h-3.5 w-3.5" /> Resume</>}</Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : <div className="p-5"><EmptyState icon={Webhook} title="No webhook endpoints" description="Add an HTTPS endpoint to receive accepted, sent, delivered, read and failed message events." action={<Button size="sm" onClick={openCreate} disabled={!projects.data?.length}><Plus className="h-3.5 w-3.5" /> Add endpoint</Button>} /></div>}
          </Panel>
          <Panel title={<span className="inline-flex items-center gap-2"><Activity className="h-4 w-4 text-brand-600" /> Recent events</span>} description="The latest 50 events for this tenant, with delivery attempts." action={<Link to="/docs#webhooks" className="link text-xs">Signature docs</Link>} bodyClassName="p-0">
            {overview.data?.events.length ? (
              <div className="table-wrap border-0">
                <table className="data-table">
                  <thead><tr><th>Event</th><th>Project</th><th>Message</th><th>Attempts</th><th>Created</th></tr></thead>
                  <tbody>
                    {overview.data.events.map(event => (
                      <tr key={event.id}>
                        <td><Badge tone={event.type === 'webhook.test' ? 'info' : 'neutral'}>{event.type}</Badge></td>
                        <td className="text-muted">{projectNames.get(event.projectId) ?? '—'}</td>
                        <td>{event.messageId ? <Link to={`/app/messages/${event.messageId}`} className="link text-xs">Open</Link> : <span className="text-muted">—</span>}</td>
                        <td>
                          {event.attempts.length ? (
                            <div className="space-y-1">
                              {event.attempts.slice(0, 3).map(attempt => (
                                <div key={`${attempt.endpointId}-${attempt.attempt}`} className="flex items-center gap-1.5 text-[11px]">
                                  {attempt.httpStatus && attempt.httpStatus >= 200 && attempt.httpStatus < 300 ? <CheckCircle2 className="h-3 w-3 text-brand-600" /> : <AlertTriangle className="h-3 w-3 text-rose-500" />}
                                  <span className="text-muted">#{attempt.attempt} · {attempt.httpStatus ? `HTTP ${attempt.httpStatus}` : attempt.error ?? 'pending'}</span>
                                </div>
                              ))}
                            </div>
                          ) : <span className="text-[11px] text-muted">Not attempted</span>}
                        </td>
                        <td className="text-xs text-muted">{formatDate(event.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="p-5"><EmptyState icon={Activity} title="No webhook events yet" description="Events are emitted when messages change status. Send a test event or a message to populate this list." /></div>}
          </Panel>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Add webhook endpoint" description="HTTPS on port 443 only. Private, loopback and internal addresses are blocked by the server."
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" form="create-webhook-form" loading={busy}>Create endpoint</Button></>}>
        <form id="create-webhook-form" onSubmit={create} className="space-y-4">
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <Field label="Project" htmlFor="webhook-project" required>
            <select id="webhook-project" className="field-input" value={projectId} onChange={event => setProjectId(event.target.value)} required>
              {(projects.data ?? []).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </Field>
          <Field label="Endpoint URL" htmlFor="webhook-url" required hint="Example: https://api.yourdomain.com/webhooks/devrelay">
            <TextInput id="webhook-url" type="url" required maxLength={2000} value={url} onChange={event => setUrl(event.target.value)} placeholder="https://" />
          </Field>
          <fieldset>
            <legend className="field-label">Events</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {eventOptions.map(option => (
                <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink">
                  <input type="checkbox" checked={events.includes(option.value)} onChange={() => toggleEvent(option.value)} className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500" />
                  {option.label}
                </label>
              ))}
            </div>
            {!events.length ? <p className="field-error">Select at least one event.</p> : null}
          </fieldset>
        </form>
      </Modal>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Edit webhook endpoint"
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="edit-webhook-form" loading={busy}>Save changes</Button></>}>
        <form id="edit-webhook-form" onSubmit={update} className="space-y-4">
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <Field label="Endpoint URL" htmlFor="edit-webhook-url" required>
            <TextInput id="edit-webhook-url" type="url" required maxLength={2000} value={url} onChange={event => setUrl(event.target.value)} />
          </Field>
          <fieldset>
            <legend className="field-label">Events</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {eventOptions.map(option => (
                <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink">
                  <input type="checkbox" checked={events.includes(option.value)} onChange={() => toggleEvent(option.value)} className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500" />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
          <Callout tone="info">Changing events does not revoke the signing secret. Test the endpoint after saving.</Callout>
        </form>
      </Modal>
      <Modal open={Boolean(secret)} onClose={() => setSecret(null)} title="Webhook signing secret" description="Shown once. Store it server-side; it is used to verify every request."
        footer={<Button onClick={() => setSecret(null)}>I have stored it</Button>}>
        {secret ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4 dark:border-brand-500/30 dark:bg-brand-500/10">
              <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold uppercase tracking-wider text-muted">Secret</span><CopyButton value={secret} /></div>
              <p className="mt-2 break-all font-mono text-sm text-ink">{secret}</p>
            </div>
            <p className="text-sm leading-6 text-muted">Verify <code className="rounded bg-elevated px-1">X-DevRelay-Signature</code> over the raw body prefixed by <code className="rounded bg-elevated px-1">timestamp.</code> Reject stale timestamps. <Link to="/docs#webhooks" className="link">See the verification example</Link>.</p>
            <Callout tone="warning" title="Never trust unsigned input">Do not process a webhook based only on its JSON body. Verify the signature against the exact raw bytes before parsing.</Callout>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
