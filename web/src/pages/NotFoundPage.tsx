import { Link } from 'react-router-dom';
import { ArrowLeft, Compass } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePageTitle } from '../lib/hooks';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { buttonClass } from '../components/ui';

export function NotFoundPage() {
  usePageTitle('Page not found');
  const { me } = useAuth();
  const destination = me ? (me.user.role === 'admin' ? '/admin' : '/app') : '/';
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-canvas">
      <div className="absolute inset-0 grid-lines opacity-60" aria-hidden="true" />
      <header className="relative flex h-16 items-center justify-between border-b border-line bg-canvas/85 px-4 backdrop-blur-xl sm:px-6">
        <Logo />
        <ThemeToggle />
      </header>
      <main className="relative flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-lg text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-700 dark:text-brand-400">
            <Compass className="h-7 w-7" aria-hidden="true" />
          </span>
          <p className="eyebrow mt-6">404 · Not found</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">This route does not exist.</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted">
            The link may be outdated, or the page may belong to a different part of the console. Nothing was changed by visiting this address.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
            <Link to={destination} className={buttonClass('primary', 'lg')}>
              {me ? 'Go to dashboard' : 'Back to home'}
            </Link>
            <Link to="/docs" className={buttonClass('secondary', 'lg')}>
              <ArrowLeft className="h-4 w-4" /> Read the docs
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
