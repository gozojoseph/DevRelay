import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, MailCheck } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { usePageTitle } from '../../lib/hooks';
import { Button, Callout, Field, TextInput } from '../../components/ui';
import { AuthShell } from './AuthShell';

export function VerifyPage() {
  usePageTitle('Verify email');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [resendState, setResendState] = useState<string | null>(null);
  async function verify() {
    setLoading(true); setError(null);
    try {
      const result = await api<{ message: string }>('/auth/verify', { method: 'POST', body: { token } });
      setMessage(result.message);
    } catch (cause) { setError(errorMessage(cause)); } finally { setLoading(false); }
  }
  async function resend(event: FormEvent) {
    event.preventDefault();
    setResendState(null); setError(null);
    try {
      const result = await api<{ message: string }>('/auth/resend-verification', { method: 'POST', body: { email } });
      setResendState(result.message);
    } catch (cause) { setError(errorMessage(cause)); }
  }
  if (message) {
    return (
      <AuthShell title="Email verified" description="Your email is confirmed. An administrator must now approve the business account.">
        <div className="rounded-2xl border border-line bg-surface p-6 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-brand-600" />
          <p className="mt-3 text-sm leading-6 text-muted">{message}</p>
          <p className="mt-2 text-sm leading-6 text-muted">Sign in to see approval status. Funding and sending remain disabled until approval is complete.</p>
          <Link to="/login" className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">Go to sign in</Link>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Verify your email" description="Open the link from your registration email. Verification activates the account for administrator review."
      footer={<p>Already verified? <Link to="/login" className="link">Sign in</Link></p>}>
      {!token ? (
        <div className="space-y-5">
          <Callout tone="warning" title="Verification link missing">This page needs the token from your email. Use the form below to request a fresh link.</Callout>
          <form onSubmit={resend} className="space-y-4">
            <Field label="Account email" htmlFor="verify-email" required>
              <TextInput id="verify-email" type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="owner@company.com" />
            </Field>
            {resendState ? <Callout tone="success">{resendState}</Callout> : null}
            <Button type="submit" variant="secondary" className="w-full"><MailCheck className="h-4 w-4" /> Send a new link</Button>
          </form>
        </div>
      ) : (
        <div className="space-y-5">
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <div className="rounded-xl border border-line bg-elevated/50 p-4 text-sm leading-6 text-muted">
            This will mark the email as verified and move the account into the approval queue. The link can be used once and expires after 24 hours.
          </div>
          <Button type="button" onClick={() => void verify()} loading={loading} className="w-full"><CheckCircle2 className="h-4 w-4" /> Verify email</Button>
          <div className="border-t border-line pt-4">
            <p className="mb-3 text-xs text-muted">Link expired or already used? Request a new one.</p>
            <form onSubmit={resend} className="flex flex-col gap-2 sm:flex-row">
              <TextInput type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="owner@company.com" aria-label="Email for a new verification link" />
              <Button type="submit" variant="secondary" className="shrink-0">Resend</Button>
            </form>
            {resendState ? <p className="mt-2 text-xs text-brand-700 dark:text-brand-300">{resendState}</p> : null}
          </div>
        </div>
      )}
    </AuthShell>
  );
}
