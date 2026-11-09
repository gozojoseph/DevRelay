import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, BadgeCheck, Building2, Calculator, FileClock, LayoutDashboard, LifeBuoy,
  LogOut, Menu, MessageCircle, MessagesSquare, Settings2, ShieldCheck, Tags, X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { Badge, buttonClass, cx } from './ui';

const links = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/admin/accounts', label: 'Accounts', icon: Building2 },
  { to: '/admin/senders', label: 'Sender review', icon: BadgeCheck },
  { to: '/admin/pricing', label: 'Pricing', icon: Tags },
  { to: '/admin/messages', label: 'Messages', icon: MessagesSquare },
  { to: '/admin/reconciliation', label: 'Reconciliation', icon: Calculator },
  { to: '/admin/whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { to: '/admin/support', label: 'Support', icon: LifeBuoy },
  { to: '/admin/audit', label: 'Audit log', icon: FileClock },
  { to: '/admin/settings', label: 'Settings', icon: Settings2 },
];

export function AdminLayout() {
  const { me, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    setOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [location.pathname]);
  if (!me) return null;
  const current = links.find(link => link.to === '/admin' ? location.pathname === '/admin' : location.pathname.startsWith(link.to));
  async function signOut() {
    await logout();
    navigate('/login', { replace: true });
  }
  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between border-b border-line px-4">
        <div className="flex items-center gap-2.5">
          <Logo to="/admin" />
          <Badge tone="info">Admin</Badge>
        </div>
        <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-elevated lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink"><ShieldCheck className="h-4 w-4 text-brand-600" /> Operations console</div>
        <p className="mt-1 truncate text-xs text-muted">{me.user.email}</p>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4 scrollbar-thin" aria-label="Admin">
        <div className="space-y-0.5">
          {links.map(link => (
            <NavLink key={link.to} to={link.to} end={link.end} onClick={() => setOpen(false)}
              className={({ isActive }) => cx('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition',
                isActive ? 'bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-300' : 'text-muted hover:bg-elevated hover:text-ink')}>
              <link.icon className="h-4 w-4 shrink-0" />
              {link.label}
            </NavLink>
          ))}
        </div>
        <div className="mt-4 border-t border-line pt-4">
          <Link to="/app" className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-muted hover:bg-elevated hover:text-ink">
            <ArrowLeft className="h-4 w-4" /> Developer console
          </Link>
        </div>
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
                <p className="truncate text-sm font-semibold text-ink">{current?.label ?? 'Admin'}</p>
                <p className="hidden text-xs text-muted sm:block">Administrator · all actions are audited</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="warning">MFA protected</Badge>
              <ThemeToggle className="hidden sm:inline-flex" />
            </div>
          </div>
        </header>
        <main className="px-4 py-6 sm:px-6 lg:px-8"><Outlet /></main>
      </div>
    </div>
  );
}
