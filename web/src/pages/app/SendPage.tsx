import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, ChevronRight, Info, MessageCircle, Send, Smartphone, Users,
} from 'lucide-react';
import { api, errorMessage, newIdempotencyKey } from '../../lib/api';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatMinor, titleCase } from '../../lib/format';
import type { Project, SendAccepted, SenderRequest, WhatsappOverview } from '../../lib/types';
import { useAuth } from '../../context/AuthContext';
import {
  Badge, Button, Callout, EmptyState, Field, Loading, PageHeader, Panel, Select, Tabs, TextArea, TextInput,
} from '../../components/ui';

function AcceptedCard({ result, onReset }: { result: SendAccepted; onReset: () => void }) {
  return (
    <div className="rounded-2xl border border-brand-200 bg-brand-50/70 p-5 dark:border-brand-500/30 dark:bg-brand-500/10">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-700 dark:text-brand-300" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">Message accepted and queued</p>
          <p className="mt-1 text-xs leading-5 text-muted">{result.note}</p>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <p><span className="text-muted">Message ID:</span> <span className="break-all font-mono text-ink">{result.id}</span></p>
            <p><span className="text-muted">Status:</span> <span className="font-semibold text-ink">{titleCase(result.status)}</span></p>
            <p><span className="text-muted">Quoted charge:</span> <span className="font-semibold text-ink">{formatMinor(result.estimatedChargeMinor)}</span></p>
            <p><span className="text-muted">Segments:</span> {result.segments ?? '—'}</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to={`/app/messages/${result.id}`} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800">View message <ChevronRight className="h-3.5 w-3.5" /></Link>
            <button type="button" onClick={onReset} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-elevated">Send another</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SmsComposer({ projects }: { projects: Project[] }) {
  const { me } = useAuth();
  const senders = useApi<SenderRequest[]>('/app/senders');
  const approved = useMemo(() => (senders.data ?? []).filter(sender => sender.status === 'approved'), [senders.data]);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [senderId, setSenderId] = useState('');
  const [to, setTo] = useState('');
  const [body, setBody] = useState('');
  const [key, setKey] = useState(newIdempotencyKey);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendAccepted | null>(null);
  useEffect(() => {
    if (approved.length && !senderId) setSenderId(approved[0]!.senderId);
  }, [approved, senderId]);
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projects, projectId]);
  function change<T>(setter: (value: T) => void, value: T) {
    setter(value); setKey(newIdempotencyKey()); setResult(null);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setError(null);
    try {
      const accepted = await api<SendAccepted>('/app/messages/sms', { method: 'POST', headers: { 'Idempotency-Key': key },
        body: { projectId, senderId, to, body } });
      setResult(accepted);
      setBody(''); setKey(newIdempotencyKey());
    } catch (cause) { setError(errorMessage(cause)); } finally { setLoading(false); }
  }
  if (!me?.availability.sms) {
    return <Callout tone="warning" title="SMS is not configured">The server does not have Africa’s Talking credentials and callback configuration. Sending returns a configuration error rather than a simulated success. Contact support.</Callout>;
  }
  if (approved.length === 0) {
    return (
      <EmptyState icon={Users} title="No approved sender ID" description="Every SMS must use a sender ID approved by the operator for your account. Request one and wait for review."
        action={<Link to="/app/senders" className="inline-flex rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">Request a sender ID</Link>} />
    );
  }
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Panel title="Compose SMS" description="Charges are reserved when the API accepts the message. Delivery is confirmed later by provider events.">
        {result ? <div className="mb-5"><AcceptedCard result={result} onReset={() => setResult(null)} /></div> : null}
        {error ? <div className="mb-4"><Callout tone="danger">{error}</Callout></div> : null}
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Project" htmlFor="sms-project" required>
              <Select id="sms-project" value={projectId} onChange={event => change(setProjectId, event.target.value)} required>
                {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
              </Select>
            </Field>
            <Field label="Approved sender ID" htmlFor="sms-sender" required>
              <Select id="sms-sender" value={senderId} onChange={event => change(setSenderId, event.target.value)} required>
                {approved.map(sender => <option key={sender.id} value={sender.senderId}>{sender.senderId} · {sender.brand}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Recipient number" htmlFor="sms-to" required hint="Ghana mobile number. International format such as +233201234567 is recommended.">
            <TextInput id="sms-to" type="tel" required minLength={8} maxLength={24} value={to} onChange={event => change(setTo, event.target.value)} placeholder="+233201234567" />
          </Field>
          <Field label="Message" htmlFor="sms-body" required hint={`${body.length.toLocaleString('en-GH')} characters · the server calculates segments and quotes the exact charge.`}>
            <TextArea id="sms-body" required maxLength={1600} rows={6} value={body} onChange={event => change(setBody, event.target.value)} placeholder="Your order is ready for pickup." />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={loading} disabled={!projectId || !senderId}><Send className="h-4 w-4" /> Queue SMS</Button>
            <span className="text-xs text-muted">A 202 response means queued, not delivered.</span>
          </div>
        </form>
      </Panel>
      <div className="space-y-4">
        <Callout tone="info" title="Consent required">
          The recipient must have a current consent record for SMS on this account, and must not be suppressed. <Link to="/app/contacts" className="link">Manage consent</Link>.
        </Callout>
        <Panel title="Charge preview">
          <p className="text-sm leading-6 text-muted">The exact amount cannot be invented in the browser. The API returns <code className="rounded bg-elevated px-1">segments</code> and <code className="rounded bg-elevated px-1">estimatedChargeMinor</code> after it validates the sender, consent, price book and wallet.</p>
          <p className="mt-3 text-xs leading-5 text-muted">Long or non-GSM messages use multiple segments. Insufficient available credit rejects the send before any provider call.</p>
        </Panel>
      </div>
    </div>
  );
}

function WhatsappComposer({ projects, overview }: { projects: Project[]; overview: WhatsappOverview }) {
  const { me } = useAuth();
  const numbers = overview.numbers.filter(number => number.status === 'active');
  const templates = overview.templates.filter(template => template.status === 'APPROVED');
  const [mode, setMode] = useState<'text' | 'template'>('template');
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [numberId, setNumberId] = useState(numbers[0]?.id ?? '');
  const [to, setTo] = useState('');
  const [text, setText] = useState('');
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [variables, setVariables] = useState<string[]>([]);
  const [key, setKey] = useState(newIdempotencyKey);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendAccepted | null>(null);
  const selected = templates.find(template => template.id === templateId);
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projects, projectId]);
  useEffect(() => {
    if (!numberId && numbers[0]) setNumberId(numbers[0].id);
  }, [numbers, numberId]);
  useEffect(() => {
    if (!templateId && templates[0]) setTemplateId(templates[0].id);
  }, [templates, templateId]);
  useEffect(() => {
    setVariables(selected ? Array.from({ length: selected.variableCount }, (_, index) => variables[index] ?? '') : []);
  }, [selected?.id]);
  function change<T>(setter: (value: T) => void, value: T) {
    setter(value); setKey(newIdempotencyKey()); setResult(null);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setError(null);
    try {
      const body = {
        projectId,
        to,
        ...(numberId ? { phoneNumberId: numberId } : {}),
        ...(mode === 'text' ? { text } : { template: selected ? { name: selected.name, language: selected.language, variables } : undefined }),
      };
      const accepted = await api<SendAccepted>('/app/messages/whatsapp', { method: 'POST', headers: { 'Idempotency-Key': key }, body });
      setResult(accepted);
      setText(''); setKey(newIdempotencyKey());
    } catch (cause) { setError(errorMessage(cause)); } finally { setLoading(false); }
  }
  if (!me?.availability.whatsappTest && !me?.availability.whatsappLive) {
    return <Callout tone="warning" title="WhatsApp is not configured">Meta app credentials, Embedded Signup configuration and webhook verification are required. Sending returns a configuration error instead of a simulated success.</Callout>;
  }
  if (!numbers.length) {
    return <EmptyState icon={MessageCircle} title="No active WhatsApp number" description="Connect a WhatsApp Business account and have an administrator confirm Meta billing before sending."
      action={<Link to="/app/whatsapp" className="inline-flex rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">Open WhatsApp setup</Link>} />;
  }
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Panel title="Compose WhatsApp" description="Free-form replies are limited to the 24-hour customer service window. Templates require Meta approval.">
        {result ? <div className="mb-5"><AcceptedCard result={result} onReset={() => setResult(null)} /></div> : null}
        {error ? <div className="mb-4"><Callout tone="danger">{error}</Callout></div> : null}
        <div className="mb-4"><Tabs value={mode} onChange={value => { setMode(value); setResult(null); }} items={[{ value: 'template', label: 'Approved template' }, { value: 'text', label: 'Free-form reply' }]} /></div>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Project" htmlFor="wa-project" required>
              <Select id="wa-project" value={projectId} onChange={event => change(setProjectId, event.target.value)} required>
                {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
              </Select>
            </Field>
            <Field label="WhatsApp number" htmlFor="wa-number" required>
              <Select id="wa-number" value={numberId} onChange={event => change(setNumberId, event.target.value)} required>
                {numbers.map(number => <option key={number.id} value={number.id}>{number.displayPhone ?? number.metaPhoneId}{number.verifiedName ? ` · ${number.verifiedName}` : ''}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Recipient number" htmlFor="wa-to" required hint="Include the country code, for example +233201234567.">
            <TextInput id="wa-to" type="tel" required minLength={8} maxLength={24} value={to} onChange={event => change(setTo, event.target.value)} placeholder="+233201234567" />
          </Field>
          {mode === 'template' ? (
            <>
              <Field label="Template" htmlFor="wa-template" required hint={selected ? `${selected.category} · ${selected.language} · ${selected.variableCount} variable${selected.variableCount === 1 ? '' : 's'}` : 'No approved templates are available.'}>
                <Select id="wa-template" value={templateId} onChange={event => { setTemplateId(event.target.value); setKey(newIdempotencyKey()); setResult(null); }} required>
                  {templates.map(template => <option key={template.id} value={template.id}>{template.name} · {template.language} · {template.category}</option>)}
                </Select>
              </Field>
              {selected && selected.variableCount > 0 ? (
                <div className="space-y-3 rounded-xl border border-line bg-elevated/40 p-4">
                  <p className="text-xs font-semibold text-ink">Template variables ({'{1}'}, {'{2}'}, …)</p>
                  {variables.map((value, index) => (
                    <TextInput key={index} aria-label={`Variable ${index + 1}`} required value={value} maxLength={1024}
                      placeholder={`Value for {{${index + 1}}}`}
                      onChange={event => { const next = [...variables]; next[index] = event.target.value; setVariables(next); setKey(newIdempotencyKey()); }} />
                  ))}
                </div>
              ) : null}
              {!templates.length ? <Callout tone="warning">No approved templates were found. Sync templates or submit one for Meta review first. <Link to="/app/whatsapp" className="link">Manage templates</Link>.</Callout> : null}
            </>
          ) : (
            <Field label="Message text" htmlFor="wa-text" required hint="Only use this inside the 24-hour window opened by a customer’s last inbound message. Pricing applies to service messages too.">
              <TextArea id="wa-text" required maxLength={4096} rows={5} value={text} onChange={event => change(setText, event.target.value)} placeholder="Thanks for your message — how can we help?" />
            </Field>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={loading} disabled={!projectId || !numberId || (mode === 'template' && !selected)}><Send className="h-4 w-4" /> Queue WhatsApp message</Button>
            <span className="text-xs text-muted">The API quotes the category price at acceptance.</span>
          </div>
        </form>
      </Panel>
      <div className="space-y-4">
        <Callout tone="info" title="Consent and policy">
          The recipient needs WhatsApp consent and must not be suppressed. Meta’s Business Messaging Policy applies. <Link to="/app/contacts" className="link">Manage consent</Link>.
        </Callout>
        {mode === 'text' ? <Callout tone="warning" title="Service window"><div className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>The API rejects free-form text when no inbound message exists for this recipient within 24 hours. Use a template instead.</span></div></Callout> : null}
        <Panel title="Template hygiene">
          <div className="space-y-2 text-xs leading-5 text-muted">
            <p className="flex gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Only <Badge tone="success">APPROVED</Badge> templates are shown.</p>
            <p className="flex gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Variable values are encrypted with the outbound message.</p>
            <p className="flex gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> WhatsApp failures may release reserved credit because Meta bills delivered messages; each event is recorded.</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ProjectGate({ projects, loading, children }: { projects: Project[]; loading: boolean; children: ReactNode }) {
  if (loading) return <Loading label="Loading projects…" />;
  if (!projects.length) {
    return <EmptyState icon={Send} title="Create a project first" description="API keys, messages and webhooks belong to a project. Create one before sending."
      action={<Link to="/app/projects" className="inline-flex rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">Create a project</Link>} />;
  }
  return <>{children}</>;
}

export function SendPage() {
  usePageTitle('Send message');
  const [tab, setTab] = useState<'sms' | 'whatsapp'>('sms');
  const projects = useApi<Project[]>('/app/projects');
  const whatsapp = useApi<WhatsappOverview>('/app/whatsapp');
  const projectList = projects.data ?? [];
  return (
    <>
      <PageHeader eyebrow="Messaging" title="Send a message"
        description="Messages are priced from the active price book, require recorded consent and are queued for a background worker. Delivery is confirmed by provider events." />
      <div className="mb-5">
        <Tabs value={tab} onChange={setTab} items={[
          { value: 'sms', label: 'SMS', count: projectList.length || undefined },
          { value: 'whatsapp', label: 'WhatsApp' },
        ]} />
      </div>
      <ProjectGate projects={projectList} loading={projects.loading}>
        {tab === 'sms' ? <SmsComposer projects={projectList} /> : whatsapp.loading && !whatsapp.data ? <Loading label="Loading WhatsApp setup…" /> : whatsapp.error ? (
          <Callout tone="danger" title="Could not load WhatsApp">{whatsapp.error}</Callout>
        ) : whatsapp.data ? <WhatsappComposer projects={projectList} overview={whatsapp.data} /> : null}
      </ProjectGate>
      <div className="mt-6 flex flex-wrap items-center gap-3 text-xs text-muted">
        <Smartphone className="h-4 w-4" /> SMS billing currently supports Ghana accounts.
        <span className="hidden sm:inline">·</span>
        <MessageCircle className="h-4 w-4" /> WhatsApp requires administrator activation.
      </div>
    </>
  );
}
