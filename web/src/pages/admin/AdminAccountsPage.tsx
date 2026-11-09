import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Search, Users } from 'lucide-react';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatDate } from '../../lib/format';
import type { AdminAccount } from '../../lib/types';
import {
  Badge, Button, Callout, EmptyState, Loading, PageHeader, Select, StatusBadge, TextInput,
} from '../../components/ui';

export function AdminAccountsPage() {
  usePageTitle('Accounts');
  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const query = new URLSearchParams();
  if (status) query.set('status', status);
  if (search) query.set('search', search);
  const path = `/admin/accounts?${query.toString()}`;
  const accounts = useApi<AdminAccount[]>(path);
  function submit(event: FormEvent) {
    event.preventDefault();
    setSearch(searchInput.trim());
  }
  return (
    <>
      <PageHeader eyebrow="Tenants" title="Accounts"
        description="Review business identity, user verification and message volume. Approval unlocks funding and sending; suspension blocks both until resolved." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form onSubmit={submit} className="flex flex-1 gap-2 sm:max-w-md">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <TextInput aria-label="Search accounts" className="pl-9" value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="Business name or contact email" />
          </div>
          <Button type="submit" variant="secondary">Search</Button>
        </form>
        <Select aria-label="Filter by account status" value={status} onChange={event => setStatus(event.target.value)} className="w-auto min-w-[180px]">
          <option value="">All statuses</option>
          {['pending_verification', 'pending_approval', 'active', 'suspended'].map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
        </Select>
        {(search || status) ? <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setSearchInput(''); setStatus(''); }}>Clear</Button> : null}
      </div>
      {accounts.loading && !accounts.data ? <Loading label="Loading accounts…" /> : accounts.error ? <Callout tone="danger" title="Could not load accounts">{accounts.error}</Callout> : accounts.data?.length ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Business</th><th>Contact</th><th>Status</th><th>Users</th><th>Messages</th><th>Created</th><th></th></tr></thead>
            <tbody>
              {accounts.data.map(account => (
                <tr key={account.id}>
                  <td><Link to={`/admin/accounts/${account.id}`} className="font-semibold text-ink hover:underline">{account.businessName}</Link></td>
                  <td className="text-muted">{account.contactEmail}</td>
                  <td><StatusBadge status={account.status} /></td>
                  <td><Badge tone="neutral"><Users className="h-3 w-3" /> {account.users.length}</Badge></td>
                  <td className="text-muted">{account.messageCount.toLocaleString('en-GH')}</td>
                  <td className="text-xs text-muted">{formatDate(account.createdAt)}</td>
                  <td><Link to={`/admin/accounts/${account.id}`} className="link text-xs">Review</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="surface-card p-6"><EmptyState icon={Users} title="No accounts match" description="Clear the filters or wait for new registrations. Accounts appear after signup." /></div>}
      <p className="mt-4 text-xs text-muted">Showing up to 500 accounts. Search is server-side and case-insensitive for business name and contact email.</p>
    </>
  );
}
