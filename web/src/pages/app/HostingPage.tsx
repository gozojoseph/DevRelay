import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  Clock, ExternalLink, Pause, Play, Plus, RefreshCw, Rocket, ScrollText, Server, Trash2,
} from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatDay, formatMinor, relativeTime } from '../../lib/format';
import type { HostingAppDetail, HostingOverview, Project } from '../../lib/types';
import { useToast } from '../../context/ToastContext';
import {
  Badge, Button, Callout, CopyButton, EmptyState, Field, Loading, Modal, PageHeader, Panel,
  Select, StatusBadge, TextInput,
} from '../../components/ui';

export function HostingPage() {
  usePageTitle('Hosting');
  const { toast } = useToast();
  const overview = useApi<HostingOverview>('/app/hosting');
  const projects = useApi<Project[]>('/app/projects');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [logsApp, setLogsApp] = useState<{ id: string; name: string } | null>(null);
  const [logsTail, setLogsTail] = useState<string | null>(null);
  const [logsBusy, setLogsBusy] = useState(false);
  const [deleteApp, setDeleteApp] = useState<HostingAppDetail | null>(null);
  const [form, setForm] = useState({ projectId: '', name: '', repoUrl: '', repoToken: '', branch: 'main', builder: 'node', plan: 'starter' });

  const available = overview.data?.available ?? false;
  const hasProjects = Boolean(projects.data?.length);

  function openCreate() {
    setForm({ projectId: projects.data?.[0]?.id ?? '', name: '', repoUrl: '', repoToken: '', branch: 'main', builder: 'node', plan: overview.data?.plans[0]?.id ?? 'starter' });
    setError(null); setOpen(true);
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      await api('/app/hosting/apps', { method: 'POST', body: {
        projectId: form.projectId, name: form.name.trim(), repoUrl: form.repoUrl.trim(),
        repoToken: form.repoToken.trim() || undefined, branch: form.branch.trim() || 'main',
        builder: form.builder, plan: form.plan,
      } });
      setOpen(false); await overview.reload();
      toast('App created. The first deploy is queued — the plan was charged in advance.', 'success');
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  async function detail(id: string) {
    return api<HostingAppDetail>(`/app/hosting/apps/${id}`);
  }
  async function action(id: string, kind: 'deploy' | 'stop' | 'start') {
    setBusyId(id);
    try {
      await api(`/app/hosting/apps/${id}${kind === 'deploy' ? '/deploy' : `/${kind}`}`, { method: 'POST', body: {} });
      await overview.reload();
      toast(kind === 'deploy' ? 'Redeploy queued. Deploys are free; the plan is what bills.'
        : kind === 'stop' ? 'Stop queued. The app pauses visibly until you start it again.'
        : 'Start queued.', 'success');
    } catch (cause) { toast(errorMessage(cause), 'error'); } finally { setBusyId(null); }
  }
  async function remove() {
    if (!deleteApp) return;
    setBusy(true);
    try {
      await api(`/app/hosting/apps/${deleteApp.id}`, { method: 'DELETE' });
      setDeleteApp(null); await overview.reload();
      toast('Delete queued. The container is removed and the app stops billing.', 'success');
    } catch (cause) { toast(errorMessage(cause), 'error'); } finally { setBusy(false); }
  }
  async function openLogs(app: { id: string; name: string }) {
    setLogsApp(app); setLogsTail(null); setLogsBusy(true);
    try { setLogsTail((await api<{ tail: string }>(`/app/hosting/apps/${app.id}/logs`)).tail); }
    catch (cause) { setLogsTail(`Could not load logs: ${errorMessage(cause)}`); }
    finally { setLogsBusy(false); }
  }
  async function refreshDetail(app: { id: string }) {
    const fresh = await detail(app.id);
    setLogsApp(fresh);
    return fresh;
  }

  return (
    <>
      <PageHeader eyebrow="DevRelay Cloud" title="Hosting"
        description="Deploy a backend app from a Git repo and get an HTTPS URL. The monthly plan is charged in advance from your GHS wallet; a failed redeploy never stops the previously live container."
        actions={<><Button variant="secondary" onClick={() => void overview.reload()}><RefreshCw className="h-4 w-4" /> Refresh</Button>
          <Button onClick={openCreate} disabled={!available || !hasProjects}><Plus className="h-4 w-4" /> New app</Button></>} />
      {overview.loading && !overview.data ? <Loading label="Loading hosting…" /> : overview.error ? <Callout tone="danger" title="Could not load hosting">{overview.error}</Callout> : (
        <div className="space-y-6">
          {!available ? (
            <Callout tone="info" title="DevRelay Cloud is not switched on yet">
              The deploy pipeline is being provisioned. You can see the plans below; creating apps unlocks the moment hosting goes live.
            </Callout>
          ) : null}
          {!hasProjects ? (
            <Callout tone="warning" title="Create a project first">Apps belong to a project, just like API keys. <Link to="/app/projects" className="link">Create a project</Link>.</Callout>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            {(overview.data?.plans ?? []).map(plan => (
              <div key={plan.id} className="surface-card p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-ink">{plan.label}</p>
                  <Badge tone="neutral">{plan.memoryMb} MB · {plan.cpuMilli} mCPU</Badge>
                </div>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-ink">{formatMinor(plan.priceMinor)}<span className="text-sm font-normal text-muted">/month</span></p>
                <p className="mt-1 text-xs text-muted">30-day periods, charged in advance from your wallet.</p>
              </div>
            ))}
          </div>

          <Panel title={<span className="inline-flex items-center gap-2"><Server className="h-4 w-4 text-brand-600" /> Your apps</span>}
            description="One container per app. paused_no_funds means the wallet could not cover a renewal — it resumes automatically after a top-up." bodyClassName="p-0">
            {overview.data?.items.length ? (
              <div className="divide-y divide-line">
                {overview.data.items.map(app => (
                  <div key={app.id} className="px-5 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-ink">{app.name}</p>
                          <StatusBadge status={app.status} />
                          <Badge tone="neutral">{app.plan}</Badge>
                          <Badge tone="neutral">{app.builder}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted">
                          {app.projectName ?? app.projectId} · {app.branch}
                          {app.url ? <> · <a href={app.url} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1">{app.url.replace(/^https?:\/\//, '')}<ExternalLink className="h-3 w-3" /></a> <CopyButton value={app.url} /></> : null}
                        </p>
                        <p className="mt-1 flex items-center gap-1 text-xs text-muted">
                          <Clock className="h-3 w-3" /> Plan renews {formatDay(app.planExpiresAt)} ({relativeTime(app.planExpiresAt)})
                        </p>
                        {app.lastError ? <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400">{app.lastError.replaceAll('_', ' ')}</p> : null}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        <Button size="sm" variant="secondary" loading={busyId === app.id} onClick={() => void action(app.id, 'deploy')} disabled={!available}><Rocket className="h-3.5 w-3.5" /> Deploy</Button>
                        {['live', 'failed', 'paused_no_funds'].includes(app.status) ? (
                          <Button size="sm" variant="ghost" loading={busyId === app.id} onClick={() => void action(app.id, 'stop')} disabled={!available}><Pause className="h-3.5 w-3.5" /> Stop</Button>
                        ) : null}
                        {['paused_manual', 'paused_no_funds'].includes(app.status) ? (
                          <Button size="sm" variant="ghost" loading={busyId === app.id} onClick={() => void action(app.id, 'start')} disabled={!available}><Play className="h-3.5 w-3.5" /> Start</Button>
                        ) : null}
                        <Button size="sm" variant="ghost" onClick={() => void openLogs(app)}><ScrollText className="h-3.5 w-3.5" /> Logs</Button>
                        <Button size="sm" variant="ghost" onClick={() => void detail(app.id).then(setDeleteApp)}><Trash2 className="h-3.5 w-3.5 text-rose-500" /> Delete</Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : <div className="p-5"><EmptyState icon={Server} title="No apps yet"
              description="Create an app from a public HTTPS Git repo (or a private one with a deploy token) and DevRelay builds and runs it on DevRelay Cloud."
              action={available ? <Button size="sm" onClick={openCreate} disabled={!hasProjects}><Plus className="h-3.5 w-3.5" /> New app</Button> : undefined} /></div>}
          </Panel>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New hosted app"
        description="Month 1 is charged from your wallet immediately. If the balance is too low, nothing is created."
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" form="create-app-form" loading={busy}>Create & deploy</Button></>}>
        <form id="create-app-form" onSubmit={create} className="space-y-4">
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <Field label="Project" htmlFor="app-project" required>
            <Select id="app-project" value={form.projectId} onChange={event => setForm({ ...form, projectId: event.target.value })} required>
              {(projects.data ?? []).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </Select>
          </Field>
          <Field label="App name" htmlFor="app-name" required hint="Becomes part of your app URL, e.g. clinic-reminders-a1b2.apps.devrelay.cloud">
            <TextInput id="app-name" required minLength={2} maxLength={60} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Clinic Reminders" />
          </Field>
          <Field label="Repository URL" htmlFor="app-repo" required hint="Public HTTPS repo, or private with a deploy token below">
            <TextInput id="app-repo" type="url" required maxLength={500} value={form.repoUrl} onChange={event => setForm({ ...form, repoUrl: event.target.value })} placeholder="https://github.com/you/app.git" />
          </Field>
          <Field label="Deploy token (optional)" htmlFor="app-token" hint="For private repos. Stored encrypted; never shown again.">
            <TextInput id="app-token" type="password" maxLength={300} value={form.repoToken} onChange={event => setForm({ ...form, repoToken: event.target.value })} placeholder="ghp_… or token" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Branch" htmlFor="app-branch" required>
              <TextInput id="app-branch" required maxLength={120} value={form.branch} onChange={event => setForm({ ...form, branch: event.target.value })} />
            </Field>
            <Field label="Builder" htmlFor="app-builder" required>
              <Select id="app-builder" value={form.builder} onChange={event => setForm({ ...form, builder: event.target.value })}>
                <option value="node">Node (auto)</option>
                <option value="dockerfile">Dockerfile</option>
              </Select>
            </Field>
            <Field label="Plan" htmlFor="app-plan" required>
              <Select id="app-plan" value={form.plan} onChange={event => setForm({ ...form, plan: event.target.value })}>
                {(overview.data?.plans ?? []).map(plan => <option key={plan.id} value={plan.id}>{plan.label} — {formatMinor(plan.priceMinor)}/mo</option>)}
              </Select>
            </Field>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(logsApp)} onClose={() => setLogsApp(null)} title={logsApp ? `Logs — ${logsApp.name}` : 'Logs'}
        description="Recent container output from the host agent."
        footer={<><Button variant="secondary" loading={logsBusy} onClick={() => logsApp && void refreshDetail(logsApp).then(refreshed => openLogs(refreshed))}><RefreshCw className="h-4 w-4" /> Reload</Button><Button onClick={() => setLogsApp(null)}>Close</Button></>}>
        <pre className="max-h-[50vh] overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-4 text-[12px] leading-6 text-slate-200 scrollbar-thin">
          {logsBusy ? 'Loading logs…' : logsTail ?? 'No logs loaded yet.'}
        </pre>
      </Modal>

      <Modal open={Boolean(deleteApp)} onClose={() => setDeleteApp(null)} title={`Delete ${deleteApp?.name ?? 'app'}?`}
        description="The container is removed and the app stops billing. This cannot be undone." size="sm"
        footer={<><Button variant="secondary" onClick={() => setDeleteApp(null)}>Cancel</Button><Button variant="danger" loading={busy} onClick={() => void remove()}>Delete app</Button></>}>
        <Callout tone="warning" title="Deploys and history go too">
          Past deployments and the app URL are removed. Download any logs you need first.
        </Callout>
      </Modal>
    </>
  );
}
