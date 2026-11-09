import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertTriangle, Check, CheckCircle2, Copy, Info, Loader2, X, type LucideIcon } from 'lucide-react';
import { statusTone, titleCase } from '../lib/format';

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type ButtonSize = 'sm' | 'md' | 'lg';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white shadow-sm hover:bg-brand-700 disabled:bg-brand-600/60',
  secondary: 'border border-line bg-surface text-ink shadow-sm hover:bg-elevated',
  ghost: 'text-muted hover:bg-elevated hover:text-ink',
  danger: 'bg-rose-600 text-white shadow-sm hover:bg-rose-700 disabled:bg-rose-600/60',
  subtle: 'bg-brand-50 text-brand-800 hover:bg-brand-100 dark:bg-brand-500/10 dark:text-brand-300 dark:hover:bg-brand-500/20',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 rounded-lg px-2.5 text-xs',
  md: 'h-10 gap-2 rounded-xl px-4 text-sm',
  lg: 'h-11 gap-2 rounded-xl px-5 text-sm',
};

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string) {
  return cx('inline-flex select-none items-center justify-center font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
    buttonSizes[size], buttonVariants[variant], extra);
}

export function Button({ variant = 'primary', size = 'md', loading, className, children, disabled, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }) {
  return (
    <button {...props} disabled={disabled || loading} className={buttonClass(variant, size, className)}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Field({ label, htmlFor, hint, error, required, children }: {
  label: string; htmlFor?: string; hint?: ReactNode; error?: string | null; required?: boolean; children: ReactNode;
}) {
  return (
    <div>
      <label className="field-label" htmlFor={htmlFor}>
        {label}{required ? <span className="ml-0.5 text-rose-500" aria-hidden="true">*</span> : null}
      </label>
      {children}
      {error ? <p className="field-error" role="alert">{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx('field-input', props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx('field-input min-h-[96px] resize-y', props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx('field-input appearance-none pr-9', props.className)} />;
}

const badgeTones = {
  success: 'border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300',
  warning: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
  danger: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300',
  info: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300',
  neutral: 'border-line bg-elevated text-muted',
};

export function Badge({ children, tone = 'neutral', dot }: {
  children: ReactNode; tone?: keyof typeof badgeTones; dot?: boolean;
}) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold', badgeTones[tone])}>
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)} dot>{titleCase(status)}</Badge>;
}

const calloutTones = {
  info: { wrap: 'border-sky-200 bg-sky-50/80 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100', icon: 'text-sky-600 dark:text-sky-400', Icon: Info },
  success: { wrap: 'border-brand-200 bg-brand-50/80 text-brand-900 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-100', icon: 'text-brand-600 dark:text-brand-400', Icon: CheckCircle2 },
  warning: { wrap: 'border-amber-200 bg-amber-50/80 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100', icon: 'text-amber-600 dark:text-amber-400', Icon: AlertTriangle },
  danger: { wrap: 'border-rose-200 bg-rose-50/80 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100', icon: 'text-rose-600 dark:text-rose-400', Icon: AlertTriangle },
};

export function Callout({ tone = 'info', title, children, action }: {
  tone?: keyof typeof calloutTones; title?: string; children: ReactNode; action?: ReactNode;
}) {
  const value = calloutTones[tone];
  return (
    <div className={cx('flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm leading-6 sm:flex-row sm:items-start', value.wrap)}>
      <value.Icon className={cx('mt-0.5 hidden h-5 w-5 shrink-0 sm:block', value.icon)} aria-hidden="true" />
      <div className="flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={title ? 'mt-1 opacity-90' : 'opacity-90'}>{children}</div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Panel({ title, description, action, children, className, bodyClassName }: {
  title?: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string;
}) {
  return (
    <section className={cx('surface-card overflow-hidden', className)}>
      {title || action ? (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            {title ? <h2 className="text-sm font-semibold text-ink">{title}</h2> : null}
            {description ? <p className="mt-1 text-xs leading-5 text-muted">{description}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      <div className={bodyClassName ?? 'p-5'}>{children}</div>
    </section>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: {
  eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: {
  icon: LucideIcon; title: string; description: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-elevated/40 px-6 py-10 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface shadow-sm">
        <Icon className="h-5 w-5 text-muted" aria-hidden="true" />
      </span>
      <h3 className="mt-3 text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-1 max-w-md text-xs leading-5 text-muted">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Loading({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div className={cx('flex items-center justify-center gap-2 py-10 text-sm text-muted', className)} role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-lg bg-elevated', className)} />;
}

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: {
  open: boolean; onClose: () => void; title: string; description?: ReactNode; children: ReactNode;
  footer?: ReactNode; size?: 'sm' | 'md' | 'lg';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', onKey); };
  }, [open, onClose]);
  if (!open) return null;
  const width = size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-3xl' : 'max-w-xl';
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close dialog" className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm" onClick={onClose} />
      <div className={cx('relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-lift sm:rounded-2xl', width)}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {description ? <p className="mt-1 text-xs leading-5 text-muted">{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-elevated hover:text-ink" aria-label="Close dialog">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-elevated/40 px-5 py-4">{footer}</div> : null}
      </div>
    </div>
  );
}

export function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard can be denied by the browser */ }
  }
  return (
    <button type="button" onClick={() => void copy()} className={cx('inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-muted transition hover:bg-elevated hover:text-ink', className)}>
      {copied ? <Check className="h-3.5 w-3.5 text-brand-600" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : label}
    </button>
  );
}

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label ?? 'Example'}</span>
        <CopyButton value={code} className="text-slate-400 hover:bg-slate-800 hover:text-white" />
      </div>
      <pre className="overflow-x-auto p-4 text-[12px] leading-6 text-slate-200"><code>{code}</code></pre>
    </div>
  );
}

export function StatCard({ label, value, hint, icon: Icon, tone }: {
  label: string; value: ReactNode; hint?: ReactNode; icon?: LucideIcon; tone?: 'brand' | 'amber' | 'rose' | 'sky';
}) {
  const iconTone = tone === 'amber' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
    : tone === 'rose' ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
      : tone === 'sky' ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
        : 'bg-brand-500/10 text-brand-600 dark:text-brand-400';
  return (
    <div className="surface-card p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-muted">{label}</p>
        {Icon ? <span className={cx('flex h-8 w-8 items-center justify-center rounded-lg', iconTone)}><Icon className="h-4 w-4" /></span> : null}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs leading-5 text-muted">{hint}</p> : null}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: {
  value: T; onChange: (value: T) => void; items: { value: T; label: string; count?: number }[];
}) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-elevated/60 p-1 hide-scrollbar" role="tablist">
      {items.map(item => (
        <button key={item.value} type="button" role="tab" aria-selected={item.value === value}
          onClick={() => onChange(item.value)}
          className={cx('flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition',
            item.value === value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}>
          {item.label}
          {item.count !== undefined ? <span className="rounded-full bg-elevated px-1.5 text-[10px] text-muted">{item.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
