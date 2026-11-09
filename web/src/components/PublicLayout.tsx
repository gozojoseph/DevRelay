import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ArrowRight, Menu, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { buttonClass, cx } from './ui';

const nav = [
  { to: '/pricing', label: 'Pricing' },
  { to: '/docs', label: 'Docs' },
  { to: '/status', label: 'Status' },
  { to: '/support', label: 'Support' },
];

const footerGroups = [
  { title: 'Product', links: [
    { to: '/pricing', label: 'Prepaid pricing' },
    { to: '/docs', label: 'SMS API' },
    { to: '/docs#whatsapp', label: 'WhatsApp API' },
    { to: '/status', label: 'Service status' },
  ] },
  { title: 'Developers', links: [
    { to: '/docs#authentication', label: 'Authentication' },
    { to: '/docs#send-sms', label: 'Send an SMS' },
    { to: '/docs#webhooks', label: 'Signed webhooks' },
    { to: '/docs#errors', label: 'Errors and limits' },
  ] },
  { title: 'Company', links: [
    { to: '/support', label: 'Support' },
    { to: '/terms', label: 'Terms of service' },
    { to: '/privacy', label: 'Privacy notice' },
    { to: '/acceptable-use', label: 'Acceptable use' },
  ] },
];

export function PublicLayout() {
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => { setOpen(false); window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }); }, [location.pathname]);
  const destination = me ? (me.user.role === 'admin' ? '/admin' : '/app') : null;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-line/80 bg-canvas/85 backdrop-blur-xl">
        <div className="container-page flex h-16 items-center justify-between gap-4">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {nav.map(item => (
              <NavLink key={item.to} to={item.to}
                className={({ isActive }) => cx('rounded-lg px-3 py-2 text-sm font-medium transition',
                  isActive ? 'bg-elevated text-ink' : 'text-muted hover:bg-elevated/70 hover:text-ink')}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {destination ? (
              <Link to={destination} className={buttonClass('primary', 'md', 'hidden sm:inline-flex')}>Dashboard <ArrowRight className="h-4 w-4" /></Link>
            ) : (
              <>
                <Link to="/login" className={buttonClass('ghost', 'md', 'hidden sm:inline-flex')}>Sign in</Link>
                <Link to="/register" className={buttonClass('primary', 'md', 'hidden sm:inline-flex')}>Start building</Link>
              </>
            )}
            <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-muted md:hidden"
              aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} onClick={() => setOpen(value => !value)}>
              {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>
        {open ? (
          <div className="border-t border-line bg-surface px-4 pb-4 pt-2 md:hidden">
            {nav.map(item => (
              <NavLink key={item.to} to={item.to} className="block rounded-lg px-3 py-2.5 text-sm font-medium text-muted hover:bg-elevated hover:text-ink">
                {item.label}
              </NavLink>
            ))}
            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3">
              {destination ? (
                <Link to={destination} className={buttonClass('primary', 'md', 'col-span-2')}>Go to dashboard</Link>
              ) : (
                <>
                  <Link to="/login" className={buttonClass('secondary', 'md')}>Sign in</Link>
                  <Link to="/register" className={buttonClass('primary', 'md')}>Start building</Link>
                </>
              )}
            </div>
          </div>
        ) : null}
      </header>
      <main className="flex-1"><Outlet /></main>
      <footer className="border-t border-line bg-surface">
        <div className="container-page grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <Logo />
            <p className="mt-4 max-w-sm text-sm leading-6 text-muted">
              Prepaid SMS and WhatsApp messaging infrastructure for teams building in Ghana. Pay for what you send, with an auditable credit ledger.
            </p>
            <p className="mt-4 max-w-sm text-xs leading-5 text-muted">
              Provider availability depends on configured operator credentials and approvals. DevRelay never shows invented delivery or payment data.
            </p>
          </div>
          {footerGroups.map(group => (
            <div key={group.title}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink">{group.title}</h3>
              <ul className="mt-3 space-y-2">
                {group.links.map(link => (
                  <li key={link.to}><Link to={link.to} className="text-sm text-muted hover:text-ink">{link.label}</Link></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-line">
          <div className="container-page flex flex-col gap-2 py-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} DevRelay. All rights reserved.</p>
            <p>Ghana · GHS prepaid credits · Policies are drafts pending legal and regulatory review.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
