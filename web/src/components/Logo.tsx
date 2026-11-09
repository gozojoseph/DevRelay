import { Link } from 'react-router-dom';
import { cx } from './ui';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cx('h-8 w-8', className)} role="img" aria-label="DevRelay logo">
      <rect width="40" height="40" rx="11" fill="#059669" />
      <path d="M11 13.5h8.5c5 0 9 3.1 9 6.5s-4 6.5-9 6.5H11" fill="none" stroke="#ecfdf5" strokeWidth="3" strokeLinecap="round" />
      <circle cx="12" cy="13.5" r="2.6" fill="#a7f3df" />
      <circle cx="12" cy="26.5" r="2.6" fill="#a7f3df" />
      <circle cx="29" cy="20" r="2.3" fill="#fff" />
    </svg>
  );
}

export function Logo({ to = '/', compact }: { to?: string; compact?: boolean }) {
  return (
    <Link to={to} className="inline-flex items-center gap-2.5 rounded-lg" aria-label="DevRelay home">
      <LogoMark />
      {compact ? null : (
        <span className="text-lg font-semibold tracking-tight text-ink">
          Dev<span className="text-brand-600 dark:text-brand-400">Relay</span>
        </span>
      )}
    </Link>
  );
}
