import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Globe, RefreshCw, Search, ShieldAlert, ShoppingCart } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatDay, formatMinor, relativeTime, titleCase } from '../../lib/format';
import type { DomainDetail, DomainLookup, DomainsOverview, Project } from '../../lib/types';
import { useToast } from '../../context/ToastContext';
import {
  Badge, Button, Callout, EmptyState, Field, Loading, Modal, PageHeader, Panel, Select, StatusBadge, TextInput,
} from '../../components/ui';

const WARNING_LABELS = ['Healthy', 'Renews within 30 days', 'Renews within 14 days', 'Renews within 7 days', 'RENEWS WITHIN 1 DAY'];

const emptyRegistrant = {
  firstName: '', lastName: '', organisation: '', email: '', phone: '', country: 'GH', city: '', addressLine: '',
};

export function DomainsPage() {
  usePageTitle('Domains');
  const { toast } = useToast();
  const overview = useApi<DomainsOverview>('/app/domains');
  const projects = useApi<Project[]>('/app/projects');
  const available = overview.data?.available ?? false;
  const hasProjects = Boolean(projects.data?.length);

  const [query, setQuery] = useState('');
  const [lookup, setLookup] = useState<DomainLookup | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [buyDomain, setBuyDomain] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRenew, setAutoRenew] = useState(true);
  const [projectId, setProjectId] = useState('');
  const [registrant, setRegistrant] = useState(emptyRegistrant);

  const [detail, setDetail] = useState<DomainDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function runLookup(event: FormEvent) {
    event.preventDefault();
    setLookupBusy(true); setLookupError(null); setLookup(null);
    try { setLookup(await api<DomainLookup>('/app/domains/lookup', { method: 'POST', body: { domain: query.trim() } })); }
    catch (cause) { setLookupError(errorMessage(cause)); }
    finally { setLookupBusy(false); }
  }
  function openBuy(name: string) {
    setBuyDomain(name); setProjectId(projects.data?.[0]?.id ?? '');
    setRegistrant({ ...emptyRegistrant }); setAutoRenew(true); setError(null); setOpen(true);
  }
  async function buy(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      await api('/app/domains', { method: 'POST', body: { projectId, domain: buyDomain.trim(), autoRenew, registrant } });
      setOpen(false); await overview.reload();
      toast('Domain ordered. The registration was queued — the wallet was charged in advance.', 'success');
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  async function openDetail(id: string) {
    setDetailBusy(true);
    try { setDetail(await api<DomainDetail>(`/app/domains/${id}`)); }
    catch (cause) { toast(errorMessage(cause), 'error'); }
    finally { setDetailBusy(false); }
  }
  async function toggleAutoRenew(domain: DomainDetail | { id: string; autoRenew: boolean }) {
    setBusyId(domain.id);
    try {
      await api(`/app/domains/${domain.id}`, { method: 'PATCH', body: { autoRenew: !domain.autoRenew } });
      await overview.reload();
      if (detail?.id === domain.id) await openDetail(domain.id);
      toast(domain.autoRenew ? 'Auto-renew off. The domain will expire and can be LOST if not renewed manually.' : 'Auto-renew on. Renewals are charged ~30 days before expiry.', 'success');
    } catch (cause) { toast(errorMessage(cause), 'error'); } finally { setBusyId(null); }
  }
  async function renewNow(id: string) {
    setBusyId(id);
    try {
      await api(`/app/domains/${id}/renew`, { method: 'POST' });
      await overview.reload(); if (detail) await openDetail(id);
      toast('Renewal queued — charged in advance, one more year.', 'success');
    } catch (cause) { toast(errorMessage(cause), 'error'); } finally { setBusyId(null); }
  }

  return (
    <>
      <PageHeader eyebrow="DevRelay Cloud" title="Domains"
        description="Search, buy and renew domains with your GHS wallet — no card needed. Charged in advance; unrenewed domains expire and can be lost, so renewal warnings are explicit."
        actions={<Button variant="secondary" onClick={() => void overview.reload()}><RefreshCw className="h-4 w-4" /> Refresh</Button>} />
      {overview.loading && !overview.data ? <Loading label="Loading domains…" /> : overview.error ? <Callout tone="danger" title="Could not load domains">{overview.error}</Callout> : (
        <div className="space-y-6">
          {!available ? (
            <Callout tone="info" title="Domain sales are not switched on yet">
              The reseller integration is being completed. Prices below are indicative; lookups and purchases unlock the moment it goes live.
            </Callout>
          ) : null}
          {!hasProjects ? (
            <Callout tone="warning" title="Create a project first">Domains belong to a project, just like API keys. <Link to="/app/projects" className="link">Create a project</Link>.</Callout>
          ) : null}

          <Panel title={<span className="inline-flex items-center gap-2"><Search className="h-4 w-4 text-brand-600" /> Find a domain</span>}
            description="Live registry availability through our reseller." >
            <form onSubmit={runLookup} className="flex flex-col gap-2 sm:flex-row">
              <TextInput type="search" required minLength={4} maxLength={253} value={query}
                onChange={event => { setQuery(event.target.value); setLookup(null); }}
                placeholder="yourbrand.com" aria-label="Domain to search" />
              <Button type="submit" loading={lookupBusy} disabled={!available}>Check availability</Button>
            </form>
            {lookupError ? <div className="mt-3"><Callout tone="danger">{lookupError}</Callout></div> : null}
            {lookup ? (
              <div className="mt-3">
                {lookup.available ? (
                  <Callout tone="success" title={`${lookup.domain} is available`}
                    action={<Button size="sm" onClick={() => openBuy(lookup.domain)}><ShoppingCart className="h-3.5 w-3.5" /> Buy — {formatMinor(lookup.priceMinor)}/yr</Button>}>
                    One year at {formatMinor(lookup.priceMinor)}, charged from your wallet when you order.
                  </Callout>
                ) : (
                  <Callout tone="warning" title={`${lookup.domain} is taken`}>Try another name or a different TLD below.</Callout>
                )}
              </div>
            ) : null}
          </Panel>

          <Panel title="Pricing" description="One-year registration or renewal, per domain." bodyClassName="p-0">
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>TLD</th><th>Price / year</th><th>Renewal</th></tr></thead>
                <tbody>
                  {(overview.data?.pricing ?? []).map(entry => (
                    <tr key={entry.tld}>
                      <td className="font-semibold text-ink">.{entry.tld}</td>
                      <td>{formatMinor(entry.priceMinor)}</td>
                      <td className="text-muted">{formatMinor(entry.priceMinor)} <span className="text-xs">(same, auto-renew available)</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title={<span className="inline-flex items-center gap-2"><Globe className="h-4 w-4 text-brand-600" /> Your domains</span>}
            description="expired means the registrar grace window — still recoverable. lapsed means the domain is lost." bodyClassName="p-0">
            {overview.data?.items.length ? (
              <div className="divide-y divide-line">
                {overview.data.items.map(domain => (
                  <div key={domain.id} className="px-5 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <button type="button" className="text-sm font-semibold text-ink hover:underline" onClick={() => void openDetail(domain.id)}>{domain.name}</button>
                          <StatusBadge status={domain.status} />
                          {domain.autoRenew ? <Badge tone="neutral">Auto-renew</Badge> : <Badge tone="warning">No auto-renew</Badge>}
                          {domain.lastWarningLevel > 0 && ['active', 'expired'].includes(domain.status) ? (
                            <Badge tone={domain.lastWarningLevel >= 3 ? 'danger' : 'warning'} dot>
                              <ShieldAlert className="h-3 w-3" /> {WARNING_LABELS[domain.lastWarningLevel]}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-muted">{domain.projectName ?? domain.projectId} · renews {formatDay(domain.expiresAt)} ({relativeTime(domain.expiresAt)})</p>
                        {domain.lastError ? <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400">{titleCase(domain.lastError)}</p> : null}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        <Button size="sm" variant="secondary" loading={busyId === domain.id} onClick={() => void renewNow(domain.id)} disabled={!available}>Renew</Button>
                        <Button size="sm" variant="ghost" loading={busyId === domain.id} onClick={() => void toggleAutoRenew(domain)}>{domain.autoRenew ? 'Turn off auto-renew' : 'Turn on auto-renew'}</Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : <div className="p-5"><EmptyState icon={Globe} title="No domains yet"
              description="Search for a name above. When you buy, the wallet is charged first and the registration is queued with the registrar."
              action={available ? <Button size="sm" onClick={() => openBuy('')} disabled={!hasProjects}><ShoppingCart className="h-3.5 w-3.5" /> Buy a domain</Button> : undefined} /></div>}
          </Panel>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={`Buy ${buyDomain || 'a domain'}`}
        description="The wallet is charged in advance. If the balance is too low, nothing is ordered."
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" form="buy-domain-form" loading={busy}>Order domain</Button></>}>
        <form id="buy-domain-form" onSubmit={buy} className="space-y-4">
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <Field label="Domain" htmlFor="buy-domain-name" required hint="Letters, numbers and hyphens. Must end in a supported TLD.">
            <TextInput id="buy-domain-name" required minLength={4} maxLength={253} value={buyDomain} onChange={event => setBuyDomain(event.target.value)} placeholder="yourbrand.com" />
          </Field>
          <Field label="Project" htmlFor="buy-domain-project" required>
            <Select id="buy-domain-project" value={projectId} onChange={event => setProjectId(event.target.value)} required>
              {(projects.data ?? []).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </Select>
          </Field>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink">
            <input type="checkbox" checked={autoRenew} onChange={event => setAutoRenew(event.target.checked)} className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500" />
            Auto-renew each year (charged ~30 days before expiry; recommended — unrenewed domains are lost)
          </label>
          <p className="field-label">Registrant contact</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" htmlFor="reg-first" required>
              <TextInput id="reg-first" required maxLength={60} value={registrant.firstName} onChange={event => setRegistrant({ ...registrant, firstName: event.target.value })} />
            </Field>
            <Field label="Last name" htmlFor="reg-last" required>
              <TextInput id="reg-last" required maxLength={60} value={registrant.lastName} onChange={event => setRegistrant({ ...registrant, lastName: event.target.value })} />
            </Field>
            <Field label="Organisation" htmlFor="reg-org">
              <TextInput id="reg-org" maxLength={120} value={registrant.organisation} onChange={event => setRegistrant({ ...registrant, organisation: event.target.value })} />
            </Field>
            <Field label="Email" htmlFor="reg-email" required hint="The registrar sends the compliance email here.">
              <TextInput id="reg-email" type="email" required maxLength={120} value={registrant.email} onChange={event => setRegistrant({ ...registrant, email: event.target.value })} />
            </Field>
            <Field label="Phone" htmlFor="reg-phone" required hint="International format, e.g. +233244000000">
              <TextInput id="reg-phone" required maxLength={24} value={registrant.phone} onChange={event => setRegistrant({ ...registrant, phone: event.target.value })} />
            </Field>
            <Field label="Country" htmlFor="reg-country" required hint="Two-letter code, e.g. GH">
              <TextInput id="reg-country" required maxLength={2} minLength={2} value={registrant.country} onChange={event => setRegistrant({ ...registrant, country: event.target.value.toUpperCase() })} />
            </Field>
            <Field label="City" htmlFor="reg-city" required>
              <TextInput id="reg-city" required maxLength={80} value={registrant.city} onChange={event => setRegistrant({ ...registrant, city: event.target.value })} />
            </Field>
            <Field label="Address" htmlFor="reg-address" required>
              <TextInput id="reg-address" required maxLength={200} value={registrant.addressLine} onChange={event => setRegistrant({ ...registrant, addressLine: event.target.value })} />
            </Field>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(detail) || detailBusy} onClose={() => setDetail(null)} title={detail ? detail.name : 'Domain'}
        description={detail ? `Registered through DevRelay · renews ${formatDay(detail.expiresAt)}` : undefined}
        footer={<Button variant="secondary" onClick={() => setDetail(null)}>Close</Button>}>
        {detail ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={detail.status} />
              {detail.autoRenew ? <Badge tone="neutral">Auto-renew</Badge> : <Badge tone="warning">No auto-renew</Badge>}
              {detail.providerReference ? <Badge tone="info">Ref {detail.providerReference}</Badge> : null}
            </div>
            {detail.nameservers?.length ? (
              <div>
                <p className="field-label">Nameservers</p>
                {detail.nameservers.map(ns => <p key={ns} className="font-mono text-xs text-ink">{ns}</p>)}
              </div>
            ) : null}
            {detail.status === 'expired' ? <Callout tone="warning" title="Grace window">This domain is past expiry but still recoverable — renew now to keep it.</Callout> : null}
            {detail.status === 'lapsed' ? <Callout tone="danger" title="Domain lost">The grace window passed and the domain lapsed at the registrar.</Callout> : null}
            <div>
              <p className="field-label">Recent orders</p>
              <div className="mt-2 space-y-2">
                {detail.orders.map(order => (
                  <div key={order.id} className="flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2 text-xs">
                    <div>
                      <p className="font-semibold text-ink">{titleCase(order.action)} — {formatMinor(order.amountMinor)}</p>
                      <p className="text-muted">{formatDay(order.createdAt)}{order.error ? ` · ${order.error}` : ''}</p>
                    </div>
                    <StatusBadge status={order.status} />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" loading={busyId === detail.id} onClick={() => void renewNow(detail.id)} disabled={!available}>Renew 1 year</Button>
              <Button size="sm" variant="ghost" loading={busyId === detail.id} onClick={() => void toggleAutoRenew(detail)}>{detail.autoRenew ? 'Turn off auto-renew' : 'Turn on auto-renew'}</Button>
            </div>
          </div>
        ) : <Loading label="Loading domain…" />}
      </Modal>
    </>
  );
}
