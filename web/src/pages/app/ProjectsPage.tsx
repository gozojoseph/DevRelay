import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Check, Copy, FolderKanban, KeyRound, Pencil, Plus, RefreshCw, RotateCw, ShieldOff,
} from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatDate, formatMinor, minorToGhs, parseGhsToMinor } from '../../lib/format';
import type { ApiKeySummary, NewApiKey, Project } from '../../lib/types';
import { useToast } from '../../context/ToastContext';
import {
  Badge, Button, Callout, CopyButton, EmptyState, Field, Loading, Modal, PageHeader, Panel, TextInput,
} from '../../components/ui';

interface ProjectForm { name: string; dailySpend: string; dailyVolume: string; perMinute: string }

export function ProjectsPage() {
  usePageTitle('Projects & API keys');
  const { toast } = useToast();
  const projects = useApi<Project[]>('/app/projects');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = projects.data?.find(project => project.id === selectedId) ?? projects.data?.[0] ?? null;
  const activeId = selected?.id ?? null;
  const keys = useApi<ApiKeySummary[]>(activeId ? `/app/projects/${activeId}/keys` : null, [activeId]);
  const [createOpen, setCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [form, setForm] = useState<ProjectForm>({ name: '', dailySpend: '', dailyVolume: '', perMinute: '' });
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [scopes, setScopes] = useState<Array<'messaging:send' | 'messaging:read'>>(['messaging:send', 'messaging:read']);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<NewApiKey | null>(null);
  const [revoking, setRevoking] = useState<ApiKeySummary | null>(null);
  const [rotating, setRotating] = useState<ApiKeySummary | null>(null);
  useEffect(() => {
    if (!selectedId && projects.data?.[0]) setSelectedId(projects.data[0].id);
  }, [projects.data, selectedId]);
  async function createProject(event: FormEvent) {
    event.preventDefault();
    setCreating(true); setCreateError(null);
    try {
      const created = await api<Project>('/app/projects', { method: 'POST', body: { name: projectName.trim() } });
      setCreateOpen(false); setProjectName('');
      setSelectedId(created.id);
      await projects.reload();
      toast('Project created.', 'success');
    } catch (cause) { setCreateError(errorMessage(cause)); } finally { setCreating(false); }
  }
  function beginEdit(project: Project) {
    setEditing(project);
    setForm({ name: project.name, dailySpend: minorToGhs(project.dailySpendLimitMinor),
      dailyVolume: String(project.dailyVolumeLimit), perMinute: String(project.perMinuteLimit) });
    setEditError(null);
  }
  async function saveProject(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const spend = parseGhsToMinor(form.dailySpend || '0');
    if (spend === null) { setEditError('Enter a valid daily spend limit in GHS.'); return; }
    const volume = Number(form.dailyVolume); const perMinute = Number(form.perMinute);
    if (!Number.isInteger(volume) || volume < 0) { setEditError('Daily volume must be a whole number of messages.'); return; }
    if (!Number.isInteger(perMinute) || perMinute < 1 || perMinute > 300) { setEditError('Per-minute limit must be between 1 and 300.'); return; }
    setSaving(true); setEditError(null);
    try {
      await api(`/app/projects/${editing.id}`, { method: 'PATCH', body: { name: form.name.trim(),
        dailySpendLimitMinor: spend, dailyVolumeLimit: volume, perMinuteLimit: perMinute } });
      setEditing(null);
      await projects.reload();
      toast('Project updated.', 'success');
    } catch (cause) { setEditError(errorMessage(cause)); } finally { setSaving(false); }
  }
  async function createKey(event: FormEvent) {
    event.preventDefault();
    if (!activeId) return;
    setKeyBusy(true); setKeyError(null);
    try {
      const created = await api<NewApiKey>(`/app/projects/${activeId}/keys`, { method: 'POST', body: { name: keyName.trim(), scopes } });
      setNewKey(created); setKeyOpen(false); setKeyName('');
      await keys.reload();
      toast('API key created. Copy it now.', 'success');
    } catch (cause) { setKeyError(errorMessage(cause)); } finally { setKeyBusy(false); }
  }
  async function revokeKey() {
    if (!revoking || !activeId) return;
    setKeyBusy(true);
    try {
      await api(`/app/projects/${activeId}/keys/${revoking.id}/revoke`, { method: 'POST' });
      setRevoking(null); await keys.reload(); toast('API key revoked.', 'success');
    } catch (cause) { toast(errorMessage(cause), 'error'); } finally { setKeyBusy(false); }
  }
  async function rotateKey() {
    if (!rotating || !activeId) return;
    setKeyBusy(true);
    try {
      const created = await api<NewApiKey>(`/app/projects/${activeId}/keys/${rotating.id}/rotate`, { method: 'POST' });
      setRotating(null); setNewKey(created); await keys.reload();
      toast('Key rotated. The old key is now revoked.', 'success');
    } catch (cause) { toast(errorMessage(cause), 'error'); } finally { setKeyBusy(false); }
  }
  return (
    <>
      <PageHeader eyebrow="Developer" title="Projects & API keys"
        description="A project owns its keys, messages, webhooks and limits. Limits can be lowered per project but never raised above the account ceiling." />
      {projects.loading && !projects.data ? <Loading label="Loading projects…" /> : projects.error ? <Callout tone="danger" title="Could not load projects">{projects.error}</Callout> : !projects.data?.length ? (
        <Panel><EmptyState icon={FolderKanban} title="No projects yet" description="Create a project to issue scoped API keys and send messages."
          action={<Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Create project</Button>} /></Panel>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="space-y-3">
            <Button onClick={() => setCreateOpen(true)} className="w-full"><Plus className="h-4 w-4" /> New project</Button>
            <div className="space-y-2">
              {projects.data.map(project => (
                <button key={project.id} type="button" onClick={() => setSelectedId(project.id)}
                  className={`w-full rounded-xl border px-4 py-3 text-left transition ${project.id === activeId ? 'border-brand-300 bg-brand-50/70 dark:border-brand-500/40 dark:bg-brand-500/10' : 'border-line bg-surface hover:bg-elevated'}`}>
                  <p className="truncate text-sm font-semibold text-ink">{project.name}</p>
                  <p className="mt-1 text-[11px] text-muted">{formatMinor(project.dailySpendLimitMinor)} / day · {project.perMinuteLimit}/min</p>
                </button>
              ))}
            </div>
          </div>
          <div className="min-w-0 space-y-6">
            {selected ? (
              <>
                <Panel title={<span className="inline-flex items-center gap-2"><FolderKanban className="h-4 w-4 text-brand-600" /> {selected.name}</span>}
                  description={`Created ${formatDate(selected.createdAt)} · ID ${selected.id}`}
                  action={<div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => beginEdit(selected)}><Pencil className="h-3.5 w-3.5" /> Edit limits</Button><Button size="sm" variant="ghost" onClick={() => void keys.reload()} aria-label="Refresh keys"><RefreshCw className="h-3.5 w-3.5" /></Button></div>}>
                  <div className="grid gap-3 text-xs sm:grid-cols-3">
                    <div className="muted-card p-3"><p className="text-muted">Daily spend limit</p><p className="mt-1 text-sm font-semibold text-ink">{formatMinor(selected.dailySpendLimitMinor)}</p></div>
                    <div className="muted-card p-3"><p className="text-muted">Daily volume limit</p><p className="mt-1 text-sm font-semibold text-ink">{selected.dailyVolumeLimit.toLocaleString('en-GH')} messages</p></div>
                    <div className="muted-card p-3"><p className="text-muted">Per-minute limit</p><p className="mt-1 text-sm font-semibold text-ink">{selected.perMinuteLimit} requests</p></div>
                  </div>
                </Panel>
                <Panel title={<span className="inline-flex items-center gap-2"><KeyRound className="h-4 w-4 text-brand-600" /> API keys</span>}
                  description="Keys are shown once. Store the raw key in a secret manager; this dashboard keeps only a prefix."
                  action={<Button size="sm" onClick={() => { setKeyOpen(true); setKeyError(null); }}><Plus className="h-3.5 w-3.5" /> Create key</Button>} bodyClassName="p-0">
                  {keys.loading && !keys.data ? <Loading label="Loading keys…" /> : keys.data?.length ? (
                    <div className="table-wrap border-0">
                      <table className="data-table">
                        <thead><tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Last used</th><th>Status</th><th></th></tr></thead>
                        <tbody>
                          {keys.data.map(key => (
                            <tr key={key.id}>
                              <td className="font-medium text-ink">{key.name}</td>
                              <td className="font-mono text-xs text-muted">{key.prefix}…</td>
                              <td><div className="flex flex-wrap gap-1">{key.scopes.map(scope => <Badge key={scope} tone="neutral">{scope}</Badge>)}</div></td>
                              <td className="text-xs text-muted">{key.lastUsedAt ? formatDate(key.lastUsedAt) : 'Never'}</td>
                              <td>{key.revokedAt ? <Badge tone="danger">Revoked</Badge> : <Badge tone="success">Active</Badge>}</td>
                              <td>{!key.revokedAt ? <div className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => setRotating(key)} title="Rotate key"><RotateCw className="h-3.5 w-3.5" /></Button><Button size="sm" variant="ghost" onClick={() => setRevoking(key)} title="Revoke key"><ShieldOff className="h-3.5 w-3.5" /></Button></div> : null}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <div className="p-5"><EmptyState icon={KeyRound} title="No API keys" description="Create a scoped key for this project. Keep send and read scopes separate where possible." action={<Button size="sm" onClick={() => setKeyOpen(true)}><Plus className="h-3.5 w-3.5" /> Create key</Button>} /></div>}
                </Panel>
                <Callout tone="info" title="Base URL and idempotency">
                  API requests use <code className="rounded bg-elevated px-1">/api/v1</code> with <code className="rounded bg-elevated px-1">Authorization: Bearer …</code> and a required <code className="rounded bg-elevated px-1">Idempotency-Key</code> on sends. <Link to="/docs" className="link">Read the API docs</Link>.
                </Callout>
              </>
            ) : null}
          </div>
        </div>
      )}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create a project"
        footer={<><Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button><Button type="submit" form="create-project-form" loading={creating}>Create</Button></>}>
        <form id="create-project-form" onSubmit={createProject} className="space-y-4">
          {createError ? <Callout tone="danger">{createError}</Callout> : null}
          <Field label="Project name" htmlFor="new-project-name" required hint="Use a recognizable product or environment name.">
            <TextInput id="new-project-name" required minLength={2} maxLength={100} value={projectName} onChange={event => setProjectName(event.target.value)} placeholder="Checkout notifications" />
          </Field>
        </form>
      </Modal>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Project limits" description="Limits cannot exceed the account ceiling. Set 0 for daily spend to block sends without revoking keys."
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="edit-project-form" loading={saving}>Save changes</Button></>}>
        <form id="edit-project-form" onSubmit={saveProject} className="space-y-4">
          {editError ? <Callout tone="danger">{editError}</Callout> : null}
          <Field label="Project name" htmlFor="edit-project-name" required>
            <TextInput id="edit-project-name" required minLength={2} maxLength={100} value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Daily spend limit (GHS)" htmlFor="edit-spend" hint="0 blocks all spending.">
              <TextInput id="edit-spend" inputMode="decimal" value={form.dailySpend} onChange={event => setForm(current => ({ ...current, dailySpend: event.target.value }))} />
            </Field>
            <Field label="Daily volume limit" htmlFor="edit-volume" hint="Messages per day.">
              <TextInput id="edit-volume" inputMode="numeric" value={form.dailyVolume} onChange={event => setForm(current => ({ ...current, dailyVolume: event.target.value }))} />
            </Field>
          </div>
          <Field label="Per-minute limit" htmlFor="edit-minute" hint="1–300 requests per minute.">
            <TextInput id="edit-minute" inputMode="numeric" value={form.perMinute} onChange={event => setForm(current => ({ ...current, perMinute: event.target.value }))} />
          </Field>
        </form>
      </Modal>
      <Modal open={keyOpen} onClose={() => setKeyOpen(false)} title="Create API key" description="Choose the minimum scopes the integration needs."
        footer={<><Button variant="secondary" onClick={() => setKeyOpen(false)}>Cancel</Button><Button type="submit" form="create-key-form" loading={keyBusy}>Create key</Button></>}>
        <form id="create-key-form" onSubmit={createKey} className="space-y-4">
          {keyError ? <Callout tone="danger">{keyError}</Callout> : null}
          <Field label="Key name" htmlFor="key-name" required hint="For example “Production checkout”.">
            <TextInput id="key-name" required minLength={2} maxLength={100} value={keyName} onChange={event => setKeyName(event.target.value)} />
          </Field>
          <fieldset>
            <legend className="field-label">Scopes</legend>
            <div className="space-y-2">
              {[{ value: 'messaging:send' as const, label: 'Send messages', hint: 'Required for SMS and WhatsApp sends.' },
                { value: 'messaging:read' as const, label: 'Read messages and balance', hint: 'Required for message history and balance.' }].map(scope => (
                <label key={scope.value} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface p-3">
                  <input type="checkbox" checked={scopes.includes(scope.value)} onChange={event => setScopes(current => event.target.checked ? [...new Set([...current, scope.value])] : current.filter(value => value !== scope.value))}
                    className="mt-0.5 h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500" />
                  <span><span className="block text-sm font-medium text-ink">{scope.label}</span><span className="block text-xs text-muted">{scope.hint}</span></span>
                </label>
              ))}
            </div>
            {!scopes.length ? <p className="field-error">Select at least one scope.</p> : null}
          </fieldset>
        </form>
      </Modal>
      <Modal open={Boolean(newKey)} onClose={() => setNewKey(null)} title="Copy your API key now" description="This raw value is shown once and cannot be retrieved later."
        footer={<Button onClick={() => setNewKey(null)}><Check className="h-4 w-4" /> I have stored it</Button>}>
        {newKey ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4 dark:border-brand-500/30 dark:bg-brand-500/10">
              <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold uppercase tracking-wider text-muted">Raw API key</span><CopyButton value={newKey.key} /></div>
              <p className="mt-2 break-all font-mono text-sm text-ink">{newKey.key}</p>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted"><KeyRound className="h-4 w-4" /> Prefix: <span className="font-mono text-xs text-ink">{newKey.prefix}…</span></div>
            <div className="flex flex-wrap gap-1">{newKey.scopes.map(scope => <Badge key={scope} tone="neutral">{scope}</Badge>)}</div>
            <Callout tone="warning" title="Keep it secret">Never commit the key, expose it in browser code, or send it through chat. Use environment variables on your server.</Callout>
          </div>
        ) : null}
      </Modal>
      <Modal open={Boolean(revoking)} onClose={() => setRevoking(null)} title="Revoke API key?" description="Requests using this key will fail immediately. This cannot be undone."
        footer={<><Button variant="secondary" onClick={() => setRevoking(null)}>Cancel</Button><Button variant="danger" loading={keyBusy} onClick={() => void revokeKey()}>Revoke key</Button></>}>
        <Callout tone="danger" title={revoking?.name ?? 'API key'}><span className="inline-flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Revoke only if the key is lost, exposed or being replaced. Create a replacement and deploy it before revoking production traffic.</span></Callout>
      </Modal>
      <Modal open={Boolean(rotating)} onClose={() => setRotating(null)} title="Rotate API key?" description="A new key is created and the old key is revoked in the same transaction. The new secret is shown once."
        footer={<><Button variant="secondary" onClick={() => setRotating(null)}>Cancel</Button><Button loading={keyBusy} onClick={() => void rotateKey()}><Copy className="h-4 w-4" /> Rotate and show new key</Button></>}>
        <p className="text-sm leading-6 text-muted">Update your deployment with the new key immediately. Requests using <span className="font-mono text-xs text-ink">{rotating?.prefix}…</span> will stop working after rotation.</p>
      </Modal>
    </>
  );
}
