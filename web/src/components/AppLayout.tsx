import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BadgeCheck, ContactRound, FolderKanban, Globe, LayoutDashboard, LifeBuoy, LogOut, Menu, MessageCircle,
  MessageSquare, Send, Server, Settings2, ShieldCheck, Wallet, Webhook, X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { titleCase } from '../lib/format';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { Badge, buttonClass, Callout, cx, StatusBadge } from './ui';

const groups = [
  { title: 'Messaging', links: [
    { to: '/app', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/app/send', label: 'Send message', icon: Send },
    { to: '/app/messages', label: 'Messages', icon: MessageSquare },
    { to: '/app/whatsapp', label: 'WhatsApp', icon: MessageCircle },
  ] },
  { title: 'Infrastructure', links: [
    { to: '/app/wallet', label: 'Wallet', icon: Wallet },
    { to: '/app/projects', label: 'Projects & keys', icon: FolderKanban },
    { to: '/app/webhooks', label: 'Webhooks', icon: Webhook },
  ] },
  { title: 'DevRelay Cloud', links: [
    { to: '/app/hosting', label: 'Hosting', icon: Server },
    { to: '/app/domains', label: 'Domains', icon: Globe },
  ] },
  { title: 'Compliance', links: [
    { to: '/app/contacts', label: 'Consent & opt-outs', icon: ContactRound },
    { to: '/app/senders', label: 'Sender IDs', icon: BadgeCheck },
  ] },
  { title: 'Account', links: [
    { to: '/app/support', label: 'Support', icon: LifeBuoy },
    { to: '/app/settings', label: 'Settings', icon: Settings2 },
  ] },
];

const allLinks = groups.flatMap(group => group.links);

function NavItem({ to, label, icon: Icon, end, onClick }: {
  to: string; label: string; icon: typeof LayoutDashboard; end?: boolean; onClick?: () => void;
}) {
  return (
    <NavLink to={to} end={end} onClick={onClick}
      className={({ isActive }) => cx('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition',
        isActive ? 'bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-300' : 'text-muted hover:bg-elevated hover:text-ink')}>
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </NavLink>
  );
}

export function AppLayout() {
  const { me, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    setOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [location.pathname]);
  if (!me) return null;
  const current = allLinks.find(link => link.to === '/app' ? location.pathname === '/app' : location.pathname.startsWith(link.to));
  async function signOut() {
    await logout();
    navigate('/login', { replace: true });
  }
  const status = me.account?.status ?? 'pending_verification';
  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between border-b border-line px-4">
        <Logo to="/app" />
        <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-elevated lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-semibold text-ink">{me.account?.businessName ?? 'Your account'}</p>
          <StatusBadge status={status} />
        </div>
        <p className="mt-1 truncate text-xs text-muted">{me.user.email}</p>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4 scrollbar-thin" aria-label="Dashboard">
        {groups.map(group => (
          <div key={group.title} className="mb-5 last:mb-0">
            <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{group.title}</p>
            <div className="space-y-0.5">
              {group.links.map(link => <NavItem key={link.to} {...link} onClick={() => setOpen(false)} />)}
            </div>
          </div>
        ))}
        {me.user.role === 'admin' ? (
          <div className="mt-4 border-t border-line pt-4">
            <Link to="/admin" className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-muted hover:bg-elevated hover:text-ink">
              <ShieldCheck className="h-4 w-4" /> Admin console
            </Link>
          </div>
        ) : null}
      </nav>
      <div className="border-t border-line p-3">
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button type="button" onClick={() => void signOut()} className={cx(buttonClass('ghost', 'md'), 'flex-1 justify-start px-2.5')}>
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
  return (
    <div className="min-h-screen bg-canvas">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-line bg-surface lg:block">{sidebar}</aside>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={() => setOpen(false)} aria-label="Close menu" />
          <aside className="relative h-full w-72 max-w-[85vw] border-r border-line bg-surface shadow-lift">{sidebar}</aside>
        </div>
      ) : null}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-xl">
          <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button type="button" className="rounded-lg border border-line bg-surface p-2 text-muted lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
                <Menu className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{current?.label ?? 'Dashboard'}</p>
                <p className="hidden truncate text-xs text-muted sm:block">Prepaid messaging console</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="neutral">GHS credits</Badge>
              <ThemeToggle className="hidden sm:inline-flex" />
            </div>
          </div>
        </header>
        <main className="px-4 py-6 sm:px-6 lg:px-8">
          {status !== 'active' ? (
            <div className="mb-6">
              <Callout tone={status === 'suspended' ? 'danger' : 'warning'} title={`Account ${titleCase(status)}`}>
                {status === 'pending_verification'
                  ? 'Verify your email, then wait for administrator approval. Sending stays disabled until the account is active.'
                  : status === 'pending_approval'
                    ? 'Your email is verified. An administrator must approve the account before messaging, funding and WhatsApp onboarding.'
                    : 'Sending and funding are disabled while this account is suspended. Contact support for help.'}
              </Callout>
            </div>
          ) : null}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
