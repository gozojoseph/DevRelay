import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ShieldCheck } from 'lucide-react';
import { Logo } from '../../components/Logo';
import { ThemeToggle } from '../../components/ThemeToggle';

export function AuthShell({ title, description, children, footer }: {
  title: string; description: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[0.95fr_1.05fr]">
      <aside className="relative hidden overflow-hidden bg-slate-950 p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 grid-lines opacity-10" aria-hidden="true" />
        <div className="absolute -left-20 top-1/3 h-80 w-80 rounded-full bg-brand-500/20 blur-3xl" aria-hidden="true" />
        <div className="relative">
          <Logo to="/" />
          <p className="mt-16 max-w-sm text-3xl font-semibold leading-tight tracking-tight">Messaging infrastructure with receipts.</p>
          <p className="mt-4 max-w-sm text-sm leading-6 text-slate-400">SMS and WhatsApp, prepaid in GHS, with an auditable ledger and signed delivery events. No subscriptions and no invented success states.</p>
          <ul className="mt-8 space-y-3 text-sm text-slate-300">
            {['Real provider integrations', 'Consent and opt-out enforcement', 'Encrypted message content', 'Admin MFA and audit logging'].map(item => (
              <li key={item} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-brand-400" />{item}</li>
            ))}
          </ul>
        </div>
        <div className="relative flex items-center gap-2 text-xs text-slate-400"><ShieldCheck className="h-4 w-4 text-brand-400" /> Tenant-isolated · GHS credits · Built for Ghana</div>
      </aside>
      <div className="flex min-h-screen flex-col">
        <header className="flex h-16 items-center justify-between border-b border-line px-5 sm:px-8 lg:justify-end lg:border-0">
          <div className="lg:hidden"><Logo to="/" /></div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link to="/" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-muted hover:bg-elevated hover:text-ink">
              <ArrowLeft className="h-3.5 w-3.5" /> Home
            </Link>
          </div>
        </header>
        <main className="flex flex-1 items-start justify-center px-5 py-8 sm:px-8 sm:py-12">
          <div className="w-full max-w-md animate-slide-up">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
            <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
            <div className="mt-7">{children}</div>
            {footer ? <div className="mt-6 border-t border-line pt-5 text-sm text-muted">{footer}</div> : null}
          </div>
        </main>
      </div>
    </div>
  );
}
