import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ExternalLink, Inbox, MessageCircle, Plus, RefreshCw, Send, Smartphone, Wifi,
} from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatDate, titleCase } from '../../lib/format';
import type {
  Conversation, ConversationMessages, PublicConfig, WhatsappConnection, WhatsappOverview,
} from '../../lib/types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
  Badge, Button, Callout, EmptyState, Field, Loading, Modal, PageHeader, Panel, Select, StatusBadge, Tabs,
  TextArea, TextInput,
} from '../../components/ui';

function EmbeddedSignup({ config, disabled, onDone }: { config: PublicConfig | null; disabled: boolean; onDone: () => Promise<void> }) {
  const { toast } = useToast();
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [wabaId, setWabaId] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [pin, setPin] = useState('');
  const [starting, setStarting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);
  const appId = config?.metaAppId ?? null;
  const configId = config?.metaConfigId ?? null;
  const graphVersion = config?.metaGraphVersion ?? 'v27.0';
  useEffect(() => {
    if (!appId) return;
    if (window.FB) { window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: graphVersion }); setSdkReady(true); return; }
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, autoLogAppEvents: true, xfbml: false, version: graphVersion });
      setSdkReady(true);
    };
    if (document.getElementById('facebook-jssdk')) return;
    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true; script.defer = true; script.crossOrigin = 'anonymous';
    script.onerror = () => setSdkError('The Meta JavaScript SDK could not be loaded. Check your network or content security policy.');
    document.body.appendChild(script);
  }, [appId, graphVersion]);
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (!event.origin.endsWith('facebook.com') && !event.origin.endsWith('facebook.net')) return;
      let payload: Record<string, unknown>;
      try { payload = typeof event.data === 'string' ? JSON.parse(event.data) as Record<string, unknown> : event.data as Record<string, unknown>; }
      catch { return; }
      if (!payload || payload.type !== 'WA_EMBEDDED_SIGNUP') return;
      const eventName = String(payload.event ?? '');
      const data = (payload.data ?? {}) as { waba_id?: string; phone_number_id?: string; business_id?: string };
      if (eventName === 'FINISH' || eventName === 'FINISH_ONLY_WABA' || eventName === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
        if (data.waba_id) setWabaId(data.waba_id);
        if (data.phone_number_id) setPhoneNumberId(data.phone_number_id);
        if (data.business_id) setBusinessId(data.business_id);
        setSignupError(null);
      }
      if (eventName === 'CANCEL') setSignupError('Meta signup was cancelled.');
      if (eventName === 'ERROR') setSignupError('Meta reported an error during Embedded Signup. Restart the flow.');
    }
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  function launch() {
    if (!window.FB || !configId) { setSignupError('Meta Embedded Signup is not ready yet. Reload the page and try again.'); return; }
    setStarting(true); setSignupError(null); setCode(null);
    window.FB.login(response => {
      setStarting(false);
      const authCode = response.authResponse?.code;
      if (!authCode) { setSignupError('Meta did not return an authorization code. The signup was cancelled or blocked.'); return; }
      setCode(authCode);
      toast('Meta signup authorized. Confirm the asset IDs below.', 'success');
    }, {
      config_id: configId,
      response_type: 'code',
      override_default_response_type: true,
      extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' },
    });
  }
  async function finish(event: FormEvent) {
    event.preventDefault();
    if (!code) { setSignupError('Authorize with Meta first so the server can exchange the code.'); return; }
    setFinishing(true); setSignupError(null);
    try {
      await api('/app/whatsapp/onboarding', { method: 'POST', body: { code, wabaId, phoneNumberId,
        ...(businessId ? { businessId } : {}), ...(pin ? { pin } : {}) } });
      toast('WhatsApp assets connected. An administrator must confirm billing before sending.', 'success');
      await onDone();
    } catch (cause) { setSignupError(errorMessage(cause)); } finally { setFinishing(false); }
  }
  if (!appId || !configId) {
    return <Callout tone="warning" title="Embedded Signup is not configured">The server has no public Meta app ID or configuration ID. An operator must configure Meta Embedded Signup before accounts can connect WhatsApp.</Callout>;
  }
  return (
    <Panel title={<span className="inline-flex items-center gap-2"><MessageCircle className="h-4 w-4 text-brand-600" /> Connect a WhatsApp Business account</span>}
      description="Uses Meta Embedded Signup v4. DevRelay receives a short-lived authorization code and exchanges it server-side; your Meta password is never handled by this app.">
      <ol className="mb-5 grid gap-2 text-xs leading-5 text-muted sm:grid-cols-3">
        <li className="rounded-lg border border-line bg-elevated/40 p-3"><span className="font-semibold text-ink">1. Authorize</span><br />Sign in to Meta and choose the business, WABA and phone number.</li>
        <li className="rounded-lg border border-line bg-elevated/40 p-3"><span className="font-semibold text-ink">2. Confirm assets</span><br />Meta sends the selected WABA and phone number IDs back.</li>
        <li className="rounded-lg border border-line bg-elevated/40 p-3"><span className="font-semibold text-ink">3. Admin billing check</span><br />A DevRelay admin confirms Meta billing before sending is enabled.</li>
      </ol>
      {signupError ? <div className="mb-4"><Callout tone="danger">{signupError}</Callout></div> : null}
      {sdkError ? <div className="mb-4"><Callout tone="warning">{sdkError}</Callout></div> : null}
      {!code ? (
        <div className="space-y-3">
          <Button type="button" onClick={launch} loading={starting} disabled={!sdkReady || disabled}>
            <ExternalLink className="h-4 w-4" /> {sdkReady ? 'Continue with Meta' : 'Loading Meta SDK…'}
          </Button>
          {disabled ? <p className="text-xs text-muted">The account must be approved before WhatsApp onboarding. <Link to="/app/settings" className="link">Check account status</Link>.</p> : null}
          <p className="text-xs leading-5 text-muted">A popup may be blocked by the browser. Allow popups for this site and use HTTPS in production. This flow requires a Meta Tech Provider configuration that is approved for Embedded Signup.</p>
        </div>
      ) : (
        <form onSubmit={finish} className="space-y-4">
          <Callout tone="success" title="Meta authorization received">Confirm the WhatsApp Business Account and phone number IDs returned by Embedded Signup. You can enter them manually if the session message did not arrive.</Callout>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="WABA ID" htmlFor="waba-id" required hint="Numeric WhatsApp Business Account ID.">
              <TextInput id="waba-id" required pattern="[0-9]{5,40}" value={wabaId} onChange={event => setWabaId(event.target.value.replace(/\D/g, ''))} placeholder="123456789012345" />
            </Field>
            <Field label="Phone number ID" htmlFor="phone-id" required hint="Meta phone number ID, not the phone number itself.">
              <TextInput id="phone-id" required pattern="[0-9]{5,40}" value={phoneNumberId} onChange={event => setPhoneNumberId(event.target.value.replace(/\D/g, ''))} placeholder="123456789012345" />
            </Field>
            <Field label="Business ID (optional)" htmlFor="business-id" hint="Meta business portfolio ID, if available.">
              <TextInput id="business-id" pattern="[0-9]{5,40}" value={businessId} onChange={event => setBusinessId(event.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field label="Registration PIN (optional)" htmlFor="wa-pin" hint="6-digit PIN if the number still needs registration.">
              <TextInput id="wa-pin" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={finishing} disabled={!wabaId || !phoneNumberId}><Wifi className="h-4 w-4" /> Finish connection</Button>
            <Button type="button" variant="secondary" onClick={launch} disabled={starting}>Restart Meta signup</Button>
          </div>
        </form>
      )}
    </Panel>
  );
}

function Connections({ connections }: { connections: WhatsappConnection[] }) {
  if (!connections.length) return null;
  return (
    <div className="space-y-4">
      {connections.map(connection => (
        <div key={connection.id} className="surface-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2"><p className="font-mono text-sm font-semibold text-ink">WABA {connection.wabaId}</p><StatusBadge status={connection.status} /></div>
              <p className="mt-1 text-xs text-muted">Connected {formatDate(connection.createdAt)} · token expiry {connection.tokenExpiresAt ? formatDate(connection.tokenExpiresAt) : 'not reported'}</p>
            </div>
            <Badge tone="neutral">Cloud API</Badge>
          </div>
          {connection.lastError ? <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{connection.lastError}</p> : null}
          {connection.status === 'pending_activation' ? <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-300">Pending activation: an administrator must confirm Meta billing before this connection can send or sync templates.</p> : null}
        </div>
      ))}
    </div>
  );
}

export function WhatsappPage() {
  usePageTitle('WhatsApp');
  const { me } = useAuth();
  const { toast } = useToast();
  const overview = useApi<WhatsappOverview>('/app/whatsapp');
  const config = useApi<PublicConfig>('/public/config');
  const [tab, setTab] = useState<'setup' | 'templates' | 'inbox'>('setup');
  const [syncing, setSyncing] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateForm, setTemplateForm] = useState({ connectionId: '', name: '', language: 'en', category: 'MARKETING', body: '', examples: '' });
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const conversation = useApi<ConversationMessages>(selectedConversation ? `/app/whatsapp/conversations/${selectedConversation}/messages` : null, [selectedConversation]);
  const data = overview.data;
  const activeConnections = useMemo(() => data?.connections.filter(connection => connection.status === 'active') ?? [], [data]);
  const approvedTemplates = data?.templates.filter(template => template.status === 'APPROVED') ?? [];
  async function sync() {
    setSyncing(true);
    try {
      await api('/app/whatsapp/templates/sync', { method: 'POST', body: {} });
      await overview.reload();
      toast('Templates synchronized from Meta.', 'success');
    } catch (cause) { toast(errorMessage(cause), 'error'); } finally { setSyncing(false); }
  }
  function openTemplate() {
    setTemplateForm({ connectionId: activeConnections[0]?.id ?? '', name: '', language: 'en', category: 'MARKETING', body: '', examples: '' });
    setTemplateError(null); setTemplateOpen(true);
  }
  async function submitTemplate(event: FormEvent) {
    event.preventDefault();
    setTemplateBusy(true); setTemplateError(null);
    try {
      const examples = templateForm.examples.split(',').map(value => value.trim()).filter(Boolean).slice(0, 10);
      await api('/app/whatsapp/templates', { method: 'POST', body: { connectionId: templateForm.connectionId,
        name: templateForm.name.trim(), language: templateForm.language.trim(), category: templateForm.category,
        body: templateForm.body.trim(), ...(examples.length ? { examples } : {}) } });
      setTemplateOpen(false); await overview.reload();
      toast('Template submitted to Meta for review.', 'success');
    } catch (cause) { setTemplateError(errorMessage(cause)); } finally { setTemplateBusy(false); }
  }
  return (
    <>
      <PageHeader eyebrow="Channel" title="WhatsApp Cloud API"
        description="Connect through Meta Embedded Signup, sync approved templates and inspect conversations. Production sending stays blocked until Meta approval and administrator billing confirmation." 
        actions={<><Button variant="secondary" onClick={() => void overview.reload()}><RefreshCw className="h-4 w-4" /> Refresh</Button><Button variant="secondary" loading={syncing} onClick={() => void sync()} disabled={!activeConnections.length}><RefreshCw className="h-4 w-4" /> Sync templates</Button></>} />
      {overview.loading && !data ? <Loading label="Loading WhatsApp setup…" /> : overview.error ? <Callout tone="danger" title="Could not load WhatsApp">{overview.error}</Callout> : data ? (
        <div className="space-y-6">
          {!data.availability.configured ? <Callout tone="warning" title="WhatsApp is not configured">Meta app credentials, Embedded Signup config and webhook verification are missing on the server. The UI will not pretend a connection exists.</Callout> : null}
          {!data.availability.productionApproved ? <Callout tone="info" title="Test mode">This server is not marked as Meta production approved. Onboarding and sending availability depends on server configuration; production is never assumed.</Callout> : null}
          <Tabs value={tab} onChange={setTab} items={[
            { value: 'setup', label: 'Setup', count: data.connections.length },
            { value: 'templates', label: 'Templates', count: data.templates.length },
            { value: 'inbox', label: 'Inbox', count: data.conversations.length },
          ]} />
          {tab === 'setup' ? (
            <div className="space-y-6">
              <Connections connections={data.connections} />
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                <EmbeddedSignup config={config.data} disabled={me?.account?.status !== 'active'} onDone={overview.reload} />
                <div className="space-y-4">
                  <Panel title="Numbers" description="Numbers are linked to a connection after Meta verifies the assets." bodyClassName="p-0">
                    {data.numbers.length ? (
                      <div className="divide-y divide-line">
                        {data.numbers.map(number => (
                          <div key={number.id} className="px-4 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-ink">{number.displayPhone ?? number.metaPhoneId}</p>
                              <StatusBadge status={number.status} />
                            </div>
                            <p className="mt-1 text-xs text-muted">{number.verifiedName ?? 'Unverified name'} · quality {number.quality ? titleCase(number.quality) : 'not reported'}</p>
                            <p className="mt-1 text-[11px] text-muted">Billing confirmed: {number.billingConfirmedAt ? formatDate(number.billingConfirmedAt) : 'not yet'}</p>
                          </div>
                        ))}
                      </div>
                    ) : <div className="p-5"><EmptyState icon={Smartphone} title="No numbers" description="Connect a WhatsApp Business account and verify a phone number through Meta." /></div>}
                  </Panel>
                  <Callout tone="warning" title="Billing is not automatic">
                    A DevRelay administrator must confirm that Meta billing is configured before a number becomes active. This protects you from unexpected upstream charges and keeps sending disabled until setup is verified.
                  </Callout>
                </div>
              </div>
            </div>
          ) : tab === 'templates' ? (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted">{approvedTemplates.length} approved template{approvedTemplates.length === 1 ? '' : 's'} available to send.</p>
                <Button onClick={openTemplate} disabled={!activeConnections.length}><Plus className="h-4 w-4" /> Submit template</Button>
              </div>
              <Panel title="Templates" description="Synchronize to refresh Meta statuses. Only APPROVED templates can be used by the send endpoint." action={<Button size="sm" variant="ghost" loading={syncing} onClick={() => void sync()} disabled={!activeConnections.length}>Sync</Button>} bodyClassName="p-0">
                {data.templates.length ? (
                  <div className="table-wrap border-0">
                    <table className="data-table">
                      <thead><tr><th>Name</th><th>Language</th><th>Category</th><th>Variables</th><th>Status</th><th>Synced</th></tr></thead>
                      <tbody>
                        {data.templates.map(template => (
                          <tr key={template.id}>
                            <td><p className="font-mono text-xs font-semibold text-ink">{template.name}</p>{template.rejectionReason ? <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{template.rejectionReason}</p> : null}</td>
                            <td><Badge tone="neutral">{template.language}</Badge></td>
                            <td className="text-xs text-muted">{template.category}</td>
                            <td className="text-xs text-muted">{template.variableCount}</td>
                            <td><StatusBadge status={template.status.toLowerCase()} /></td>
                            <td className="text-xs text-muted">{template.syncedAt ? formatDate(template.syncedAt) : 'Never'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <div className="p-5"><EmptyState icon={MessageCircle} title="No templates" description="Sync from Meta or submit a template after an administrator activates your connection." action={<Button size="sm" onClick={openTemplate} disabled={!activeConnections.length}><Plus className="h-3.5 w-3.5" /> Submit template</Button>} /></div>}
              </Panel>
              <div className="grid gap-4 lg:grid-cols-2">
                <Callout tone="info" title="Variables">Use numbered placeholders such as <code className="rounded bg-elevated px-1">{'{{1}}'}</code> and <code className="rounded bg-elevated px-1">{'{{2}}'}</code>. The number of values at send time must match Meta’s approved variable count.</Callout>
                <Callout tone="warning" title="Review is external">Meta reviews categories and content. DevRelay cannot approve a rejected template or predict review time. Check status after syncing.</Callout>
              </div>
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
              <Panel title={<span className="inline-flex items-center gap-2"><Inbox className="h-4 w-4 text-brand-600" /> Conversations</span>} description="Recent inbound or outbound customer threads." bodyClassName="p-0">
                {data.conversations.length ? (
                  <div className="max-h-[600px] divide-y divide-line overflow-y-auto">
                    {data.conversations.map((item: Conversation) => (
                      <button key={item.id} type="button" onClick={() => setSelectedConversation(item.id)}
                        className={`w-full px-4 py-3 text-left transition hover:bg-elevated ${selectedConversation === item.id ? 'bg-brand-50/60 dark:bg-brand-500/10' : ''}`}>
                        <p className="text-sm font-semibold text-ink">{item.recipient}</p>
                        <p className="mt-1 text-[11px] text-muted">Last inbound {item.lastInboundAt ? formatDate(item.lastInboundAt) : 'never'} · updated {formatDate(item.updatedAt)}</p>
                      </button>
                    ))}
                  </div>
                ) : <div className="p-5"><EmptyState icon={Inbox} title="No conversations" description="Inbound messages create conversations. Outbound-only numbers appear after a recipient replies." /></div>}
              </Panel>
              <Panel title="Conversation" description={selectedConversation ? 'Last 100 messages for this recipient, newest first.' : 'Select a conversation to inspect messages.'} bodyClassName="p-0">
                {!selectedConversation ? <div className="p-6"><EmptyState icon={Send} title="Choose a conversation" description="The inbox stores inbound content encrypted per account and shows delivery status for outbound messages." /></div> : conversation.loading && !conversation.data ? <Loading label="Loading conversation…" /> : conversation.error ? <div className="p-4"><Callout tone="danger">{conversation.error}</Callout></div> : conversation.data ? (
                  <div className="flex max-h-[600px] flex-col gap-3 overflow-y-auto p-4">
                    {conversation.data.messages.length ? conversation.data.messages.map(message => (
                      <div key={message.id} className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${message.direction === 'inbound' ? 'self-start bg-elevated text-ink' : 'self-end bg-brand-600 text-white'}`}>
                        <p className="whitespace-pre-wrap leading-6">{message.body ?? (message.templateName ? `Template: ${message.templateName}` : 'No content')}</p>
                        <p className={`mt-1 text-[10px] ${message.direction === 'inbound' ? 'text-muted' : 'text-brand-100'}`}>{formatDate(message.createdAt)} · {titleCase(message.status)}</p>
                      </div>
                    )) : <p className="text-sm text-muted">No messages in this conversation.</p>}
                  </div>
                ) : null}
              </Panel>
            </div>
          )}
        </div>
      ) : null}
      <Modal open={templateOpen} onClose={() => setTemplateOpen(false)} title="Submit WhatsApp template" description="Meta reviews the name, category and content. Submitting does not mean approval."
        footer={<><Button variant="secondary" onClick={() => setTemplateOpen(false)}>Cancel</Button><Button type="submit" form="template-form" loading={templateBusy}>Submit to Meta</Button></>}>
        <form id="template-form" onSubmit={submitTemplate} className="space-y-4">
          {templateError ? <Callout tone="danger">{templateError}</Callout> : null}
          <Field label="Connection" htmlFor="template-connection" required>
            <Select id="template-connection" value={templateForm.connectionId} onChange={event => setTemplateForm(current => ({ ...current, connectionId: event.target.value }))} required>
              {activeConnections.map(connection => <option key={connection.id} value={connection.id}>WABA {connection.wabaId}</option>)}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Template name" htmlFor="template-name" required hint="Lowercase letters, numbers and underscores.">
              <TextInput id="template-name" required pattern="[a-z0-9_]{1,180}" value={templateForm.name} onChange={event => setTemplateForm(current => ({ ...current, name: event.target.value }))} placeholder="appointment_reminder" />
            </Field>
            <Field label="Language" htmlFor="template-language" required hint="For example en or en_GB.">
              <TextInput id="template-language" required pattern="[a-z]{2,3}(_[A-Z]{2})?" value={templateForm.language} onChange={event => setTemplateForm(current => ({ ...current, language: event.target.value }))} />
            </Field>
          </div>
          <Field label="Category" htmlFor="template-category" required>
            <Select id="template-category" value={templateForm.category} onChange={event => setTemplateForm(current => ({ ...current, category: event.target.value }))}>
              <option value="MARKETING">Marketing</option><option value="UTILITY">Utility</option>
            </Select>
          </Field>
          <Field label="Body" htmlFor="template-body" required hint="Max 1024 characters. Use {{1}} placeholders for variables.">
            <TextArea id="template-body" required maxLength={1024} rows={5} value={templateForm.body} onChange={event => setTemplateForm(current => ({ ...current, body: event.target.value }))} placeholder="Hi {{1}}, your appointment is on {{2}}." />
          </Field>
          <Field label="Example values" htmlFor="template-examples" hint="Comma-separated values for Meta review, e.g. Ama, Friday 10:00. Required when the template has variables.">
            <TextInput id="template-examples" value={templateForm.examples} onChange={event => setTemplateForm(current => ({ ...current, examples: event.target.value }))} />
          </Field>
          <Callout tone="warning">Do not include URLs, phone numbers or content that violates Meta’s policy unless the template category and use case permit it.</Callout>
        </form>
      </Modal>
    </>
  );
}
