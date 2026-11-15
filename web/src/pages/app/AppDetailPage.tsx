import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Activity, ArrowLeft, ExternalLink, KeyRound, ListTree, Pause, Play, Plus, RefreshCw, Rocket, ScrollText, Trash2,
} from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatDate, relativeTime } from '../../lib/format';
import type { HostingAppDetail, HostingAppEnvVar, HostingAppEvent } from '../../lib/types';
import { useToast } from '../../context/ToastContext';
import {
  Badge, Button, Callout, CopyButton, EmptyState, Field, Loading, Modal, Panel, StatusBadge, TextInput,
} from '../../components/ui';

const EVENT_LABELS: Record<string, string> = {
  app_created: 'Created', deploy_queued: 'Deploy queued', deploy_building: 'Building',
  deploy_live: 'Live', deploy_failed: 'Deploy failed', app_stopped: 'Stopped', app_started: 'Started',
  app_deleted: 'Deleted', env_changed: 'Environment', plan_renewed: 'Renewed',
  plan_resumed: 'Resumed', plan_paused: 'Paused',
};

export function AppDetailPage() {
  const { id = '' } = useParams();
  usePageTitle('Hosted app');
  const { toast } = useToast();
  const navigate = useNavigate();
  const app = useApi<HostingAppDetail>(`/app/hosting/apps/${id}`);
  const events = useApi<{ items: HostingAppEvent[] }>(`/app/hosting/apps/${id}/events`);
  const [envItems, setEnvItems] = useState<HostingAppEnvVar[] | null>(null);
  const [envBusy, setEnvBusy] = useState(false);
  const [envError, setEnvError] = useState<string | null>(null);
  const [envForm, setEnvForm] = useState({ key: '', value: '' });
  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const [logsTail, setLogsTail] = useState<string | null>(null);
  const [logsBusy, setLogsBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const latest = app.data?.deployments?.[0];
  const inFlight = Boolean(latest && ['queued', 'building'].includes(latest.status));

  // While a deploy is in flight, keep the status, deployments and event feed
  // honest and fresh — polling, not assuming.
  useEffect(() => {
    if (!inFlight) return;
    const timer = setInterval(() => { void app.reload(); void events.reload(); }, 8000);
    return () => clearInterval(timer);
  }, [inFlight, app.reload, events.reload]);

  async function loadEnv() {
    try { setEnvItems((await api<{ items: HostingAppEnvVar[] }>(`/app/hosting/apps/${id}/env`)).items); }
    catch (cause) { toast(errorMessage(cause), 'error'); }
  }
  useEffect(() => { void loadEnv(); }, [id]);

  async function reloadAll() {
    await Promise.all([app.reload(), events.reload(), loadEnv()]);
  }

  async function saveEnv(event: FormEvent) {
    event.preventDefault();
    setEnvBusy(true); setEnvError(null);
    try {
      await api(`/app/hosting/apps/${id}/env`, { method: 'PUT', body: { key: envForm.key.trim(), value: envForm.value } });
      setEnvForm({ key: '', value: '' });
      toast('Environment variable saved. It applies on the next deploy.', 'success');
      await reloadAll();
    } catch (cause) { setEnvError(errorMessage(cause)); } finally { setEnvBusy(false); }
  }

  async function removeEnv(key: string) {
    setRemovingKey(key);
    try {
      await api(`/app/hosting/apps/${id}/env/${encodeURIComponent(key)}`, { method: 'DELETE' });
      toast(`${key} removed. Applies on the next deploy.`, 'success');
      await reloadAll();
    } catch (cause) { toast(errorMessage(cause), 'error'); } finally { setRemovingKey(null); }
  }

  async function act(action: 'deploy' | 'stop' | 'start') {
    setBusy(true); setActionError(null);
    try {
      if (action === 'deploy') {
        await api(`/app/hosting/apps/${id}/deploy`, { method: 'POST', body: { ref: app.data?.branch } });
        toast('Deploy queued. Redeploys are free.', 'success');
      } else {
        await api(`/app/hosting/apps/${id}/${action}`, { method: 'POST' });
        toast(action === 'stop' ? 'Stop queued.' : 'Start queued.', 'success');
      }
      await reloadAll();
    } catch (cause) { setActionError(errorMessage(cause)); } finally { setBusy(false); }
  }

  async function loadLogs() {
    setLogsBusy(true);
    try {
      const data = await api<{ tail: string }>(`/app/hosting/apps/${id}/logs`);
      setLogsTail(data.tail || 'The container has not produced output yet.');
    } catch (cause) { setLogsTail(`Could not load logs: ${errorMessage(cause)}`); } finally { setLogsBusy(false); }
  }

  async function remove() {
    setBusy(true);
    try {
      await api(`/app/hosting/apps/${id}`, { method: 'DELETE' });
      toast('App deleted. Container removed and billing stopped.', 'success');
      navigate('/app/hosting');
    } catch (cause) { setActionError(errorMessage(cause)); setBusy(false); }
  }

  if (app.error) {
    return <div className="space-y-4"><Link to="/app/hosting" className="link inline-flex items-center gap-1 text-xs"><ArrowLeft className="h-3.5 w-3.5" /> Back to hosting</Link><Callout tone="danger" title="Could not load app">{app.error}</Callout></div>;
  }
  if (!app.data) return <Loading label="Loading app…" />;
  const d = app.data;

  return (
    <div className="space-y-6">
      <Link to="/app/hosting" className="link inline-flex items-center gap-1 text-xs"><ArrowLeft className="h-3.5 w-3.5" /> Back to hosting</Link>

      <div className="surface-card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight text-ink">{d.name}</h1>
              <StatusBadge status={d.status} />
              <Badge tone="neutral">{d.plan}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted">
              {d.repoUrl} · branch {d.branch} · {d.slug}
            </p>
            {d.url ? (
              <p className="mt-1 text-sm"><a href={d.url} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1">{d.url.replace(/^https?:\/\//, '')}<ExternalLink className="h-3.5 w-3.5" /></a> <CopyButton value={d.url} /></p>
            ) : null}
            {d.lastError ? <p className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-400">{d.lastError}</p> : null}
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            <Button size="sm" loading={busy} onClick={() => void act('deploy')}><Rocket className="h-3.5 w-3.5" /> Deploy {d.branch}</Button>
            {['live', 'failed', 'paused_no_funds'].includes(d.status) ? (
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void act('stop')}><Pause className="h-3.5 w-3.5" /> Stop</Button>
            ) : null}
            {['paused_manual', 'paused_no_funds'].includes(d.status) ? (
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void act('start')}><Play className="h-3.5 w-3.5" /> Start</Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}><Trash2 className="h-3.5 w-3.5 text-rose-500" /> Delete</Button>
          </div>
        </div>
        {inFlight ? (
          <Callout tone="info" title="A deploy is in progress">The page updates itself every few seconds until the build finishes.</Callout>
        ) : null}
        {actionError ? <div className="mt-3"><Callout tone="danger">{actionError}</Callout></div> : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={<span className="inline-flex items-center gap-2"><ListTree className="h-4 w-4 text-brand-600" /> Deployments</span>}
          description="Newest first. A failed redeploy never stops the previously live container." bodyClassName="p-0">
          {d.deployments.length ? (
            <div className="divide-y divide-line">
              {d.deployments.map(dep => (
                <div key={dep.id} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={dep.status} />
                      <Badge tone="neutral">{dep.ref}</Badge>
                      {dep.id === d.currentDeploymentId ? <Badge tone="info">serving</Badge> : null}
                    </div>
                    <p className="mt-1 text-xs text-muted">{formatDate(dep.createdAt)}{dep.finishedAt ? ` · finished ${formatDate(dep.finishedAt)}` : ''}</p>
                    {dep.error ? <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400">{dep.error}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : <div className="p-5"><EmptyState icon={ListTree} title="No deployments yet" description="The first deploy is queued when the app is created." /></div>}
        </Panel>

        <Panel title={<span className="inline-flex items-center gap-2"><Activity className="h-4 w-4 text-brand-600" /> Events</span>}
          description="Lifecycle feed: deploys, stops, environment and plan changes."
          bodyClassName="p-0"
          action={<Button size="sm" variant="ghost" onClick={() => void events.reload()}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>}>
          {events.data?.items.length ? (
            <div className="divide-y divide-line">
              {events.data.items.map(event => (
                <div key={event.id} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={event.kind.includes('failed') || event.kind.includes('paused') ? 'danger' : event.kind === 'deploy_live' ? 'success' : 'neutral'}>
                        {EVENT_LABELS[event.kind] ?? event.kind}
                      </Badge>
                    </div>
                    <p className="mt-1 break-words text-xs text-ink">{event.message}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted" title={formatDate(event.createdAt)}>{relativeTime(event.createdAt)}</span>
                </div>
              ))}
            </div>
          ) : events.loading ? <div className="p-5"><Loading label="Loading events…" /></div>
            : <div className="p-5"><EmptyState icon={Activity} title="No events yet" description="Lifecycle events appear here as they happen." /></div>}
        </Panel>
      </div>

      <Panel title={<span className="inline-flex items-center gap-2"><KeyRound className="h-4 w-4 text-brand-600" /> Environment</span>}
        description="Values are write-only: set them here, the dashboard never shows them again. Changes apply on the next deploy.">
        {envError ? <div className="mb-4"><Callout tone="danger">{envError}</Callout></div> : null}
        {envItems?.length ? (
          <div className="mb-4 divide-y divide-line rounded-xl border border-line">
            {envItems.map(item => (
              <div key={item.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-ink">{item.key}</p>
                  <p className="text-[11px] text-muted">updated {relativeTime(item.updatedAt)}</p>
                </div>
                <Button size="sm" variant="ghost" loading={removingKey === item.key} onClick={() => void removeEnv(item.key)}>
                  <Trash2 className="h-3.5 w-3.5 text-rose-500" /> Remove
                </Button>
              </div>
            ))}
          </div>
        ) : <p className="mb-4 text-xs text-muted">No environment variables yet. Example: <span className="font-mono">DATABASE_URL</span>, <span className="font-mono">API_KEY</span>.</p>}
        <form onSubmit={saveEnv} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
          <Field label="Name" htmlFor="env-key" required>
            <TextInput id="env-key" required maxLength={120} pattern="[A-Za-z_][A-Za-z0-9_]*" value={envForm.key}
              onChange={event => setEnvForm({ ...envForm, key: event.target.value })} placeholder="API_KEY" />
          </Field>
          <Field label="Value" htmlFor="env-value" required hint="Stored encrypted; shown only to your app's container.">
            <TextInput id="env-value" type="password" required maxLength={4000} value={envForm.value}
              onChange={event => setEnvForm({ ...envForm, value: event.target.value })} placeholder="secret value" />
          </Field>
          <Button type="submit" loading={envBusy}><Plus className="h-4 w-4" /> Save</Button>
        </form>
      </Panel>

      <Panel title={<span className="inline-flex items-center gap-2"><ScrollText className="h-4 w-4 text-brand-600" /> Runtime logs</span>}
        description="Recent container output straight from the host agent.">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" loading={logsBusy} onClick={() => void loadLogs()}><RefreshCw className="h-3.5 w-3.5" /> Load logs</Button>
          <span className="text-xs text-muted">Last 500 lines from the running container.</span>
        </div>
        {logsTail ? (
          <pre className="mt-3 max-h-[50vh] overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-4 text-[12px] leading-6 text-slate-200 scrollbar-thin">{logsTail}</pre>
        ) : null}
      </Panel>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Delete ${d.name}?`}
        description="The container is removed and the app stops billing. This cannot be undone." size="sm"
        footer={<><Button variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" loading={busy} onClick={() => void remove()}>Delete app</Button></>}>
        <Callout tone="warning" title="Deploys and history go too">
          Past deployments, events and the app URL are removed. Download any logs you need first.
        </Callout>
      </Modal>
    </div>
  );
}
